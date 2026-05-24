"""
Medical RAG Agent — OpenAI Function Calling 驱动的多步推理

Agent 自主决定: 用哪个工具 → 检索 → 判断结果是否充分 → 补充检索 → 交叉验证 → 综合回答
"""

import json
import logging
from typing import Dict, List, Any
from openai import OpenAI

from src.pipeline import MedicalRAGPipeline, PROVIDERS

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是循证医学助手，用工具检索知识库后回答。

## 规则
1. 任何问题都必须先调用search_rag或list_docs检索
2. search_rag检索1-2次即可，检索结果已包含文献名(doc)、章节(section)、证据等级(evidence_level)
3. 检索结果充分后立即回答，不要反复搜索
4. 答案标注来源: [文献名, 页码, 证据等级]
5. 若知识库无相关数据，如实说明"""

# ─── Tool Definitions (OpenAI function-calling format) ───

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_rag",
            "description": "检索医学文献知识库。输入中文临床问题，返回相关文献片段及来源、页码、证据等级。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "中文检索查询，用关键词而非完整句子"},
                    "top_k": {"type": "integer", "description": "返回结果数量，默认5，最多15"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cross_check",
            "description": "检查多篇文献关于某医学主题的结论是否一致，发现证据矛盾。",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "要检查的医学主题（如'TBAD药物治疗'）"},
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_evidence",
            "description": "获取某篇文献的证据等级(Meta/RCT/Cohort/Expert Consensus)和PICO框架。",
            "parameters": {
                "type": "object",
                "properties": {
                    "doc_name": {"type": "string", "description": "文献名称，从search_rag结果的source字段提取"},
                },
                "required": ["doc_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_docs",
            "description": "列出知识库中所有已索引的医学文献名称和证据类型。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "deep_retrieve",
            "description": "从多个角度深度检索同一主题。当第一轮检索不够充分时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "检索主题"},
                    "aspects": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "检索角度列表，如['诊断','治疗','预后','安全性','流行病学']",
                    },
                },
                "required": ["topic", "aspects"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "extract_chart",
            "description": "提取医学文献中图表的具体数据（效应量、基线特征、生存率等）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "doc_name": {"type": "string", "description": "文献名称"},
                    "chart_hint": {"type": "string", "description": "图表提示（如'Table 1基线特征'或'森林图'）"},
                },
                "required": ["doc_name", "chart_hint"],
            },
        },
    },
]


class MedicalAgent:
    """OpenAI Function Calling 驱动的医学RAG Agent"""

    def __init__(self, pipeline: MedicalRAGPipeline):
        self.pipeline = pipeline
        self.client = pipeline.clients["baidu_pro"]
        self.model = PROVIDERS["baidu_pro"]["model"]

    # ─── Tool Executors ───────────────────────────────

    def _tool_search_rag(self, args: dict) -> str:
        query = args.get("query", "")
        if not isinstance(query, str) or not query.strip():
            return json.dumps({"error": "search_rag requires a non-empty string query"}, ensure_ascii=False)
        try:
            top_k = min(int(args.get("top_k", 5)), 15)
        except (ValueError, TypeError):
            top_k = 5

        # ─── Dual-engine: try LightRAG first, fallback to FAISS ───
        lightrag_result = None
        if self.pipeline._lightrag_ready:
            try:
                lr = self.pipeline._lightrag_query_sync(query, mode="hybrid")
                if lr and lr.get("answer"):
                    lightrag_result = lr
            except Exception:
                pass  # Silent fallback to FAISS

        results = self.pipeline._doc_aware_retrieve(query, top_k=top_k)
        if not results and not lightrag_result:
            return "未找到相关文献内容。"

        items = []
        # LightRAG result first if available
        if lightrag_result:
            items.append({
                "ref": 0,
                "source": "LightRAG-Knowledge-Graph",
                "doc": "知识图谱",
                "section": "entity-relation",
                "evidence_level": "GraphRAG",
                "score": 1.0,
                "text": lightrag_result["answer"][:500],
            })

        for i, r in enumerate(results):
            meta = r.get("meta", {})
            evidence = self._infer_evidence_level(r["text"])
            section = meta.get("section_tag", "")
            doc = r["source"].split(" [p.")[0] if " [p." in r["source"] else r["source"]
            item = {
                "ref": len(items) + 1,
                "source": r["source"],
                "doc": doc,
                "section": section,
                "evidence_level": evidence,
                "score": round(r["score"], 3),
                "text": r["text"][:500],
            }
            if meta.get("image_url"):
                item["image_url"] = meta["image_url"]
            items.append(item)
        return json.dumps(items, ensure_ascii=False, indent=2)

    def _tool_cross_check(self, args: dict) -> str:
        topic = args.get("topic", "")
        if not isinstance(topic, str) or not topic.strip():
            return json.dumps({"error": "cross_check requires a non-empty string topic"}, ensure_ascii=False)
        results = self.pipeline._faiss_retrieve(topic, top_k=20)
        docs = {}
        for r in results:
            doc = r["source"].split(" [p.")[0]
            if doc not in docs:
                docs[doc] = {"texts": [], "evidence_hint": None}
            docs[doc]["texts"].append(r["text"][:300])
            # Detect evidence level from text keywords
            if docs[doc]["evidence_hint"] is None:
                docs[doc]["evidence_hint"] = self._infer_evidence_level(r["text"])

        if len(docs) < 2:
            return json.dumps({
                "topic": topic,
                "documents_found": list(docs.keys()),
                "assessment": "文献不足（<2篇），无法进行一致性评估",
                "suggestion": "用search_rag扩大检索范围",
            }, ensure_ascii=False)

        # Build evidence-graded summary
        graded = {}
        for doc_name, info in docs.items():
            level = info["evidence_hint"] or "unknown"
            if level not in graded:
                graded[level] = []
            graded[level].append(doc_name)

        return json.dumps({
            "topic": topic,
            "documents_compared": list(docs.keys()),
            "document_count": len(docs),
            "evidence_levels": graded,
            "evidence_hierarchy": "Meta-analysis > RCT > Cohort > Case-control > Case-series > Expert-opinion",
            "sample_findings": {doc: info["texts"][:2] for doc, info in list(docs.items())[:5]},
            "consistency_hint": "比较各文献结论方向是否一致、效应量方向是否相同、证据等级是否有冲突。高等级证据应优先采纳。",
        }, ensure_ascii=False, indent=2)

    @staticmethod
    def _infer_evidence_level(text: str) -> str | None:
        """从文本关键词推断证据等级"""
        tl = text.lower()
        if any(k in tl for k in ["meta-analysis", "meta分析", "systematic review", "系统综述", "pooled analysis"]):
            return "Meta-analysis"
        if any(k in tl for k in ["randomized", "随机对照", "rct", "randomised"]):
            return "RCT"
        if any(k in tl for k in ["cohort", "队列", "prospective", "前瞻性", "retrospective", "回顾性"]):
            return "Cohort"
        if any(k in tl for k in ["case-control", "病例对照", "case control"]):
            return "Case-control"
        if any(k in tl for k in ["case report", "case series", "病例报告", "病例系列"]):
            return "Case-series"
        return None

    def _tool_get_evidence(self, args: dict) -> str:
        doc_name = args["doc_name"]
        matching = [
            m for m in self.pipeline.chunk_meta
            if doc_name.lower() in m.get("doc_name", "").lower()
        ]
        if not matching:
            return json.dumps({"error": f"未找到文献: {doc_name}"}, ensure_ascii=False)
        types = set(m.get("type", "text") for m in matching)
        pages = set(m.get("page_idx", "?") for m in matching)
        return json.dumps({
            "doc_name": doc_name,
            "chunk_count": len(matching),
            "content_types": list(types),
            "pages_covered": sorted(pages),
        }, ensure_ascii=False)

    def _tool_list_docs(self, args: dict) -> str:
        docs = sorted(set(s.split(" [p.")[0] for s in self.pipeline.sources))
        summary = []
        for d in docs:
            chunks = [s for s in self.pipeline.sources if d in s]
            pages = set()
            for s in chunks:
                if "p." in s:
                    try:
                        pages.add(int(s.split("p.")[1].split("]")[0]))
                    except ValueError:
                        pass
            summary.append({
                "name": d,
                "chunks": len(chunks),
                "pages": sorted(pages) if pages else "unknown",
            })
        return json.dumps(summary, ensure_ascii=False, indent=2)

    def _tool_deep_retrieve(self, args: dict) -> str:
        topic = args["topic"]
        aspects = args.get("aspects", [])
        all_results = {}
        for aspect in aspects:
            q = f"{topic} {aspect}"
            results = self.pipeline._faiss_retrieve(q, top_k=3)
            all_results[aspect] = [
                {"source": r["source"], "text": r["text"][:300]}
                for r in results
            ]
        return json.dumps(all_results, ensure_ascii=False, indent=2)

    def _tool_extract_chart(self, args: dict) -> str:
        doc_name = args["doc_name"]
        chart_hint = args["chart_hint"]
        results = self.pipeline._faiss_retrieve(
            f"{doc_name} {chart_hint} 表格 图表", top_k=5
        )
        if not results:
            return json.dumps({"message": f"未找到与 '{chart_hint}' 相关的图表数据"}, ensure_ascii=False)
        items = []
        for r in results:
            items.append({
                "source": r["source"],
                "text": r["text"][:500],
            })
        return json.dumps(items, ensure_ascii=False, indent=2)

    def _critique_answer(self, query: str, answer: str, trace: list) -> dict:
        """Self-critique: evaluate answer quality and assign confidence level."""
        issues = []
        confidence = "high"

        # 1. Source check: does the answer cite the knowledge base?
        has_source = any(kw in answer for kw in ["[", "p.", "文献", "来源", "参考"])
        if not has_source and trace:
            issues.append("答案未引用知识库来源，可能基于通用知识而非文献")
            confidence = "medium"

        # 2. Retrieval check: did we actually search?
        search_steps = [t for t in trace if t["tool"] in ("search_rag", "deep_retrieve")]
        if not search_steps:
            issues.append("未进行任何知识库检索，答案可能不可靠")
            confidence = "low"

        # 3. Data presence check: did search return results?
        empty_searches = [t for t in search_steps if "未找到" in t.get("result_preview", "")]
        if len(empty_searches) == len(search_steps) and search_steps:
            issues.append("所有检索均未返回结果，知识库可能不包含相关数据")
            confidence = "low"

        # 4. Uncertainty markers: is the answer hedging too much?
        uncertainty_count = answer.count("可能") + answer.count("不确定") + answer.count("暂无")
        if uncertainty_count > 5:
            issues.append("答案包含过多不确定表述，证据可能不充分")
            confidence = "medium" if confidence == "high" else confidence

        # 5. Vague answer check: too short or too generic
        if len(answer) < 80 and query:
            issues.append("答案过于简短，可能未充分回答用户问题")
            confidence = "medium" if confidence == "high" else confidence

        # 6. Tool artifact check
        if "<｜" in answer or "tool_call" in answer:
            issues.append("答案包含工具调用残留，输出异常")
            confidence = "low"

        # Build refined query for backtracking
        refined_query = query
        if confidence == "low" and query:
            # Simplify and re-search with core keywords
            refined_query = " ".join(query.replace("？", "").replace("?", "").split()[:5])

        return {
            "confidence": confidence,
            "issues": issues,
            "refined_query": refined_query if confidence == "low" else query,
        }

    def _backtrack_search(self, query: str, messages: list) -> str | None:
        """Re-search with refined query when initial answer has low confidence."""
        try:
            results = self.pipeline._doc_aware_retrieve(query, top_k=8)
            if not results:
                return None
            items = []
            for i, r in enumerate(results):
                meta = r.get("meta", {})
                evidence = self._infer_evidence_level(r["text"])
                items.append({
                    "ref": i + 1,
                    "source": r["source"],
                    "evidence_level": evidence,
                    "text": r["text"][:500],
                })
            return json.dumps(items, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"Backtrack search failed: {e}")
            return None

    def execute_tool(self, tool_name: str, args: dict) -> str:
        """分发 tool call 到对应执行器"""
        handlers = {
            "search_rag": self._tool_search_rag,
            "cross_check": self._tool_cross_check,
            "get_evidence": self._tool_get_evidence,
            "list_docs": self._tool_list_docs,
            "deep_retrieve": self._tool_deep_retrieve,
            "extract_chart": self._tool_extract_chart,
        }
        handler = handlers.get(tool_name)
        if handler:
            return handler(args)
        return json.dumps({"error": f"Unknown tool: {tool_name}"})

    # ─── Agent Loop ───────────────────────────────────

    def run(self, query: str, max_steps: int = 6) -> Dict[str, Any]:
        """
        Agent 多步推理循环:
        1. 发送 query + tool definitions 给 LLM
        2. LLM 决定调用哪个 tool
        3. 执行 tool，把结果发给 LLM
        4. 重复直到 LLM 给出最终回答
        """
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": query},
        ]
        reasoning_trace = []
        search_count = 0  # Track total search_rag + deep_retrieve calls
        backtrack_count = 0  # Prevent infinite backtrack loops

        for step in range(max_steps):
            # After 2 searches: force final answer
            force_answer = search_count >= 2
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    tools=[] if force_answer else TOOLS,
                    tool_choice="none" if force_answer else "auto",
                    temperature=0.3,
                    max_tokens=600,
                    timeout=25.0,
                )
            except Exception as e:
                logger.error(f"Agent LLM call failed at step {step+1}: {e}")
                # Try to give answer from existing trace
                if reasoning_trace:
                    return {
                        "answer": f"推理在第{step+1}步时遇到API超时。已完成的检索结果如下，请基于这些信息判断。",
                        "reasoning_trace": reasoning_trace,
                        "steps": step + 1,
                        "model": self.model,
                        "sources": [],
                        "truncated": True,
                    }
                return {
                    "answer": f"推理启动失败: {str(e)[:200]}",
                    "reasoning_trace": [],
                    "steps": 0,
                    "model": self.model,
                    "sources": [],
                }

            msg = response.choices[0].message

            # LLM decided to call a tool
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    tool_name = tc.function.name
                    if tool_name in ("search_rag", "deep_retrieve"):
                        search_count += 1
                    tool_args = json.loads(tc.function.arguments)

                    logger.info(f"Agent step {step+1}: {tool_name}({tool_args})")
                    try:
                        tool_result = self.execute_tool(tool_name, tool_args)
                    except Exception as e:
                        tool_result = json.dumps({"error": f"Tool execution failed: {str(e)[:200]}"}, ensure_ascii=False)
                        logger.warning(f"Tool {tool_name} failed: {e}")

                    reasoning_trace.append({
                        "step": step + 1,
                        "tool": tool_name,
                        "args": tool_args,
                        "result_preview": tool_result[:300] + "..." if len(tool_result) > 300 else tool_result,
                    })

                    messages.append({
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [tc],
                    })
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tool_result,
                    })

            # LLM gave final answer
            elif msg.content:
                # Guard: strip tool-call artifacts from answer
                answer_text = msg.content
                if "<｜" in answer_text or "tool_call" in answer_text:
                    logger.warning(f"Answer contained tool artifacts, retrying without tools")
                    messages.append({"role": "user", "content": "请基于已有检索结果直接给出最终答案，不要调用工具。"})
                    continue
                logger.info(f"Agent final answer at step {step+1}")

                # ─── Self-Reflection: critique the answer ───
                critique = self._critique_answer(query, answer_text, reasoning_trace)
                logger.info(f"Agent self-critique: confidence={critique['confidence']} issues={len(critique['issues'])}")

                # ─── Backtrack on low confidence (max 1 attempt) ───
                if critique["confidence"] == "low" and step < max_steps - 1 and backtrack_count < 1:
                    logger.info(f"Agent backtracking due to low confidence")
                    backtrack_count += 1
                    refined_query = critique.get("refined_query", query)
                    backtrack_result = self._backtrack_search(refined_query, messages)
                    if backtrack_result:
                        reasoning_trace.append({
                            "step": step + 2,
                            "tool": "self_reflect",
                            "args": {"action": "backtrack", "reason": critique["issues"]},
                            "result_preview": backtrack_result[:200],
                        })
                        messages.append({"role": "user", "content": f"补充检索结果:\n{backtrack_result}\n\n请基于以上补充信息和之前检索结果，重新给出更准确的回答。"})
                        continue  # Re-enter the loop for refined answer

                # Extract sources with image URLs
                sources = []
                for t in reversed(reasoning_trace):
                    if t["tool"] == "search_rag" and t.get("result_preview"):
                        try:
                            items = json.loads(t["result_preview"].rstrip("..."))
                            if isinstance(items, list):
                                for item in items:
                                    if isinstance(item, dict) and "source" in item:
                                        src = {"title": item["source"], "type": "文献"}
                                        if item.get("image_url"):
                                            src["image_url"] = item["image_url"]
                                            src["chart_type"] = item.get("type", "image")
                                            src["text_preview"] = item.get("text", "")[:200]
                                        sources.append(src)
                        except Exception:
                            pass
                        break
                return {
                    "answer": answer_text,
                    "reasoning_trace": reasoning_trace,
                    "steps": step + 1,
                    "model": self.model,
                    "sources": sources[:5],
                    "confidence": critique["confidence"],
                    "critique": critique["issues"],
                }

            # Safety: empty response
            else:
                logger.warning(f"Agent empty response at step {step+1}")
                break

        return {
            "answer": "推理未在预定步数内完成，请简化问题重试。",
            "reasoning_trace": reasoning_trace,
            "steps": max_steps,
            "model": self.model,
        }
