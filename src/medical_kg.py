"""
医学知识图谱增强模块 (Medical Knowledge Graph Enhancement)

在LightRAG GraphRAG基础上叠加医学领域知识，实现：
1. 证据等级自动标记（Meta > RCT > Cohort > Case Report > Expert Consensus）
2. 医学实体间关系补充（药物-适应症、治疗-结局、干预-效果）
3. 跨文献结论一致性检测
4. 证据链网络构建
"""

import json
import logging
from typing import Dict, List, Any, Optional, Set, Tuple
from dataclasses import dataclass, field
from enum import IntEnum

logger = logging.getLogger(__name__)

class EvidenceLevel(IntEnum):
    META_ANALYSIS = 1
    SYSTEMATIC_REVIEW = 1
    RCT = 2
    COHORT = 3
    CASE_CONTROL = 4
    CASE_REPORT = 5
    EXPERT_CONSENSUS = 6
    GUIDELINE = 6
    UNKNOWN = 7

    @classmethod
    def from_str(cls, s: str) -> "EvidenceLevel":
        s = s.lower().replace("-", "_")
        mapping = {
            "meta_analysis": cls.META_ANALYSIS,
            "systematic_review": cls.SYSTEMATIC_REVIEW,
            "rct": cls.RCT,
            "randomized_controlled_trial": cls.RCT,
            "cohort": cls.COHORT,
            "cohort_study": cls.COHORT,
            "case_control": cls.CASE_CONTROL,
            "case_report": cls.CASE_REPORT,
            "case_series": cls.CASE_REPORT,
            "expert_consensus": cls.EXPERT_CONSENSUS,
            "guideline": cls.GUIDELINE,
            "consensus": cls.EXPERT_CONSENSUS,
        }
        return mapping.get(s, cls.UNKNOWN)

@dataclass
class MedicalEntity:
    """医学知识实体"""
    name: str
    entity_type: str  # disease / drug / procedure / biomarker / outcome
    normalized_name: str = ""
    synonyms: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class MedicalRelation:
    """医学实体关系"""
    source: str
    target: str
    relation_type: str  # treats / causes / measures / compares / adverse_effect
    evidence_level: EvidenceLevel = EvidenceLevel.UNKNOWN
    confidence: float = 0.5
    source_doc: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class EvidenceNode:
    """证据节点"""
    doc_id: str
    doc_title: str
    evidence_level: EvidenceLevel
    evidence_type: str
    key_findings: List[str] = field(default_factory=list)
    pico: Dict[str, str] = field(default_factory=dict)
    effect_sizes: List[Dict] = field(default_factory=list)

@dataclass
class ConsistencyReport:
    """跨文献一致性报告"""
    topic: str
    agreements: List[Dict] = field(default_factory=list)
    disagreements: List[Dict] = field(default_factory=list)
    evidence_graded: bool = False
    overall_assessment: str = ""


