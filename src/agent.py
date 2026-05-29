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

SYSTEM_PROMPT = """你是顶级循证医学AI助手，擅长精准意图识别、复杂多跳推理、高效工具编排。每次回答必须基于知识库检索结果，不可凭空编造。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 一、意图识别 — 先分类，再行动
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

收到问题后，首先判断类型，选择对应策略：

【类型A — 事实查询】"TBAD的诊断标准是什么""XX药物的适应证"
  → 策略: search_rag ×1-2 → 直接回答。简单直接，不需拆解。

【类型B — 比较分析】"A型和B型的治疗策略有何不同""药物A vs 药物B的疗效"
  → 策略: 拆解为N个子问题 → 逐个子问题 search_rag → cross_check 验证一致性 → 综合对比

【类型C — 多因素综合】"老年TBAD患者的血压管理策略"（人群+疾病+治疗+年龄）
  → 策略: deep_retrieve topic="老年TBAD血压管理" aspects=["降压目标","药物选择","预后","安全性"] → 综合
  （注意: aspects 要紧扣问题，不要加无关维度）

【类型D — 数据提取】"某文献中Table 2的具体数据""森林图的效应量"
  → 策略: search_rag 定位文献 → 若结果含 image_url → analyze_image 提取结构化数值
  → extract_chart 仅用于搜索图表相关文本片段，不是提取数值。精确数值靠 analyze_image VLM 提取。

【类型E — 证据评估】"目前TBAD治疗的证据等级如何"
  → 策略: list_docs 获取全局 → search_rag 重点文献 → 综合判断证据等级
  → 证据等级从 search_rag 结果的 evidence_level 字段获取（Meta-analysis / RCT / Cohort / Case-control / Case-series）
  → 注意: 专家共识/指南类文献 evidence_level 可能为 null，需从文献标题或内容推断

● 判断后立即执行，不要在思考中反复纠结。类型判断最多1句话。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 二、多跳推理 — 步步为营，层层深入
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

复杂问题遵循 chain-of-thought 链条：

  拆解 → 搜(子问题1) → 搜(子问题2) → 搜(子问题3)
       → 判断: 结果充分?
           ├─ 是 → cross_check 验证 → 证据排序 → 综合回答
           └─ 否 → deep_retrieve 补充 → 再判断

每一步检索后自问:
  ● 这一步得到了什么新信息?
  ● 还缺什么信息?
  ● 下一步该搜什么? (必须换词, 同义词/英文MeSH术语/缩略语交替)

MeSH 标准词检索映射（中文问题必须同时搜英文术语）:
  ● "主动脉夹层" → 同时搜 "aortic dissection" / "Stanford type B" / "TBAD"
  ● "腔内修复" → 同时搜 "TEVAR" / "endovascular repair" / "thoracic endovascular"
  ● "高血压" → 同时搜 "hypertension" / "antihypertensive" / "blood pressure management"
  ● "心肌梗死" → 同时搜 "myocardial infarction" / "MI" / "STEMI" / "NSTEMI"
  ● "卒中" → 同时搜 "stroke" / "cerebrovascular" / "CVA" / "TIA"
  ● "生存率" → 同时搜 "survival" / "mortality" / "prognosis" / "Kaplan-Meier"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 三、工具编排 — 9个工具，精确触发条件
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  search_rag(faiss_query, lightrag_query, top_k)
    用途: 一次调用同时走FAISS和LightRAG,各自用最优query:
      - faiss_query: 关键词组合(如"TBAD 诊断 CTA 影像") → BGE-M3向量检索
      - lightrag_query: 完整自然语言(如"Type B主动脉夹层的影像学诊断方法有哪些") → LLM实体提取
      - 若用户问题本身就很清晰完整,lightrag_query直接用原问题即可
    返回:
      - graph_context: 知识背景 (仅背景理解, 不可作为引用来源, 可能为 null)
      - text_snippets: 文献检索结果 (永远有值, 含文献名/页码/证据等级, 是唯一引用来源)
    引用规则: 所有 [文献名, 页码] 引用必须来自 text_snippets, 禁止引用 graph_context
    图片能力: 你能通过文献中的图表图片向用户展示数据。text_snippets条目含image_url时即表示该文献有对应图表。用户要求看图时,先search_rag → 若结果有image_url → 可直接展示。你并非"纯文本AI",不要说"无法生成/发送图片"。
    触发: 所有问题类型的第一步。永远是第一个工具。

  deep_retrieve(topic, aspects)
    用途: 一次调用从多个维度系统检索同一主题。比多次 search_rag 更高效。
    触发: 首轮 search_rag 结果<3条，或需要从多个临床角度(疗效/安全性/预后/指南)覆盖同一主题时。
    示例: deep_retrieve("TBAD药物治疗", ["降压目标","β-blocker","钙通道阻滞剂","联合用药","不良反应"])

  cross_check(topic)
    用途: 检测多篇文献结论一致性，发现矛盾。
    触发: search_rag 返回≥2篇文献且涉及同一临床结论时。
    返回: documents_compared(对比的文献), evidence_levels(按证据等级分组), consistency_hint(一致性提示)

  get_evidence(doc_name)
    用途: 查询单篇文献在知识库中的覆盖信息（含多少文本块、覆盖哪些页面、内容类型）。
    触发: 需要了解某文献在知识库中的覆盖范围时。doc_name 从 search_rag 结果的 doc 字段提取。
    注意: 此工具返回文献覆盖信息，不是逐篇证据评级。证据等级从 search_rag 结果的 evidence_level 字段获取。

  list_docs()
    用途: 列出知识库全部文献名称及文本块数量。
    触发: 首次使用本系统、用户问"有哪些文献"、需要判断知识库覆盖范围时。
    策略: 先 list_docs 了解全局 → 再精准 search_rag

  extract_chart(doc_name, chart_hint)
    用途: 搜索文献中与指定图表相关的文本片段（表格标题、图表描述的文字部分）。
    触发: 需要查找文献中是否有某种类型的图表时（如基线表、结局表）。
    注意: 此工具返回文本描述，不是结构化数值。精确数值用 analyze_image 从图片中提取。

  analyze_image(image_path, analysis_hint)
    用途: VLM多模态模型实时分析图表图片，返回结构化JSON数据（效应量/CI/p值/生存率等）。
    触发: search_rag 返回的 source 包含 image_url 字段时。
    黄金法则: 看到 image_url → 立刻 analyze_image。文字描述无法替代VLM提取的精确数值。
    提示构建:
      森林图 → "提取各亚组的 HR 及其 95%CI,异质性 I²,总体效应"
      KM曲线 → "提取2组中位生存期,各时间点生存率,log-rank p值"
      基线表 → "提取2组的基线特征,检查组间均衡性(p值)"
      流程图 → "提取诊断/治疗流程的步骤和判断节点"

  estimate_grade(topic, doc_names)  ← 新增
    用途: 对检索到的医学证据进行GRADE证据质量评级(高/中/低/极低)。
    触发: 类型E(证据评估)问题时必须调用。用户问"证据质量如何"/"GRADE评级"时调用。
    返回: GRADE等级、降级因素(偏倚风险/不一致性/不精确性)、推荐强度(强/弱推荐)。
    注: GRADE是全球医学界公认的证据质量评估标准，比简单的7级分类更科学。

  build_consistency_matrix(topic, findings_summary)  ← 新增
    用途: 构建多文献一致性分析矩阵，自动识别结论方向一致性、矛盾点。
    触发: 多篇文献涉及同一临床结论需要一致性判断时。可替代手动 cross_check 的详细版。
    返回: 一致性判定(高度一致/部分一致/存在矛盾)、各文献结论方向、矛盾分析、证据分布。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 四、Few-Shot 推理示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

示例1: 类型A — 事实查询
  用户: "TBAD的诊断标准是什么"
  思考: 事实查询，不需拆解。
  行动: search_rag("TBAD 诊断标准 aortic dissection diagnostic criteria") → 返回3条结果 → 直接回答
  回答: "TBAD诊断需结合临床+影像。首选CTA... [Stanford B型专家共识(2022), p.3, 专家共识]"

示例2: 类型B — 比较分析
  用户: "比较A型和B型主动脉夹层的治疗策略"
  思考: 比较分析，拆解为2个子问题（A型治疗、B型治疗），检索后综合对比。
  行动:
    Step1: search_rag("A型主动脉夹层 治疗 手术 type A repair") → 返回5条结果
    Step2: search_rag("B型主动脉夹层 治疗 TEVAR medical type B") → 返回6条结果
    Step3: 两轮检索结果已覆盖AB型差异 → 直接综合对比（若有矛盾再调 cross_check）
    Step4: 表格对比核心差异 → 回答

示例3: 类型C — 多因素综合 (deep_retrieve)
  用户: "老年TBAD患者的血压管理策略"
  思考: 多因素综合，涉及人群(老年)+疾病(TBAD)+干预(降压)+预后。用deep_retrieve一次覆盖多个角度。
  行动:
    Step1: deep_retrieve("老年TBAD血压管理", ["降压目标值","药物选择β-blocker","钙通道阻滞剂","低血压风险","预后"]) → 返回多维度结果
    Step2: 信息充分 → 综合回答（若结果<3条则追加 search_rag）

示例4: 类型D — 数据提取 + VLM
  用户: "shchelochkov2019中森林图的效应量"
  思考: 数据提取，先定位文献，再用VLM分析图片。
  行动:
    Step1: search_rag("shchelochkov2019 森林图 forest plot") → 返回结果含 image_url="/images/xxx.png"
    Step2: analyze_image("/images/xxx.png", "提取各亚组的 HR 和95%CI,异质性I²") → 返回结构化JSON
    Step3: 基于VLM提取的精确数值回答

示例5: 类型E — 证据评估
  用户: "目前TBAD治疗的证据等级如何"
  思考: 证据评估，先全局了解再逐篇检索。
  行动:
    Step1: list_docs() → 返回5篇文献概览
    Step2: search_rag("TBAD 治疗 guideline RCT meta-analysis") → 各文献的 evidence_level
    Step3: 按 evidence_level 分组 → 形成证据金字塔 → 回答

示例6: 检索无结果
  用户: "TBAD的流行病学数据"
  思考: 事实查询。
  行动: search_rag("TBAD 流行病学 incidence prevalence") → 返回"未找到相关文献内容"
         search_rag("aortic dissection epidemiology global burden") → 仍未找到
  回答: "已检索: 'TBAD 流行病学' / 'aortic dissection epidemiology' / 'incidence prevalence'
         在5篇文献中均未找到流行病学数据。知识库当前覆盖治疗、预后、分型，不包含流行病学。"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 五、证据综合与回答格式
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 证据金字塔排序（与 search_rag 返回的 evidence_level 字段对应）:
   Meta-analysis > RCT > Cohort > Case-control > Case-series > Expert Consensus(证据等级为null时从标题推断)

2. 矛盾处理 — 不"和稀泥":
   如果2篇文献结论相反，明确指出:
   "文献A(RCT, n=890, 2022)认为X有效,HR=0.65(0.51-0.82)。
    文献B(Cohort, n=120, 2020)未发现显著差异,HR=0.92(0.68-1.24)。
    优先采纳A(证据等级更高, 样本量更大)。B的阴性结果可能源于统计效力不足。"

3. 数值优先:
   "血压显著降低" ❌ → "SBP降低12.3mmHg(95%CI 8.1-16.5, p<0.001)" ✅

4. 不确定时诚实:
   "当前检索到的3篇文献中,2篇支持X,1篇未得出结论。
    证据等级均为队列研究,整体强度中等。需要RCT进一步验证。"

5. 引用格式: [文献名, 页码, 证据等级]
   示例: [Stanford B型主动脉夹层中国专家共识(2022版), p.4, 专家共识]

6. 对比场景用表格:
   | 维度 | A型 | B型 | 证据等级 | 来源 |
   |------|-----|-----|---------|------|
   | 治疗策略 | 手术修复 | TEVAR/药物 | 专家共识 | [文献, p.3] |
"""


