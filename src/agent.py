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

SYSTEM_PROMPT = """你是循证医学专家Agent，可使用以下工具检索和分析医学文献。

## 推理规则
1. 收到问题后，先用 search_rag 检索
2. 检索结果不足时，用 deep_retrieve 从多角度补充检索
3. 涉及多篇文献时，用 cross_check 验证结论一致性
4. 对关键文献，用 get_evidence 确认证据等级
5. 如需具体图表数据，用 extract_chart 提取
6. 回答按证据等级排列 (Meta/RCT > Cohort > Expert Consensus)
7. 每个事实标注来源: [文献名, 页码, 证据等级]
8. 使用中文，保留医学术语英文缩写"""

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
        results = self.pipeline._faiss_retrieve(query, top_k=top_k)
        if not results:
            return "未找到相关文献内容。"
        items = []
        for i, r in enumerate(results):
            items.append({
                "ref": i + 1,
                "source": r["source"],
                "score": round(r["score"], 3),
                "text": r["text"][:400],
            })
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

    def run(self, query: str, max_steps: int = 15) -> Dict[str, Any]:
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

        for step in range(max_steps):
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                temperature=0.3,
                max_tokens=1200,
            )

            msg = response.choices[0].message

            # LLM decided to call a tool
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    tool_name = tc.function.name
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
                logger.info(f"Agent final answer at step {step+1}")
                # Extract sources from last search_rag call results
                sources = []
                for t in reversed(reasoning_trace):
                    if t["tool"] == "search_rag" and t.get("result_preview"):
                        try:
                            items = json.loads(t["result_preview"].rstrip("..."))
                            if isinstance(items, list):
                                for item in items:
                                    if isinstance(item, dict) and "source" in item:
                                        sources.append({"title": item["source"], "type": "文献"})
                        except Exception:
                            pass
                        break
                return {
                    "answer": msg.content,
                    "reasoning_trace": reasoning_trace,
                    "steps": step + 1,
                    "model": self.model,
                    "sources": sources[:5],  # top-5 sources
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
