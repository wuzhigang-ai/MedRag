"""
医学语义分块引擎 (Medical Semantic Chunking Engine) v2

规则优先策略: 基于章节标题关键词进行分段 + LLM增强仅用于摘要/结论的PICO提取
大幅减少API调用次数，同时保留医学结构信息
"""

import re
import json
import logging
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# 章节标题关键词 → 医学结构标签
SECTION_KEYWORDS = {
    "background": ["背景", "引言", "前言", "绪论", "background", "introduction"],
    "objective": ["目的", "目标", "研究目的", "objective", "aim", "purpose"],
    "methods": ["方法", "材料与方法", "资料与方法", "研究对象与方法",
                 "methods", "materials and methods", "patients and methods"],
    "population": ["纳入标准", "排除标准", "入排标准", "研究对象", "患者选择",
                   "inclusion criteria", "exclusion criteria", "eligibility",
                   "纳入", "排除", "入选标准"],
    "intervention": ["干预", "治疗", "手术", "药物", "方案",
                     "intervention", "treatment", "therapy", "regimen"],
    "primary_outcome": ["主要结局", "主要终点", "主要指标", "主要疗效",
                        "primary endpoint", "primary end point", "primary outcome"],
    "secondary_outcome": ["次要结局", "次要终点", "次要指标",
                          "secondary endpoint", "secondary outcome"],
    "subgroup_analysis": ["亚组", "分层分析", "子组", "subgroup", "stratified"],
    "sensitivity_analysis": ["敏感性分析", "敏感度分析", "sensitivity analysis",
                              "sensitivity analyses", "稳健性检验", "robustness"],
    "safety": ["安全性", "不良事件", "不良反应", "并发症",
               "safety", "adverse event", "adverse effect", "complication"],
    "results": ["结果", "结局", "疗效", "results", "outcomes", "findings"],
    "discussion": ["讨论", "分析", "discussion", "analysis"],
    "conclusion": ["结论", "总结", "小结", "展望", "conclusion", "summary"],
    "statistical": ["统计学", "统计分析", "统计方法", "样本量",
                    "statistical analysis", "sample size"],
}


EVIDENCE_KEYWORDS = {
    "meta_analysis": ["meta分析", "荟萃分析", "系统综述", "系统评价",
                      "meta-analysis", "systematic review", "meta analysis"],
    "rct": ["随机对照", "随机双盲", "RCT", "randomized controlled trial",
            "随机分组", "随机临床试验"],
    "cohort_study": ["队列研究", "前瞻性研究", "回顾性队列",
                     "cohort study", "prospective cohort"],
    "case_control": ["病例对照", "case-control", "病例-对照"],
    "case_report": ["病例报告", "病例系列", "个案报道", "case report", "case series"],
    "expert_consensus": ["专家共识", "临床指南", "指导原则",
                         "expert consensus", "guideline", "consensus"],
    "narrative_review": ["综述", "文献综述", "narrative review", "review article"],
}

PICO_EXTRACTION_PROMPT = """你是临床流行病学专家。从以下文献摘要/结论中提取PICO框架，输出JSON。

P = Population（研究人群）
I = Intervention（干预措施）
C = Comparison（对照）
O = Outcome（结局指标）

文献内容：
{content}

输出JSON（不要其他内容）：
{{"population": "...", "intervention": "...", "comparison": "...", "outcome": "...",
  "evidence_type": "RCT/Cohort/Meta/Expert_Consensus/etc", "evidence_level": 1-7}}"""


@dataclass
class SemanticChunk:
    chunk_id: str
    section_tag: str
    content: str
    pico_dimension: Optional[str] = None
    medical_entities: List[str] = field(default_factory=list)
    evidence_level: Optional[int] = None
    page_range: tuple = (0, 0)
    source_file: str = ""
    parent_section: Optional[str] = None


@dataclass
class MedicalDocument:
    doc_id: str
    title: str = ""
    evidence_level: Optional[int] = None
    evidence_type: str = ""
    pico: Dict[str, str] = field(default_factory=dict)
    sections: List[SemanticChunk] = field(default_factory=list)