# ─── Tool Definitions (OpenAI function-calling format) ───

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_rag",
            "description": "检索医学文献知识库（支持中英文关键词查询）。返回相关文献片段及来源(doc)、页码、章节(section)、证据等级(evidence_level)、图表图片(image_url)。",
            "parameters": {
                "type": "object",
                "properties": {
                    "faiss_query": {"type": "string", "description": "FAISS检索用的关键词组合(中英文均可,如'TBAD 诊断 CTA aortic dissection'),不用完整问句"},
                    "lightrag_query": {"type": "string", "description": "LightRAG用的完整自然语言查询(如'Type B主动脉夹层的影像学诊断方法有哪些'),若用户问题清晰可直接用原问题"},
                    "top_k": {"type": "integer", "description": "返回结果数量，默认5，最多15"},
                },
                "required": ["faiss_query"],
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
            "description": "查询某篇文献在知识库中的覆盖范围（文本块数量、覆盖页码、内容类型分布）。证据等级从search_rag返回的evidence_level字段获取。",
            "parameters": {
                "type": "object",
                "properties": {
                    "doc_name": {"type": "string", "description": "文献名称，从search_rag结果的doc字段提取"},
                },
                "required": ["doc_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_docs",
            "description": "列出知识库中所有已索引的医学文献名称、文本块数量和覆盖页码。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "deep_retrieve",
            "description": "从多个临床角度同时检索同一主题。比多次search_rag更高效，一次调用覆盖诊断/治疗/预后/安全性等多个维度。",
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
            "description": "搜索文献中与指定图表相关的文本片段（表格标题、图表描述等文字内容）。注意:返回的是文本描述，精确数值需用analyze_image从图表图片中提取。",
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
    {
        "type": "function",
        "function": {
            "name": "analyze_image",
            "description": "VLM多模态模型实时分析图表图片，返回结构化JSON（效应量/CI/p值/生存率等）。看到search_rag返回的image_url时应立即调用此工具提取精确数值。",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_path": {"type": "string", "description": "图片URL路径(如/images/xxx.png)"},
                    "analysis_hint": {"type": "string", "description": "分析意图(如'KM曲线的生存差异''Table1两组基线是否均衡''森林图的异质性')"},
                },
                "required": ["image_path", "analysis_hint"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "estimate_grade",
            "description": "对检索到的医学证据进行GRADE证据质量评级（高/中/低/极低），输出降级因素和推荐强度。用于证据评估类问题。",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "评估的临床主题"},
                    "doc_names": {"type": "array", "items": {"type": "string"}, "description": "要评估的文献名（从search_rag的doc字段取）"},
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "build_consistency_matrix",
            "description": "构建多篇文献关于特定临床结论的一致性分析矩阵，识别一致方向、矛盾点和原因。",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "临床主题"},
                    "findings_summary": {"type": "string", "description": "各文献关键结论(从search_rag提取), 格式: 文献名: 结论"},
                },
                "required": ["topic", "findings_summary"],
            },
        },
    },
]


