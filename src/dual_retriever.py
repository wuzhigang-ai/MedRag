"""
Vector-FAISS检索引擎 (Simplified from DualRetriever)

适配FAISS后端的检索增强:
1. Dense Vector (BGE-M3 + FAISS) - 语义匹配
2. 证据等级排序 - 高等级证据优先
3. 章节类型过滤 - 按医学结构筛选

去除了LightRAG Graph依赖，保留核心检索+排序逻辑。
"""

import logging
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """单条检索结果"""
    content: str
    score: float = 0.0
    source: str = ""
    doc_id: str = ""
    page_idx: int = 0
    section_tag: str = ""
    evidence_level: int = 7
    evidence_type: str = ""
    chunk_id: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_context(self) -> str:
        evidence_label = self._get_evidence_label()
        header = f"[{evidence_label}] 来源: {self.source}"
        if self.section_tag:
            header += f", 章节: {self.section_tag}"
        return f"{header}\n{self.content}"

    def _get_evidence_label(self) -> str:
        labels = {
            1: "Meta分析/系统综述", 2: "RCT", 3: "队列研究",
            4: "病例对照", 5: "病例报告", 6: "专家共识",
        }
        return labels.get(self.evidence_level, "未知证据")


@dataclass
class QueryContext:
    """查询上下文"""
    query: str
    results: List[SearchResult]
    evidence_summary: str = ""
    consistency_report: str = ""

    def to_llm_prompt(self) -> str:
        parts = [
            "## 检索上下文\n",
            f"查询: {self.query}\n",
        ]

        if self.evidence_summary:
            parts.append(f"\n### 证据概览\n{self.evidence_summary}")

        if self.consistency_report:
            parts.append(f"\n### 一致性评估\n{self.consistency_report}")

        parts.append(f"\n### 检索结果 (共 {len(self.results)} 条)")

        sorted_results = sorted(self.results, key=lambda r: r.evidence_level)

        for i, result in enumerate(sorted_results[:10]):
            parts.append(f"\n--- 结果 {i+1} ---")
            parts.append(result.to_context())

        parts.append(
            "\n\n## 回答要求\n"
            "1. 请基于以上检索结果回答问题\n"
            "2. 给出每个关键事实的来源引用（文献+页码+证据等级）\n"
            "3. 如有多个来源，说明证据是否一致\n"
            "4. 如检索结果不充分，明确指出不确定之处"
        )

        return "\n".join(parts)


class DualRetriever:
    """FAISS向量检索器"""

    def __init__(self, pipeline):
        self.pipeline = pipeline

    def retrieve(
        self,
        query: str,
        top_k: int = 10,
        min_score: float = 0.3,
    ) -> List[SearchResult]:
        """向量检索 + 结果标准化"""
        raw_results = self.pipeline.retrieve(query, top_k=top_k, min_score=min_score)

        results = []
        for r in raw_results:
            meta = r.get("meta", {})
            results.append(SearchResult(
                content=r["text"],
                score=r["score"],
                source=r["source"],
                page_idx=meta.get("page_idx", 0),
                section_tag=meta.get("section_tag", ""),
                evidence_level=meta.get("evidence_level", 7),
                evidence_type=meta.get("evidence_type", ""),
            ))

        # 去重
        seen = set()
        unique = []
        for r in results:
            key = r.content[:100]
            if key not in seen:
                seen.add(key)
                unique.append(r)

        return unique

    def rank_by_evidence(self, results: List[SearchResult]) -> List[SearchResult]:
        """按证据等级重排序"""
        return sorted(results, key=lambda r: (r.evidence_level, -r.score))

    def filter_by_section(
        self, results: List[SearchResult], section_tags: List[str]
    ) -> List[SearchResult]:
        """按医学章节类型过滤"""
        if not section_tags:
            return results
        filtered = [r for r in results if r.section_tag in section_tags]
        return filtered if len(filtered) >= 2 else results

    def search_with_context(
        self,
        query: str,
        kg_summary: str = "",
        consistency_report: str = "",
        top_k: int = 10,
    ) -> QueryContext:
        """检索 + 组装查询上下文"""
        results = self.retrieve(query, top_k=top_k)
        ranked = self.rank_by_evidence(results)

        return QueryContext(
            query=query,
            results=ranked,
            evidence_summary=kg_summary,
            consistency_report=consistency_report,
        )