class MedicalChunker:
    """医学语义分块器 v3 — LLM精准分类 + 规则兜底"""

    SECTION_LABELS = [
        "primary_outcome", "secondary_outcome", "subgroup_analysis",
        "sensitivity_analysis", "safety", "population", "intervention",
        "statistical", "methods", "results", "objective",
        "discussion", "conclusion", "background",
    ]

    def __init__(self, llm_model_func=None):
        self.llm = llm_model_func

    def classify_section(self, text: str) -> str:
        """基于关键词规则进行章节分类（子结构优先，无LLM调用）"""
        text_lower = text[:300].lower()

        # Phase 1: check sub-structure tags first (most specific)
        sub_tags = ["primary_outcome", "secondary_outcome", "subgroup_analysis",
                    "sensitivity_analysis", "safety", "population", "intervention"]
        for tag in sub_tags:
            for kw in SECTION_KEYWORDS.get(tag, []):
                if kw.lower() in text_lower:
                    return tag

        # Phase 2: broad section tags as fallback
        broad_tags = ["statistical", "methods", "results", "objective",
                      "discussion", "conclusion", "background"]
        for tag in broad_tags:
            for kw in SECTION_KEYWORDS.get(tag, []):
                if kw.lower() in text_lower:
                    return tag

        return "results"

    def classify_section_llm(self, text: str) -> str:
        """LLM精准分类（用于语义关键文本块）"""
        if not self.llm or not text.strip():
            return self.classify_section(text)
        try:
            prompt = f"""你是医学文献结构化专家。判断以下文本属于哪个章节类型。
类型列表: primary_outcome(主要结局) / secondary_outcome(次要结局) /
subgroup_analysis(亚组分析) / sensitivity_analysis(敏感性分析) /
safety(安全性) / population(人群) / intervention(干预) /
statistical(统计方法) / methods(方法) / results(结果) /
discussion(讨论) / conclusion(结论) / background(背景)

只回复类型名称，不要解释。

文本: {text[:300]}"""
            resp = self.llm(prompt)
            label = resp.strip().lower()
            if label in self.SECTION_LABELS:
                return label
        except Exception:
            pass
        return self.classify_section(text)

    def classify_batch_llm(self, texts: list) -> list:
        """LLM批量分类（减少API调用）"""
        if not self.llm or not texts:
            return [self.classify_section(t) for t in texts]
        try:
            items = "\n\n".join(f"[{i}] {t[:200]}" for i, t in enumerate(texts))
            prompt = f"""你是医学文献结构化专家。为以下{len(texts)}个文本块各自标注章节类型。
类型: primary_outcome / secondary_outcome / subgroup_analysis /
sensitivity_analysis / safety / population / intervention /
statistical / methods / results / discussion / conclusion / background

输出JSON数组: {{"tags": ["类型1", "类型2", ...]}}

文本块:
{items}"""
            resp = self.llm(prompt)
            json_str = resp.strip()
            if "```json" in json_str: json_str = json_str[json_str.find("```json")+7:]
            if "```" in json_str: json_str = json_str[:json_str.rfind("```")]
            result = json.loads(json_str)
            tags = result.get("tags", [])
            # Validate and fill
            out = []
            for i, t in enumerate(tags):
                out.append(t if t in self.SECTION_LABELS else self.classify_section(texts[i]))
            while len(out) < len(texts):
                out.append(self.classify_section(texts[len(out)]))
            return out[:len(texts)]
        except Exception:
            pass
        return [self.classify_section(t) for t in texts]

    def detect_evidence_type(self, text: str) -> tuple:
        """基于关键词检测证据类型和等级"""
        text_lower = text[:2000].lower()
        for etype, keywords in EVIDENCE_KEYWORDS.items():
            for kw in keywords:
                if kw.lower() in text_lower:
                    level_map = {
                        "meta_analysis": 1, "rct": 2, "cohort_study": 3,
                        "case_control": 4, "case_report": 5,
                        "expert_consensus": 6, "narrative_review": 7,
                    }
                    return etype, level_map.get(etype, 7)
        return "unknown", 7

    async def extract_pico_llm(self, text: str) -> Dict[str, Any]:
        """LLM增强PICO提取 — 仅用于摘要/结论关键段落"""
        if not self.llm:
            return {"population": "", "intervention": "", "comparison": "",
                    "outcome": "", "evidence_type": "unknown", "evidence_level": 7}

        try:
            prompt = PICO_EXTRACTION_PROMPT.format(content=text[:4000])
            response = await self.llm(prompt)
            text = response.strip()
            if "```json" in text:
                text = text[text.find("```json") + 7:]
            if "```" in text:
                text = text[:text.rfind("```")]
            return json.loads(text.strip())
        except Exception as e:
            logger.warning(f"PICO LLM extraction failed: {e}")
            return {"population": "", "intervention": "", "comparison": "",
                    "outcome": "", "evidence_type": "unknown", "evidence_level": 7}

    def preprocess_content_list(
        self, content_list: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """预处理：去噪、过滤过短片段"""
        cleaned = []
        for item in content_list:
            if item.get("type") == "text":
                text = item.get("text", "").strip()
                if not text or len(text) < 10:
                    continue
                cleaned.append(item)
            elif item.get("type") in ("image", "table", "equation"):
                cleaned.append(item)
        return cleaned

    def merge_text_by_page(
        self, content_list: List[Dict[str, Any]]
    ) -> Dict[int, str]:
        """按页码合并文本"""
        page_texts = {}
        for item in content_list:
            if item.get("type") != "text":
                continue
            page_idx = item.get("page_idx", 0)
            if page_idx not in page_texts:
                page_texts[page_idx] = []
            page_texts[page_idx].append(item.get("text", ""))
        return {
            p: "\n\n".join(texts)
            for p, texts in sorted(page_texts.items())
        }

    async def chunk_document(
        self,
        content_list: List[Dict[str, Any]],
        file_path: str = "",
        doc_id: Optional[str] = None,
    ) -> MedicalDocument:
        """规则优先的医学语义分块"""
        import hashlib

        cleaned = self.preprocess_content_list(content_list)
        page_texts = self.merge_text_by_page(cleaned)
        full_text = "\n\n".join(page_texts.values())

        doc_id = doc_id or hashlib.md5(full_text[:1000].encode()).hexdigest()[:12]

        # 证据类型检测（规则）
        evidence_type, evidence_level = self.detect_evidence_type(full_text)

        # LLM增强：仅对前几页(摘要)和最后几页(结论)做PICO提取
        pico = {"population": "", "intervention": "", "comparison": "",
                "outcome": "", "evidence_type": evidence_type, "evidence_level": evidence_level}

        if self.llm:
            try:
                # 摘要通常在开头
                abstract_text = "\n\n".join(
                    text for p, text in sorted(page_texts.items())[:3]
                )[:4000]
                pico = await self.extract_pico_llm(abstract_text)
            except Exception as e:
                logger.warning(f"PICO extraction skipped: {e}")

        # 规则分段
        sections = []
        prev_tag = None
        current_section_text = ""
        current_section_tag = "background"

        for page_idx, page_text in sorted(page_texts.items()):
            paragraphs = [p for p in page_text.split("\n\n") if len(p.strip()) > 50]

            for para in paragraphs:
                # 检查是否是新章节的开头
                tag = self.classify_section(para)

                # 如果识别到新的章节标签且当前段已积累内容，先保存
                if tag != current_section_tag and current_section_text:
                    section = SemanticChunk(
                        chunk_id=f"{doc_id}_{page_idx}_{len(sections)}",
                        section_tag=current_section_tag,
                        content=current_section_text.strip(),
                        evidence_level=evidence_level,
                        page_range=(page_idx, page_idx),
                        source_file=file_path,
                        parent_section=prev_tag,
                    )
                    sections.append(section)
                    prev_tag = current_section_tag
                    current_section_text = para
                    current_section_tag = tag
                else:
                    if current_section_text:
                        current_section_text += "\n\n" + para
                    else:
                        current_section_text = para

        # 保存最后一个section
        if current_section_text.strip():
            section = SemanticChunk(
                chunk_id=f"{doc_id}_final_{len(sections)}",
                section_tag=current_section_tag,
                content=current_section_text.strip(),
                evidence_level=evidence_level,
                page_range=(max(page_texts.keys()), max(page_texts.keys())),
                source_file=file_path,
                parent_section=prev_tag,
            )
            sections.append(section)

        doc = MedicalDocument(
            doc_id=doc_id,
            title=file_path,
            evidence_level=evidence_level,
            evidence_type=evidence_type,
            pico=pico,
            sections=sections,
        )

        logger.info(
            f"Medical chunking: {len(sections)} sections, doc={doc_id}, "
            f"evidence={evidence_type}"
        )
        return doc

    def to_enhanced_content_list(self, doc: MedicalDocument) -> List[Dict[str, Any]]:
        """将MedicalDocument转回content_list格式"""
        enhanced = []

        # PICO元信息块
        pico_text = "### PICO框架\n"
        for dim, value in doc.pico.items():
            if value and dim not in ("evidence_type", "evidence_level"):
                pico_text += f"- **{dim.upper()}**: {value}\n"

        enhanced.append({
            "type": "text",
            "text": pico_text,
            "page_idx": 0,
            "_chunk_meta": {
                "section_tag": "pico_framework",
                "evidence_level": doc.evidence_level,
                "evidence_type": doc.evidence_type,
            }
        })

        for section in doc.sections:
            enhanced.append({
                "type": "text",
                "text": section.content,
                "page_idx": section.page_range[0],
                "_chunk_meta": {
                    "section_tag": section.section_tag,
                    "pico_dimension": section.pico_dimension,
                    "medical_entities": section.medical_entities,
                    "evidence_level": section.evidence_level,
                    "parent_section": section.parent_section,
                }
            })

        return enhanced