class MedicalAgent:
    """OpenAI Function Calling 驱动的医学RAG Agent"""

    def __init__(self, pipeline: MedicalRAGPipeline):
        import os
        self.pipeline = pipeline
        base_url = os.getenv("AGENT_BASE_URL")
        api_key = os.getenv("AGENT_API_KEY")
        model = os.getenv("AGENT_MODEL")
        if not base_url or not api_key or not model:
            raise RuntimeError("AGENT_BASE_URL, AGENT_API_KEY, and AGENT_MODEL must be set in .env")
        from openai import OpenAI
        self.client = OpenAI(base_url=base_url, api_key=api_key)
        self.model = model
        # Optional fallback client
        fb_url = os.getenv("AGENT_FALLBACK_URL")
        fb_key = os.getenv("AGENT_FALLBACK_KEY")
        fb_model = os.getenv("AGENT_FALLBACK_MODEL")
        if fb_url and fb_key and fb_model:
            self.fallback_client = OpenAI(base_url=fb_url, api_key=fb_key)
            self.fallback_model = fb_model
            logger.info(f"Agent fallback: url={fb_url[:40]}... model={fb_model}")
        else:
            self.fallback_client = None
            self.fallback_model = None
        logger.info(f"Agent initialized: url={base_url[:40]}... model={self.model}")

    # ─── Tool Executors ───────────────────────────────

    def _llm_rerank(self, query: str, candidates: list) -> list | None:
        """LLM relevance scoring: top-10 → LLM batch score → weighted re-rank → top-5.
        Combines vector score (0.3) with LLM relevance score (0.7). Fails silently."""
        if len(candidates) <= 5:
            return None
        try:
            import re as _re
            items_text = []
            for i, r in enumerate(candidates[:10]):
                items_text.append(f"[{i}] (score={r.get('score',0):.2f}) {r['text'][:300]}")
            prompt = f"""对以下{len(items_text)}个文本块按与查询的相关性打分(0-10):
查询: {query}
{chr(10).join(items_text)}
只返回JSON数组: [分数, 分数, ...]"""
            resp = self.client.chat.completions.create(
                model=self.model, messages=[{"role":"user","content":prompt}],
                temperature=0, max_tokens=100, timeout=15.0,
            )
            raw = resp.choices[0].message.content.strip()
            scores = json.loads(_re.sub(r'[^\d,\[\] ]', '', raw))
            for i, r in enumerate(candidates[:10]):
                llm_score = float(scores[i]) / 10.0 if i < len(scores) else 0.5
                vec_score = r.get("score", 0.5)
                r["score"] = vec_score * 0.3 + llm_score * 0.7
                r["_llm_reranked"] = True
            candidates.sort(key=lambda x: x["score"], reverse=True)
            logger.info(f"LLM reranked {len(items_text)} chunks → top score: {candidates[0].get('score',0):.3f}")
            return candidates
        except Exception as e:
            logger.warning(f"LLM rerank failed (falling back to FAISS order): {str(e)[:100]}")
            return None

    def _tool_search_rag(self, args: dict) -> str:
        faiss_query = args.get("faiss_query", args.get("query", ""))
        lightrag_query = args.get("lightrag_query") or faiss_query
        if not isinstance(faiss_query, str) or not faiss_query.strip():
            return json.dumps({"error": "search_rag requires a non-empty faiss_query"}, ensure_ascii=False)
        try:
            top_k = min(int(args.get("top_k", 5)), 15)
        except (ValueError, TypeError):
            top_k = 5

        # ─── Call /api/search via HTTP ───
        try:
            import urllib.request
            payload = {"question": faiss_query, "lightrag_query": lightrag_query, "top_k": top_k}
            data = json.dumps(payload).encode()
            req = urllib.request.Request("http://localhost:8000/api/search",
                data=data, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=35) as resp:
                result = json.loads(resp.read())
            graph = result.get("graph_context")
            snippets = result.get("text_snippets", result.get("sources", []))
            # LLM Reranking: re-rank snippets by combined vector+LLM relevance
            _candidates = [{"score": s.get("score",0), "text": s.get("text","")} for s in snippets]
            _reranked = self._llm_rerank(faiss_query, _candidates)
            if _reranked:
                # Reorder snippets to match reranked order (by score match)
                _score_map = {i: r["score"] for i, r in enumerate(_reranked)}
                snippets.sort(key=lambda s: -_score_map.get(
                    next((i for i, c in enumerate(_candidates) if c["text"] == s.get("text","")), -1), 0))
            if not graph and not snippets:
                return "未找到相关文献内容。"

            output = {}
            if graph:
                output["知识背景"] = {
                    "用途": "帮助理解主题全貌和实体关系, 不可直接引用其文字作为文献来源",
                    "来源": "LightRAG 知识图谱",
                    "内容": graph.get("summary", "")[:600],
                }
            if snippets:
                items = []
                seen_pages = set()
                page_contexts = []
                for s in snippets:
                    item = {
                        "ref": s.get("ref", 0), "source": s.get("source", ""),
                        "doc": s.get("doc", ""), "section": s.get("section", ""),
                        "page_idx": s.get("page_idx"),
                        "evidence_level": self._infer_evidence_level(s.get("text", "")),
                        "score": s.get("score", 0), "text": s.get("text", "")[:500],
                    }
                    if s.get("image_url"):
                        item["image_url"] = s["image_url"]
                    items.append(item)
                    # Parent-page retrieval: chunk as pointer → full page context
                    doc = s.get("doc", "")
                    pid = s.get("page_idx")
                    if pid is not None and (doc, pid) not in seen_pages:
                        seen_pages.add((doc, pid))
                        full_page = self.pipeline.get_page_text(doc, int(pid))
                        if full_page:
                            page_contexts.append({
                                "doc": doc, "page_idx": int(pid),
                                "full_text": full_page[:3000],
                            })
                output["文献证据"] = items
                if page_contexts:
                    output["页面完整上下文"] = page_contexts
                    output["_页面说明"] = "'页面完整上下文'包含命中chunk所在页的完整文本(含表格数据和图表描述),可用于提取chunk中未覆盖的精确数值。"
                output["_引用规则"] = "'知识背景'用于理解主题,'文献证据'用于引用来源。只有'文献证据'中的条目可以作为 [文献名, 页码] 引用。"
            return json.dumps(output, ensure_ascii=False, indent=2)
        except Exception:
            pass  # Fallback below

        # Direct FAISS fallback
        results = self.pipeline._doc_aware_retrieve(faiss_query, top_k=top_k)
        # LLM Reranking
        _reranked = self._llm_rerank(faiss_query, results)
        if _reranked:
            results = _reranked[:5]
        if not results:
            return "未找到相关文献内容。"
        items = []
        seen_pages = set()
        page_contexts = []
        for i, r in enumerate(results):
            meta = r.get("meta", {})
            pid = meta.get("page_idx")
            doc = r["source"].split(" [p.")[0] if " [p." in r["source"] else r["source"]
            item = {
                "ref": i + 1, "source": r["source"],
                "doc": doc, "page_idx": pid,
                "section": meta.get("section_tag", ""),
                "evidence_level": self._infer_evidence_level(r["text"]),
                "score": round(r["score"], 3), "text": r["text"][:500],
            }
            if meta.get("image_url"):
                item["image_url"] = meta["image_url"]
            items.append(item)
            # Parent-page retrieval
            if pid is not None and (doc, pid) not in seen_pages:
                seen_pages.add((doc, pid))
                full_page = self.pipeline.get_page_text(doc, int(pid))
                if full_page:
                    page_contexts.append({
                        "doc": doc, "page_idx": int(pid),
                        "full_text": full_page[:3000],
                    })
        output = {"文献证据": items}
        if page_contexts:
            output["页面完整上下文"] = page_contexts
        return json.dumps(output, ensure_ascii=False, indent=2)

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

    def _tool_estimate_grade(self, args: dict) -> str:
        """GRADE证据质量评级"""
        from src.grade_evaluator import GRADEEvaluator
        topic = args.get("topic", "")
        doc_names = args.get("doc_names", [])
        evaluator = GRADEEvaluator()
        assessments = {}
        if doc_names:
            for doc_name in doc_names:
                ret = self.pipeline._faiss_retrieve(doc_name, top_k=3)
                if ret:
                    combined = " ".join([r["text"][:1000] for r in ret])
                    ev_type = self._infer_evidence_level(combined) or "unknown"
                    a = evaluator.assess_single(doc_name, doc_name, ev_type, [combined], {}, [])
                    assessments[doc_name] = a
        if not assessments:
            ret = self.pipeline._faiss_retrieve(topic, top_k=5)
            all_text = " ".join([r["text"][:600] for r in ret])
            ev_type = self._infer_evidence_level(all_text) or "mixed"
            a = evaluator.assess_single("综合", "知识库综合证据", ev_type, [all_text], {}, [])
            assessments["综合"] = a
        profile = GRADEEvaluator.generate_evidence_profile(assessments)
        details = {}
        for doc_id, a in assessments.items():
            details[doc_id] = {
                "GRADE等级": a.final_label,
                "初始设计": a.study_design,
                "降级原因": [
                    f"偏倚风险({a.downgrades.risk_of_bias}): {', '.join(a.downgrades.bias_details) or '无'}",
                    f"不一致性({a.downgrades.inconsistency}): {', '.join(a.downgrades.inconsistency_details) or '无'}",
                    f"不精确性({a.downgrades.imprecision}): {', '.join(a.downgrades.imprecision_details) or '无'}",
                ],
                "推荐强度": a.recommendation_strength,
            }
        return json.dumps({
            "topic": topic, "documents_assessed": len(assessments),
            "evidence_profile": profile, "individual": details,
            "GRADE说明": "高(4级)=进一步研究极不可能改变确信度 | 中(3级)=可能改变 | 低(2级)=很可能改变 | 极低(1级)=非常不确定",
        }, ensure_ascii=False, indent=2)

    def _tool_build_consistency_matrix(self, args: dict) -> str:
        """多文献一致性矩阵"""
        from src.grade_evaluator import ConsistencyMatrixBuilder
        topic = args.get("topic", "")
        ret = self.pipeline._faiss_retrieve(topic, top_k=8)
        if not ret:
            return json.dumps({"error": "未检索到相关文献"}, ensure_ascii=False)
        matrix = ConsistencyMatrixBuilder.build_matrix(ret, topic)
        return json.dumps(matrix, ensure_ascii=False, indent=2)

    def _tool_analyze_image(self, args: dict) -> str:
        """实时调用 Moonshot VLM 提取医学图表结构化数据（效应量+CI+p值）"""
        import base64, os
        image_path = args.get("image_path", "")
        analysis_hint = args.get("analysis_hint", "")
        if not image_path:
            return json.dumps({"error": "image_path is required"}, ensure_ascii=False)

        # Resolve URL path → local file path
        if image_path.startswith("/images/"):
            local_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "images", os.path.basename(image_path)
            )
        else:
            local_path = image_path

        if not os.path.exists(local_path):
            return json.dumps({"error": f"Image not found: {image_path}"}, ensure_ascii=False)

        try:
            b64 = base64.b64encode(open(local_path, "rb").read()).decode()
        except Exception:
            return json.dumps({"error": "Failed to read image file"}, ensure_ascii=False)

        # ─── Step 1: classify chart type ───
        client = self.pipeline.clients.get("moonshot_vision")
        if not client:
            return json.dumps({"error": "VLM client not available"}, ensure_ascii=False)
        model = self.pipeline.PROVIDERS.get("moonshot_vision", {}).get("model", "moonshot-v1-128k-vision-preview")

        classify_prompt = f"""判断这张医学图表的类型。分析意图: {analysis_hint}
类型选项: baseline_table(基线特征表) / outcome_table(结局指标表) / forest_plot(森林图/亚组分析) / km_curve(Kaplan-Meier生存曲线) / flowchart(流程图) / other
只回复类型名称。"""
        try:
            resp = client.chat.completions.create(
                model=model, temperature=0.1, max_tokens=30,
                messages=[{"role":"user","content":[
                    {"type":"text","text":classify_prompt},
                    {"type":"image_url","image_url":{"url":f"data:image/png;base64,{b64}"}},
                ]}])
            chart_type = resp.choices[0].message.content.strip().lower()
        except Exception:
            chart_type = "other"

        # ─── Step 2: specialized medical prompt per chart type ───
        prompts = {
            "baseline_table": """深度解析这张临床基线特征表。提取患者人群、分组、各变量数值。
输出JSON:
{"chart_type":"baseline_table","study_groups":["组1","组2"],"total_patients":0,
 "characteristics":[{"variable":"变量名","group1_value":"","group2_value":"","p_value":"","clinical_note":""}],
 "balance_assessment":"组间均衡性评估","summary":"一句话总结"}""",

            "outcome_table": """深度解析这张临床结局指标表。提取效应量(RR/OR/HR)、95%CI、p值。
输出JSON:
{"chart_type":"outcome_table",
 "outcomes":[{"outcome_name":"","effect_measure":"RR/OR/HR","effect_value":0.0,
   "ci_lower":0.0,"ci_upper":0.0,"p_value":0.0,"direction":"favor_intervention/favor_control",
   "interpretation":""}],
 "primary_endpoint_met":false,"summary":""}""",

            "forest_plot": """深度解析这张森林图。提取各亚组的效应量、CI、交互p值。
输出JSON:
{"chart_type":"forest_plot",
 "overall_effect":{"measure":"HR/OR/RR","value":0.0,"ci_lower":0.0,"ci_upper":0.0,"p_value":0.0},
 "subgroups":[{"subgroup_name":"","n":0,"effect_value":0.0,"ci_lower":0.0,"ci_upper":0.0,"p_interaction":""}],
 "heterogeneity":"异质性评估","summary":""}""",

            "km_curve": """深度解析这张Kaplan-Meier生存曲线。提取各时间点生存率、中位生存期、HR、log-rank p值。
输出JSON:
{"chart_type":"km_curve","groups":["组1","组2"],
 "survival_at":[{"timepoint":"","group1":"","group2":""}],
 "median_survival":{"group1":"","group2":""},
 "hr":{"value":0.0,"ci_lower":0.0,"ci_upper":0.0,"p_value":0.0},
 "log_rank_p":"","interpretation":""}""",

            "flowchart": """分析这张流程图。提取步骤、判断节点、终点。
输出JSON:
{"chart_type":"flowchart","steps":[{"step":1,"description":"","criteria":"","next":""}],
 "start":"","endpoints":[],"summary":""}""",
        }

        prompt = prompts.get(chart_type, f"""分析这张医学图表。意图:{analysis_hint}
输出JSON: {{"chart_type":"{chart_type}","key_findings":"","description":"","clinical_significance":""}}""")

        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role":"user","content":[
                    {"type":"text","text":prompt},
                    {"type":"image_url","image_url":{"url":f"data:image/png;base64,{b64}"}},
                ]}],
                temperature=0.3, max_tokens=600,
            )
            raw = resp.choices[0].message.content.strip()
            if "```json" in raw: raw = raw[raw.find("```json")+7:]
            if "```" in raw: raw = raw[:raw.rfind("```")]
            result = json.loads(raw)
            result["_vlm_chart_type"] = chart_type
            return json.dumps(result, ensure_ascii=False, indent=2)
        except Exception as e:
            return json.dumps({"error": f"VLM analysis failed: {str(e)[:150]}"}, ensure_ascii=False)

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

    @staticmethod
    def _extract_sources(trace: list) -> list:
        """Extract sources from reasoning trace, supports both flat list and new dict format."""
        sources = []
        for t in reversed(trace):
            if t["tool"] not in ("search_rag", "self_reflect"):
                continue
            preview = t.get("result_preview", "")
            if not preview:
                continue
            try:
                raw = preview.rstrip("...")
                data = json.loads(raw)
                items = []
                # Handle new format: {"知识背景": {...}, "原文片段": [...]}
                if isinstance(data, dict):
                    snippets = data.get("文献证据", data.get("text_snippets", []))
                    if isinstance(snippets, list):
                        items = snippets
                elif isinstance(data, list):
                    items = data
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
        return sources[:8]

    def execute_tool(self, tool_name: str, args: dict) -> str:
        """分发 tool call 到对应执行器"""
        handlers = {
            "search_rag": self._tool_search_rag,
            "cross_check": self._tool_cross_check,
            "get_evidence": self._tool_get_evidence,
            "list_docs": self._tool_list_docs,
            "deep_retrieve": self._tool_deep_retrieve,
            "extract_chart": self._tool_extract_chart,
            "analyze_image": self._tool_analyze_image,
            "estimate_grade": self._tool_estimate_grade,
            "build_consistency_matrix": self._tool_build_consistency_matrix,
        }
        handler = handlers.get(tool_name)
        if handler:
            return handler(args)
        return json.dumps({"error": f"Unknown tool: {tool_name}"})

    def _faiss_fallback(self, query: str, trace: list, error: str) -> dict:
        """Fallback: FAISS direct retrieval WITHOUT LLM. Pure text snippets as answer."""
        logger.info(f"Agent FAISS fallback (no LLM) for: {query[:60]}")
        try:
            results = self.pipeline._doc_aware_retrieve(query, top_k=8)
            if not results:
                return {
                    "answer": f"抱歉，当前无法处理您的请求。Agent推理引擎和FAISS检索均不可用。\n错误: {error}",
                    "reasoning_trace": trace, "steps": len(trace),
                    "model": "FAISS-fallback", "sources": [],
                    "confidence": "fallback",
                    "critique": [f"Agent LLM unavailable: {error}"],
                }
            # Build answer from raw FAISS results — no LLM needed
            lines = ["## 检索结果 (FAISS 直接检索，未经过 LLM 推理)\n"]
            for i, r in enumerate(results[:5]):
                src = r["source"]
                text = r["text"][:400]
                lines.append(f"**来源 {i+1}**: {src}\n> {text}\n")
            lines.append(f"\n> ⚠️ Agent 推理引擎暂时不可用 ({error[:80]}...)")
            lines.append("> 以上为知识库直接检索结果，仅供参考。")
            return {
                "answer": "\n".join(lines),
                "reasoning_trace": trace,
                "steps": len(trace),
                "model": "FAISS-fallback",
                "sources": [{"title": r["source"], "type": "文献",
                    "image_url": r.get("meta", {}).get("image_url"),
                    "text_preview": r.get("text", "")[:200]} for r in results[:5]],
                "confidence": "fallback",
                "critique": [f"Agent LLM unavailable: {error}"],
            }
        except Exception as e2:
            return {
                "answer": f"抱歉，当前无法处理您的请求。Agent推理引擎不可用，FAISS检索也失败。\n请稍后重试或联系管理员。",
                "reasoning_trace": trace, "steps": len(trace),
                "model": "none", "sources": [],
                "confidence": "failed",
                "critique": [f"Agent: {error}", f"FAISS: {str(e2)[:120]}"],
            }

    # ─── Agent Loop ───────────────────────────────────

    def run(self, query: str, max_steps: int = 20,
            conversation_history: list = None,
            on_step: callable = None) -> Dict[str, Any]:
        """
        Agent 多跳推理循环 — 支持多轮对话和复杂医学问题:
        1. LLM 拆解问题 → 分层检索 → 交叉验证 → 证据综合
        2. conversation_history: [{"q":"...","a":"..."}, ...] 近3轮对话上下文
        3. 最多 20 步, 检索 5 次后强制给出答案
        4. 低置信度时自动回溯重搜 (最多 2 次)
        5. on_step(step_info): 可选回调, 每完成一个工具调用立即通知 (用于SSE流式)
        """
        self._on_step = on_step  # store for use by execute_tool
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        # Inject conversation history for multi-turn context
        if conversation_history:
            for turn in conversation_history[-3:]:  # Keep last 3 turns
                if turn.get("q"):
                    messages.append({"role": "user", "content": turn["q"]})
                if turn.get("a"):
                    messages.append({"role": "assistant", "content": turn["a"][:500]})
        messages.append({"role": "user", "content": query})
        reasoning_trace = []
        search_count = 0
        backtrack_count = 0

        for step in range(max_steps):
            # After 5 searches: force final answer
            force_answer = search_count >= 5
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    tools=[] if force_answer else TOOLS,
                    tool_choice="none" if force_answer else "auto",
                    temperature=0.3,
                    max_tokens=1500,
                    timeout=60.0,
                )
            except Exception as e:
                logger.warning(f"Agent LLM failed at step {step+1}: {e}")
                # Try fallback client first (if configured)
                if self.fallback_client and step == 0:
                    logger.info("Primary LLM failed, trying AGENT_FALLBACK for this request...")
                    try:
                        fb_client = self.fallback_client
                        fb_model = self.fallback_model
                        response = fb_client.chat.completions.create(
                            model=fb_model,
                            messages=messages,
                            tools=TOOLS if not force_answer else [],
                            tool_choice="none" if force_answer else "auto",
                            temperature=0.3,
                            max_tokens=1500,
                            timeout=60.0,
                        )
                        msg = response.choices[0].message
                        if msg.tool_calls:
                            for tc in msg.tool_calls:
                                tool_name = tc.function.name
                                if tool_name in ("search_rag", "deep_retrieve"):
                                    search_count += 1
                                tool_args = json.loads(tc.function.arguments)
                                tool_result = self.execute_tool(tool_name, tool_args)
                                reasoning_trace.append({
                                    "step": step + 1, "tool": tool_name,
                                    "args": tool_args, "result_preview": tool_result[:500],
                                })
                                messages.append({"role": "assistant", "content": None, "tool_calls": [tc]})
                                messages.append({"role": "tool", "tool_call_id": tc.id, "content": tool_result})
                            continue
                        elif msg.content:
                            critique = self._critique_answer(query, msg.content, reasoning_trace)
                            return {
                                "answer": msg.content, "reasoning_trace": reasoning_trace,
                                "steps": step + 1, "model": f"fallback:{fb_model}",
                                "sources": self._extract_sources(reasoning_trace),
                                "confidence": critique["confidence"], "critique": critique["issues"],
                            }
                    except Exception as fb_e:
                        logger.warning(f"AGENT_FALLBACK also failed: {fb_e}")
                # Both primary and fallback failed → FAISS direct retrieval
                return self._faiss_fallback(query, reasoning_trace, str(e)[:120])

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

                    preview = tool_result
                    if tool_name != "search_rag" and len(tool_result) > 300:
                        preview = tool_result[:300] + "..."
                    reasoning_trace.append({
                        "step": step + 1,
                        "tool": tool_name,
                        "args": tool_args,
                        "result_preview": preview,
                    })

                    # Real-time streaming callback for SSE
                    if self._on_step:
                        try:
                            self._on_step({
                                "type": "step",
                                "step": step + 1,
                                "tool": tool_name,
                                "args": tool_args,
                                "preview": preview,
                            })
                        except Exception:
                            pass

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
                if critique["confidence"] == "low" and step < max_steps - 1 and backtrack_count < 2:
                    logger.info(f"Agent backtracking due to low confidence")
                    backtrack_count += 1
                    refined_query = critique.get("refined_query", query)
                    backtrack_result = self._backtrack_search(refined_query, messages)
                    if backtrack_result:
                        reasoning_trace.append({
                            "step": step + 1,
                            "tool": "self_reflect",
                            "args": {"action": "backtrack", "reason": critique["issues"]},
                            "result_preview": backtrack_result,
                        })
                        if self._on_step:
                            try:
                                self._on_step({
                                    "type": "step",
                                    "step": step + 1,
                                    "tool": "self_reflect",
                                    "args": {"action": "backtrack", "reason": critique.get("issues",[])},
                                    "preview": backtrack_result[:300] if backtrack_result else "",
                                })
                            except Exception:
                                pass
                        messages.append({"role": "user", "content": f"补充检索结果:\n{backtrack_result}\n\n请基于以上补充信息和之前检索结果，重新给出更准确的回答。"})
                        continue  # Re-enter the loop for refined answer

                return {
                    "answer": answer_text,
                    "reasoning_trace": reasoning_trace,
                    "steps": step + 1,
                    "model": self.model,
                    "sources": self._extract_sources(reasoning_trace),
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
