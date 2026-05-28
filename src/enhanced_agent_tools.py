"""
增强Agent工具集 — 补充MedASR现有7工具的缺失能力

新增工具:
1. estimate_grade — GRADE证据质量自动评分
2. compare_tables — 跨文献表格数据对比
3. build_consistency_matrix — 多文献一致性矩阵
4. medbench_selfcheck — 答案质量自检
"""

import json
import logging
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


# ─── 增强工具定义 (追加到现有TOOLS列表) ───

ENHANCED_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "estimate_grade",
            "description": "对检索到的医学证据进行GRADE质量评级（高/中/低/极低），给出降级因素和推荐强度。用于证据评估类问题。",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "评估的临床主题"},
                    "doc_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要评估的文献名列表（从search_rag结果的doc字段获取）"
                    },
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_tables",
            "description": "跨文献对比表格中的关键数据（基线特征、结局指标等），发现差异并生成对比矩阵。",
            "parameters": {
                "type": "object",
                "properties": {
                    "doc_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要对比的文献名列表"
                    },
                    "data_type": {
                        "type": "string",
                        "description": "对比数据类型: baseline(基线特征)/outcome(结局指标)/safety(安全性)/all",
                        "enum": ["baseline", "outcome", "safety", "all"]
                    },
                },
                "required": ["doc_names", "data_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "build_consistency_matrix",
            "description": "构建多篇文献关于特定临床结论的一致性分析矩阵，识别一致方向、矛盾点和可能原因。",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "要分析一致性的临床主题（如'β-blockers对TBAD生存获益'）"},
                    "findings_summary": {
                        "type": "string",
                        "description": "各文献的关键结论摘要（从search_rag结果提取），格式: 文献名: 结论"
                    },
                },
                "required": ["topic", "findings_summary"],
            },
        },
    },
]


def execute_enhanced_tool(tool_name: str, args: Dict, pipeline, agent=None) -> str:
    """执行增强工具"""
    if tool_name == "estimate_grade":
        return _tool_estimate_grade(args, pipeline)
    elif tool_name == "compare_tables":
        return _tool_compare_tables(args, pipeline)
    elif tool_name == "build_consistency_matrix":
        return _tool_build_consistency_matrix(args, pipeline)
    else:
        return json.dumps({"error": f"Unknown enhanced tool: {tool_name}"}, ensure_ascii=False)


def _tool_estimate_grade(args: Dict, pipeline) -> str:
    """GRADE证据评级工具"""
    from src.grade_evaluator import GRADEEvaluator, GRADEAssessment

    topic = args.get("topic", "")
    doc_names = args.get("doc_names", [])

    evaluator = GRADEEvaluator()
    assessments = {}

    for doc_name in (doc_names or []):
        # 检索该文献的关键信息
        ret = pipeline.retrieve(doc_name, top_k=3)
        combined_text = " ".join([r.get("text", "") for r in ret])

        # 提取证据类型
        ev_type = "unknown"
        for r in ret:
            meta = r.get("meta", {})
            if meta.get("evidence_type"):
                ev_type = meta["evidence_type"]
                break

        assessment = evaluator.assess_single(
            doc_id=doc_name,
            title=doc_name,
            evidence_type=ev_type,
            key_findings=[combined_text[:2000]],
            pico={},
            effect_data=[],
        )
        assessments[doc_name] = assessment

    if not assessments:
        # 从知识库全局检索相关文献
        ret = pipeline.retrieve(topic, top_k=5)
        all_text = "\n".join([r.get("text", "")[:500] for r in ret])
        assessment = evaluator.assess_single("知识库综合", "知识库综合证据", "mixed", [all_text], {}, [])
        assessments["知识库综合"] = assessment

    # 生成GRADE证据等级表
    profile = GRADEEvaluator.generate_evidence_profile(assessments)

    result = {
        "topic": topic,
        "documents_assessed": len(assessments),
        "evidence_profile": profile,
        "individual_assessments": {},
    }

    for doc_id, a in assessments.items():
        result["individual_assessments"][doc_id] = {
            "grade_level": a.final_label,
            "study_design": a.study_design,
            "downgrade_reasons": a.downgrades.bias_details + a.downgrades.inconsistency_details +
                              a.downgrades.indirectness_details + a.downgrades.imprecision_details +
                              a.downgrades.publication_bias_details,
            "upgrade_reasons": [a.upgrades.large_effect_detail, a.upgrades.dose_response_detail,
                              a.upgrades.residual_confounding_detail],
            "recommendation": a.recommendation_strength,
        }

    return json.dumps(result, ensure_ascii=False, indent=2)


def _tool_compare_tables(args: Dict, pipeline) -> str:
    """跨文献表格数据对比工具"""
    doc_names = args.get("doc_names", [])
    data_type = args.get("data_type", "all")

    if len(doc_names) < 2:
        return json.dumps({"error": "需要至少2篇文献进行对比", "docs_found": len(doc_names)}, ensure_ascii=False)

    doc_data = {}
    for doc_name in doc_names:
        ret = pipeline.retrieve(doc_name, top_k=5)
        tables_found = []
        numeric_data = []

        for r in ret:
            meta = r.get("meta", {})
            text = r.get("text", "")

            if meta.get("type") == "table":
                tables_found.append({
                    "page": meta.get("page_idx", "?"),
                    "content_preview": text[:500],
                })

            # 提取数值数据
            import re
            nums = re.findall(r'(\d+\.?\d*)\s*[%％]', text)
            if nums:
                numeric_data.extend(nums[:5])

        doc_data[doc_name] = {
            "tables_found": len(tables_found),
            "tables": tables_found[:3],
            "numeric_samples": numeric_data[:10],
        }

    return json.dumps({
        "comparison_type": data_type,
        "documents_compared": len(doc_data),
        "comparison_matrix": doc_data,
        "note": "数值数据仅为样本，完整对比需人工核实原文表格。建议使用analyze_image工具提取图表精确数值。",
    }, ensure_ascii=False, indent=2)


def _tool_build_consistency_matrix(args: Dict, pipeline) -> str:
    """多文献一致性矩阵工具"""
    from src.grade_evaluator import ConsistencyMatrixBuilder

    topic = args.get("topic", "")
    findings_text = args.get("findings_summary", "")

    if not topic:
        return json.dumps({"error": "请提供要分析的临床主题"}, ensure_ascii=False)

    # 检索相关文献
    ret = pipeline.retrieve(topic, top_k=8)

    if not ret:
        return json.dumps({"error": "未检索到相关文献"}, ensure_ascii=False)

    matrix = ConsistencyMatrixBuilder.build_matrix(ret, topic)
    return json.dumps(matrix, ensure_ascii=False, indent=2)