class MedicalKnowledgeGraph:
    """医学知识图谱增强器"""

    def __init__(self, llm_model_func):
        self.llm = llm_model_func
        self.entities: Dict[str, MedicalEntity] = {}
        self.relations: List[MedicalRelation] = []
        self.evidence_nodes: Dict[str, EvidenceNode] = {}

    def add_document_evidence(
        self,
        doc_id: str,
        doc_title: str,
        evidence_type: str,
        evidence_level: int,
        pico: Dict[str, str],
        key_findings: List[str] = None,
    ) -> EvidenceNode:
        """注册文献证据节点"""
        node = EvidenceNode(
            doc_id=doc_id,
            doc_title=doc_title,
            evidence_level=EvidenceLevel(evidence_level),
            evidence_type=evidence_type,
            pico=pico,
            key_findings=key_findings or [],
        )
        self.evidence_nodes[doc_id] = node
        return node

    def add_relation(
        self,
        source: str, target: str,
        relation_type: str,
        evidence_level: EvidenceLevel = EvidenceLevel.UNKNOWN,
        source_doc: str = "",
        confidence: float = 0.5,
    ) -> MedicalRelation:
        """添加医学关系"""
        rel = MedicalRelation(
            source=source, target=target,
            relation_type=relation_type,
            evidence_level=evidence_level,
            source_doc=source_doc,
            confidence=confidence,
        )
        self.relations.append(rel)
        return rel

    def build_evidence_chain(
        self, topic: str
    ) -> List[EvidenceNode]:
        """按证据等级构建证据链"""
        relevant = [
            node for node in self.evidence_nodes.values()
            if topic.lower() in json.dumps(node.pico, ensure_ascii=False).lower()
            or topic.lower() in " ".join(node.key_findings).lower()
        ]
        relevant.sort(key=lambda n: n.evidence_level.value)
        return relevant

    def get_highest_evidence(
        self, topic: str
    ) -> Optional[EvidenceNode]:
        """获取某主题的最高等级证据"""
        chain = self.build_evidence_chain(topic)
        return chain[0] if chain else None

    async def detect_consistency(
        self, topic: str
    ) -> ConsistencyReport:
        """检测跨文献结论一致性"""
        relevant = self.build_evidence_chain(topic)

        if len(relevant) < 2:
            return ConsistencyReport(
                topic=topic,
                overall_assessment="文献不足 (<2篇)，无法进行一致性评估"
            )

        findings_text = ""
        for node in relevant:
            findings_text += f"\n文献: {node.doc_title} (证据等级: {node.evidence_level.name})\n"
            findings_text += f"结论: {'; '.join(node.key_findings)}\n"

        prompt = f"""请评估以下多篇医学文献关于同一个主题的结论一致性。

## 主题
{topic}

## 文献结论
{findings_text}

## 输出JSON
{{
    "agreements": [
        {{"point": "一致的观点", "docs": ["文献1", "文献2"]}}
    ],
    "disagreements": [
        {{"point": "矛盾的观点", "doc_a": "文献1的结论", "doc_b": "文献2的结论", "resolution": "可能的解释"}}
    ],
    "overall_assessment": "整体一致性评估（一致/部分一致/存在矛盾）",
    "recommendation": "基于证据等级的综合建议"
}}
"""

        try:
            response = await self.llm(prompt)
            json_str = response.strip()
            if "```json" in json_str:
                json_str = json_str[json_str.find("```json") + 7:]
            if "```" in json_str:
                json_str = json_str[:json_str.rfind("```")]
            data = json.loads(json_str.strip())
            return ConsistencyReport(
                topic=topic,
                agreements=data.get("agreements", []),
                disagreements=data.get("disagreements", []),
                evidence_graded=len(relevant) > 0,
                overall_assessment=data.get("overall_assessment", ""),
            )
        except Exception as e:
            logger.error(f"Consistency detection failed: {e}")
            return ConsistencyReport(
                topic=topic,
                overall_assessment=f"一致性分析失败: {str(e)}"
            )

    def get_evidence_summary(self) -> Dict[str, Any]:
        """生成证据全景图"""
        by_level = {}
        for node in self.evidence_nodes.values():
            level_name = node.evidence_level.name
            if level_name not in by_level:
                by_level[level_name] = []
            by_level[level_name].append(node.doc_title)

        return {
            "total_documents": len(self.evidence_nodes),
            "by_evidence_level": {k: len(v) for k, v in by_level.items()},
            "documents_by_level": by_level,
            "total_relations": len(self.relations),
            "relation_types": list(set(r.relation_type for r in self.relations)),
        }

    def to_context_text(self) -> str:
        """将知识图谱转化为检索增强上下文文本"""
        parts = []
        summary = self.get_evidence_summary()
        parts.append(f"知识库共{summary['total_documents']}篇文献")

        # 证据分布
        for level, count in sorted(summary['by_evidence_level'].items()):
            if level != "UNKNOWN":
                parts.append(f"证据等级{level}: {count}篇")

        # 关键关系
        if self.relations:
            parts.append("\n关键医学关系:")
            for rel in self.relations[:20]:
                parts.append(f"  {rel.source} --[{rel.relation_type}]--> {rel.target}")

        return "\n".join(parts)


class EnhancedContentInjector:
    """增强版内容注入器 - 将医学KG信息注入RAG-Anything content_list"""

    @staticmethod
    def inject_evidence_metadata(
        content_list: List[Dict[str, Any]],
        kg: MedicalKnowledgeGraph,
        doc_id: str,
    ) -> List[Dict[str, Any]]:
        """为content_list注入证据等级和KG元数据"""
        node = kg.evidence_nodes.get(doc_id)
        if not node:
            return content_list

        # 为每个text块添加证据元数据
        for item in content_list:
            if item.get("type") == "text":
                if "_chunk_meta" not in item:
                    item["_chunk_meta"] = {}
                item["_chunk_meta"]["evidence_level"] = node.evidence_level.value
                item["_chunk_meta"]["evidence_type"] = node.evidence_type
                item["_chunk_meta"]["doc_title"] = node.doc_title

        return content_list

    @staticmethod
    def build_evidence_prefix(doc: Any) -> str:
        """为检索结果构建证据等级前缀"""
        level = getattr(doc, 'evidence_level', None)
        if level is None:
            return ""

        evidence_labels = {
            1: "[Meta分析/系统综述] 最高等级证据",
            2: "[随机对照试验(RCT)] 高等级证据",
            3: "[队列研究] 中等证据",
            4: "[病例对照研究] 中低等证据",
            5: "[病例报告/病例系列] 低等级证据",
            6: "[专家共识/指南] 权威共识",
        }
        return evidence_labels.get(
            level.value if hasattr(level, 'value') else level,
            "[证据等级待定]"
        )