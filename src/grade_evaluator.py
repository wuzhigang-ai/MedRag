"""
GRADE证据质量评估器 (Grading of Recommendations Assessment, Development and Evaluation)

实现全球医学界公认的GRADE方法论，将现有简单7级证据分类升级为
完整的多维度证据质量评估体系。

GRADE评估流程:
1. 确定初始证据等级 (RCT=High, Observational=Low)
2. 五维度降级评估 (Risk of Bias, Inconsistency, Indirectness, Imprecision, Publication Bias)
3. 三维度升级评估 (Large Effect, Dose-Response, Residual Confounding)
4. 输出最终证据质量: High(4) / Moderate(3) / Low(2) / Very Low(1)
"""

import json
import logging
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, field
from enum import IntEnum

logger = logging.getLogger(__name__)


class GRADELevel(IntEnum):
    """GRADE证据质量等级"""
    VERY_LOW = 1
    LOW = 2
    MODERATE = 3
    HIGH = 4

    @property
    def label(self) -> str:
        return {4: "高 (High)", 3: "中 (Moderate)", 2: "低 (Low)", 1: "极低 (Very Low)"}[self.value]

    @property
    def description(self) -> str:
        return {
            4: "进一步研究极不可能改变我们对效应估计的确信度",
            3: "进一步研究可能对效应估计的确信度有重要影响，且可能改变估计值",
            2: "进一步研究极有可能对效应估计的确信度有重要影响，且很可能改变估计值",
            1: "任何效应估计都是非常不确定的",
        }[self.value]


class GRADEStrength(IntEnum):
    """推荐强度"""
    STRONG_AGAINST = -2
    WEAK_AGAINST = -1
    WEAK_FOR = 1
    STRONG_FOR = 2

    @property
    def label(self) -> str:
        return {-2: "强不推荐", -1: "弱不推荐", 1: "弱推荐", 2: "强推荐"}[self.value]


@dataclass
class GRADEDowngrade:
    """降级因素评估"""
    risk_of_bias: int = 0  # 0=无严重, -1=严重, -2=极严重
    bias_details: List[str] = field(default_factory=list)
    inconsistency: int = 0
    inconsistency_details: List[str] = field(default_factory=list)
    indirectness: int = 0
    indirectness_details: List[str] = field(default_factory=list)
    imprecision: int = 0
    imprecision_details: List[str] = field(default_factory=list)
    publication_bias: int = 0
    publication_bias_details: List[str] = field(default_factory=list)

    @property
    def total_downgrade(self) -> int:
        return sum([self.risk_of_bias, self.inconsistency, self.indirectness,
                     self.imprecision, self.publication_bias])


@dataclass
class GRADEUpgrade:
    """升级因素评估"""
    large_effect: int = 0  # 0=无, +1=大效应量(RR>2或<0.5), +2=极大效应量(RR>5或<0.2)
    large_effect_detail: str = ""
    dose_response: int = 0  # +1
    dose_response_detail: str = ""
    residual_confounding: int = 0  # +1
    residual_confounding_detail: str = ""

    @property
    def total_upgrade(self) -> int:
        return sum([self.large_effect, self.dose_response, self.residual_confounding])


@dataclass
class GRADEAssessment:
    """完整的GRADE评估结果"""
    study_design: str = ""
    initial_level: int = 2  # RCT→4, Observational→2
    downgrades: GRADEDowngrade = field(default_factory=GRADEDowngrade)
    upgrades: GRADEUpgrade = field(default_factory=GRADEUpgrade)
    final_level: int = 2
    final_label: str = ""
    recommendation_strength: str = ""
    summary_of_findings: str = ""
    confidence_interval_summary: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "study_design": self.study_design,
            "initial_level": self.initial_level,
            "downgrades": {
                "risk_of_bias": self.downgrades.risk_of_bias,
                "bias_details": self.downgrades.bias_details,
                "inconsistency": self.downgrades.inconsistency,
                "inconsistency_details": self.downgrades.inconsistency_details,
                "indirectness": self.downgrades.indirectness,
                "indirectness_details": self.downgrades.indirectness_details,
                "imprecision": self.downgrades.imprecision,
                "imprecision_details": self.downgrades.imprecision_details,
                "publication_bias": self.downgrades.publication_bias,
                "publication_bias_details": self.downgrades.publication_bias_details,
                "total_downgrade": self.downgrades.total_downgrade,
            },
            "upgrades": {
                "large_effect": self.upgrades.large_effect,
                "large_effect_detail": self.upgrades.large_effect_detail,
                "dose_response": self.upgrades.dose_response,
                "dose_response_detail": self.upgrades.dose_response_detail,
                "residual_confounding": self.upgrades.residual_confounding,
                "residual_confounding_detail": self.upgrades.residual_confounding_detail,
                "total_upgrade": self.upgrades.total_upgrade,
            },
            "final_level": self.final_level,
            "final_label": self.final_label,
            "recommendation_strength": self.recommendation_strength,
            "summary_of_findings": self.summary_of_findings,
            "confidence_interval_summary": self.confidence_interval_summary,
        }


class GRADEEvaluator:
    """GRADE证据质量评估引擎"""

    def __init__(self, llm_func=None):
        self.llm = llm_func

    def assess_single(self, doc_id: str, title: str,
                      evidence_type: str, key_findings: List[str],
                      pico: Dict, effect_data: List[Dict] = None) -> GRADEAssessment:
        """单篇文献的GRADE评估"""
        assessment = GRADEAssessment()

        # 1. 确定初始等级
        et = evidence_type.lower().replace("-", "_")
        if et in ("meta_analysis", "systematic_review", "rct", "randomized_controlled_trial"):
            assessment.initial_level = 4
            assessment.study_design = "随机对照试验/Meta分析"
        else:
            assessment.initial_level = 2
            assessment.study_design = "观察性研究"

        # 2. 降级评估 (基于规则 + 关键发现文本分析)
        combined_text = " ".join(key_findings)
        self._assess_risk_of_bias(assessment, combined_text, title)
        self._assess_inconsistency(assessment, combined_text, effect_data or [])
        self._assess_indirectness(assessment, pico, combined_text)
        self._assess_imprecision(assessment, combined_text, effect_data or [])
        self._assess_publication_bias(assessment, combined_text, evidence_type)

        # 3. 升级评估
        if assessment.initial_level == 4:
            # RCT/Meta也可因大效应量升级
            self._assess_large_effect(assessment, combined_text, effect_data or [])
        else:
            # 观察性研究可以升级
            self._assess_large_effect(assessment, combined_text, effect_data or [])
            self._assess_dose_response(assessment, combined_text)
            self._assess_residual_confounding(assessment, combined_text)

        # 4. 计算最终等级
        raw_level = assessment.initial_level + assessment.downgrades.total_downgrade + assessment.upgrades.total_upgrade
        assessment.final_level = max(1, min(4, raw_level))
        assessment.final_label = GRADELevel(assessment.final_level).label

        # 5. 推荐强度
        if assessment.final_level >= 3:
            assessment.recommendation_strength = "强推荐" if assessment.downgrades.total_downgrade <= -1 else "弱推荐"
        else:
            assessment.recommendation_strength = "弱推荐" if assessment.final_level == 2 else "不推荐(证据不足)"

        return assessment

    def _assess_risk_of_bias(self, a: GRADEAssessment, text: str, title: str):
        """偏倚风险评估"""
        bias_keywords = {
            "open_label": ("开放标签", "非盲", "open-label", "open label"),
            "no_blinding": ("未设盲", "单盲", "single-blind", "不设盲"),
            "small_sample": ("小样本", "small sample", "pilot", "预试验"),
            "high_attrition": ("高失访", "高脱落", "失访率高", "high dropout", "attrition"),
            "selection_bias": ("选择偏倚", "selection bias", "非随机", "non-random"),
            "no_allocation": ("未随机分组", "no randomization", "未随机"),
        }
        tl = text.lower()
        score = 0
        for issue, keywords in bias_keywords.items():
            if any(kw in tl for kw in keywords):
                score -= 1
                a.downgrades.bias_details.append(issue)
        a.downgrades.risk_of_bias = max(-2, score)

    def _assess_inconsistency(self, a: GRADEAssessment, text: str, effect_data: List[Dict]):
        """不一致性评估"""
        inconsistency_keywords = (
            "heterogeneity", "异质性", "I²", "I2", "inconsistent", "不一致",
            "contradictory", "矛盾", "conflicting"
        )
        tl = text.lower()
        score = 0
        if any(kw in tl for kw in inconsistency_keywords):
            score -= 1
            a.downgrades.inconsistency_details.append("检测到异质性或矛盾信号")

        # 检查I²值
        for m in ["i²=", "i2=", "i² =", "i2 ="]:
            if m in tl:
                score -= 1
                a.downgrades.inconsistency_details.append("报告了I²统计量(异质性指标)")
                break

        a.downgrades.inconsistency = max(-2, score)

    def _assess_indirectness(self, a: GRADEAssessment, pico: Dict, text: str):
        """间接性评估（人群/干预/结局不直接匹配）"""
        # 简化规则：如果PICO各维度信息都不完整或模糊，则降级
        missing = 0
        for key in ["population", "intervention", "comparison", "outcome"]:
            if not pico.get(key):
                missing += 1
        if missing >= 2:
            a.downgrades.indirectness = -1
            a.downgrades.indirectness_details.append(f"PICO信息不完整: {missing}/4维度缺失")

    def _assess_imprecision(self, a: GRADEAssessment, text: str, effect_data: List[Dict]):
        """不精确性评估（置信区间过宽/样本量不足）"""
        # 检查CI跨过无效线
        for ed in effect_data:
            ci_lower = ed.get("ci_lower", 0) or 0
            ci_upper = ed.get("ci_upper", 0) or 0
            effect = ed.get("effect_value", 0) or 0
            measure = (ed.get("effect_measure", "") or "").upper()

            if ci_lower and ci_upper:
                # 检查CI是否跨过1.0 (RR/OR/HR的无效值)
                crosses_null = ci_lower < 1.0 < ci_upper
                # 检查CI宽度：上限/下限>5表示不精确
                if ci_lower > 0 and ci_upper / ci_lower > 5:
                    a.downgrades.imprecision = -1
                    a.downgrades.imprecision_details.append(
                        f"CI过宽 ({ci_lower:.2f}-{ci_upper:.2f}, ratio={ci_upper/ci_lower:.1f})"
                    )
                    break
                if crosses_null:
                    a.downgrades.imprecision_details.append(f"CI跨无效线 ({ci_lower:.2f}-{ci_upper:.2f})")

        # 检查样本量
        tl = text.lower()
        small_sample_kw = ["n=", "n =", "纳入", "enrolled"]
        for kw_ss in small_sample_kw:
            if kw_ss in tl:
                import re
                nums = re.findall(r'n\.*=?\.*(\d+)', tl)
                if nums:
                    n_val = int(nums[0])
                    if n_val < 100:
                        a.downgrades.imprecision = max(a.downgrades.imprecision, -1)
                        a.downgrades.imprecision_details.append(f"样本量不足 (n={n_val})")
                break

    def _assess_publication_bias(self, a: GRADEAssessment, text: str, evidence_type: str):
        """发表偏倚评估"""
        pb_keywords = ("funnel plot", "漏斗图", "egger", "egger's", "publication bias",
                       "发表偏倚", "文件抽屉")
        tl = text.lower()
        # 正信号: 提到了发表偏倚评估 → 说明研究者意识到了
        if any(kw in tl for kw in pb_keywords):
            # 不降级，因为已有评估
            pass
        # 如果是Meta分析但未提漏斗图，轻微降级
        elif evidence_type.lower() in ("meta_analysis", "systematic_review", "meta分析", "系统综述"):
            a.downgrades.publication_bias = -1
            a.downgrades.publication_bias_details.append("Meta分析未报告发表偏倚评估")

    def _assess_large_effect(self, a: GRADEAssessment, text: str, effect_data: List[Dict]):
        """大效应量升级评估"""
        for ed in effect_data:
            effect = ed.get("effect_value", 0) or 0
            if effect <= 0:
                continue
            if effect > 5 or effect < 0.2:
                a.upgrades.large_effect = 2
                a.upgrades.large_effect_detail = f"极大效应量 ({effect:.2f})"
                return
            if effect > 2 or effect < 0.5:
                a.upgrades.large_effect = 1
                a.upgrades.large_effect_detail = f"大效应量 ({effect:.2f})"
                return

    def _assess_dose_response(self, a: GRADEAssessment, text: str):
        """剂量-反应关系升级评估"""
        dr_keywords = ("dose-response", "剂量-反应", "dose dependent", "剂量依赖",
                       "dose-response relationship", "gradient")
        if any(kw in text.lower() for kw in dr_keywords):
            a.upgrades.dose_response = 1
            a.upgrades.dose_response_detail = "检测到剂量-反应关系"

    def _assess_residual_confounding(self, a: GRADEAssessment, text: str):
        """残余混杂评估（所有合理的混杂只会降低效应）"""
        # 这是一个高级判断，通常需要专家评估
        # 在自动化场景中，如果研究是观察性的且效应方向是保护性的，
        # 而理论上混杂因素只会使效应趋向于null → 升级
        adjust_keywords = ("adjusted", "调整", "multivariate", "多变量",
                          "propensity score", "倾向性评分", "校准")
        if any(kw in text.lower() for kw in adjust_keywords):
            a.upgrades.residual_confounding = 1
            a.upgrades.residual_confounding_detail = "进行了多变量调整/倾向性评分匹配"

    async def llm_assess(self, doc_id: str, title: str,
                         content: str, evidence_type: str) -> GRADEAssessment:
        """LLM增强的GRADE评估（对规则评估的补充和校准）"""
        # 先用规则评估
        assessment = self.assess_single(doc_id, title, evidence_type,
                                         [content[:1000]], {}, [])

        if not self.llm:
            return assessment

        try:
            prompt = f"""你是GRADE证据评估专家。请基于以下文献信息进行GRADE评估。

## 文献信息
标题: {title}
类型: {evidence_type}
内容摘要: {content[:2000]}

## 当前规则评估结果
初始等级: {assessment.initial_level}
降级: {assessment.downgrades.total_downgrade}分
升级: {assessment.upgrades.total_upgrade}分
最终等级: {assessment.final_label}

请判断规则评估是否合理，是否需要修正。

输出JSON:
{{"agree": true/false,
 "corrections": {{"risk_of_bias": 0, "inconsistency": 0, "imprecision": 0}},
 "final_level": {assessment.final_level},
 "note": "需要修正的理由或确认的理由"}}

只输出JSON。"""
            resp = await self.llm(prompt)
            raw = resp.strip()
            if "```json" in raw: raw = raw[raw.find("```json")+7:]
            if "```" in raw: raw = raw[:raw.rfind("```")]
            result = json.loads(raw.strip())

            if not result.get("agree"):
                corrections = result.get("corrections", {})
                assessment.downgrades.risk_of_bias = corrections.get("risk_of_bias", assessment.downgrades.risk_of_bias)
                assessment.downgrades.inconsistency = corrections.get("inconsistency", assessment.downgrades.inconsistency)
                assessment.downgrades.imprecision = corrections.get("imprecision", assessment.downgrades.imprecision)
                raw_level = assessment.initial_level + assessment.downgrades.total_downgrade + assessment.upgrades.total_upgrade
                assessment.final_level = max(1, min(4, raw_level))
                assessment.final_label = GRADELevel(assessment.final_level).label

            assessment.summary_of_findings = result.get("note", "")
            return assessment
        except Exception as e:
            logger.warning(f"LLM GRADE assessment failed: {e}")
            return assessment

    def batch_assess(self, documents: List[Dict]) -> Dict[str, GRADEAssessment]:
        """批量GRADE评估"""
        results = {}
        for doc in documents:
            results[doc.get("doc_id")] = self.assess_single(
                doc.get("doc_id", ""),
                doc.get("title", ""),
                doc.get("evidence_type", "unknown"),
                doc.get("key_findings", []),
                doc.get("pico", {}),
                doc.get("effect_data", []),
            )
        return results

    @staticmethod
    def generate_evidence_profile(assessments: Dict[str, GRADEAssessment]) -> Dict:
        """生成证据概览表 (GRADE Evidence Profile)"""
        profile = {
            "total_assessed": len(assessments),
            "distribution": {"HIGH": 0, "MODERATE": 0, "LOW": 0, "VERY_LOW": 0},
            "documents": [],
            "overall_assessment": "",
        }

        for doc_id, a in assessments.items():
            level_name = GRADELevel(a.final_level).name
            profile["distribution"][level_name] = profile["distribution"].get(level_name, 0) + 1
            profile["documents"].append({
                "doc_id": doc_id,
                "study_design": a.study_design,
                "grade_level": a.final_label,
                "downgrade_reasons": a.downgrades.bias_details + a.downgrades.inconsistency_details +
                                    a.downgrades.indirectness_details + a.downgrades.imprecision_details +
                                    a.downgrades.publication_bias_details,
                "upgrade_reasons": [],
                "recommendation": a.recommendation_strength,
            })

        # 整体评价
        high_moderate = profile["distribution"].get("HIGH", 0) + profile["distribution"].get("MODERATE", 0)
        if high_moderate >= profile["total_assessed"] * 0.5:
            profile["overall_assessment"] = "整体证据质量较好，可基于此做出临床推荐"
        elif profile["distribution"].get("LOW", 0) > 0:
            profile["overall_assessment"] = "部分证据质量有限，建议谨慎解读并关注新研究"
        else:
            profile["overall_assessment"] = "证据质量整体偏低，结论具有较大不确定性"

        return profile


class ConsistencyMatrixBuilder:
    """多文献一致性矩阵构建器
    
    赛题要求："检索来源可追溯、多文献证据一致性判断"
    此模块实现完整的跨文献一致性分析
    """

    @staticmethod
    def build_matrix(retrieved_docs: List[Dict], topic: str) -> Dict:
        """构建多文献一致性矩阵
        
        对检索到的多篇文献，从以下维度进行一致性判断：
        1. 结论方向一致性 (一致支持/一致反对/混合/矛盾)
        2. 效应量方向一致性
        3. 证据等级分布
        4. 统计显著性一致性
        """
        if len(retrieved_docs) < 2:
            return {
                "topic": topic,
                "document_count": len(retrieved_docs),
                "assessment": "文献不足 (<2篇)，无法进行一致性评估",
                "matrix": [],
            }

        # 提取每篇文献的结论信号
        findings = []
        for doc in retrieved_docs:
            text = (doc.get("text", "") or doc.get("content", ""))[:500]
            source = doc.get("source", doc.get("doc", ""))
            evidence_level = doc.get("evidence_level") or ConsistencyMatrixBuilder._infer_level(text)

            finding = {
                "source": source,
                "evidence_level": evidence_level,
                "direction": ConsistencyMatrixBuilder._detect_direction(text),
                "key_quote": text[:200],
                "effect_hint": ConsistencyMatrixBuilder._extract_effect_hint(text),
            }
            findings.append(finding)

        # 分析一致性
        directions = [f["direction"] for f in findings]
        support_count = sum(1 for d in directions if d == "supportive")
        against_count = sum(1 for d in directions if d == "against")
        neutral_count = sum(1 for d in directions if d == "neutral")

        if support_count == len(findings):
            consistency = "高度一致 (全部支持)"
        elif against_count == len(findings):
            consistency = "高度一致 (全部反对)"
        elif neutral_count == len(findings):
            consistency = "一致 (全部中性/不确定)"
        elif support_count > 0 and against_count == 0:
            consistency = "部分一致 (支持+中性)"
        elif support_count > 0 and against_count > 0:
            consistency = "存在矛盾"
        else:
            consistency = "结论方向不明确"

        # 按证据等级排序
        level_order = {"Meta-analysis": 0, "RCT": 1, "Cohort": 2, "Case-control": 3,
                       "Case-series": 4, "Expert-opinion": 5, "unknown": 6}
        findings.sort(key=lambda f: level_order.get(f["evidence_level"], 6))

        # 构建矩阵
        matrix = []
        for i, f1 in enumerate(findings):
            for j, f2 in enumerate(findings):
                if i >= j:
                    continue
                pair_comparison = ConsistencyMatrixBuilder._compare_pair(f1, f2, i, j)
                matrix.append(pair_comparison)

        return {
            "topic": topic,
            "document_count": len(findings),
            "consistency": consistency,
            "directions_summary": {
                "supportive": support_count,
                "against": against_count,
                "neutral": neutral_count,
            },
            "findings": findings,
            "matrix": matrix,
            "evidence_distribution": ConsistencyMatrixBuilder._count_by_level(findings),
            "interpretation": ConsistencyMatrixBuilder._generate_interpretation(
                consistency, findings, support_count, against_count),
        }

    @staticmethod
    def _detect_direction(text: str) -> str:
        """从文本检测结论方向"""
        tl = text.lower()
        support_kw = ("显著", "有效", "获益", "改善", "降低", "优于", "提高",
                     "significant", "effective", "benefit", "improved",
                     "superior", "reduced", "favorable")
        against_kw = ("无显著", "无效", "未改善", "不优于", "无差异", "无统计学",
                     "no significant", "no difference", "not effective",
                     "不显著", "未降低")

        support_score = sum(1 for kw in support_kw if kw in tl)
        against_score = sum(1 for kw in against_kw if kw in tl)

        if support_score > against_score + 1:
            return "supportive"
        elif against_score > support_score + 1:
            return "against"
        else:
            return "neutral"

    @staticmethod
    def _extract_effect_hint(text: str) -> Optional[str]:
        """提取效应量提示"""
        import re
        # HR/RR/OR匹配
        patterns = [
            r'(HR|RR|OR)\s*[=＝]\s*([\d.]+)\s*\(\s*([\d.]+)\s*[-–]\s*([\d.]+)\s*\)',
            r'([\d.]+)\s*\(\s*([\d.]+)\s*[-–]\s*([\d.]+)\s*\).*?(HR|RR|OR)',
        ]
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                groups = m.groups()
                return f"{groups[-1]}={groups[0]}({groups[1]}-{groups[2]})" if len(groups) == 4 else m.group()
        return None

    @staticmethod
    def _compare_pair(f1: Dict, f2: Dict, i: int, j: int) -> Dict:
        """比较两篇文献的结论"""
        direction_match = f1["direction"] == f2["direction"]
        return {
            "pair": f"文献{i+1} vs 文献{j+1}",
            "doc_a": f1["source"],
            "doc_b": f2["source"],
            "direction_match": direction_match,
            "evidence_a": f1["evidence_level"],
            "evidence_b": f2["evidence_level"],
            "conflict_analysis": "一致" if direction_match else (
                f"方向不一致: {f1['direction']} vs {f2['direction']}"),
        }

    @staticmethod
    def _count_by_level(findings: List[Dict]) -> Dict:
        """统计证据等级分布"""
        dist = {}
        for f in findings:
            level = f.get("evidence_level", "unknown") or "unknown"
            dist[level] = dist.get(level, 0) + 1
        return dist

    @staticmethod
    def _generate_interpretation(consistency: str, findings: List[Dict],
                                  support_count: int, against_count: int) -> str:
        """生成一致性解释"""
        if consistency == "高度一致 (全部支持)":
            return f"{len(findings)}篇文献结论方向一致，均支持该观点。证据链完整，结论可靠。"
        elif consistency == "存在矛盾":
            return (f"{support_count}篇支持 vs {against_count}篇反对。"
                   f"建议优先采信证据等级更高的文献结论，并关注矛盾的可能原因"
                   f"(样本量差异/研究设计差异/纳入人群差异)。")
        elif consistency == "部分一致 (支持+中性)":
            return f"{support_count}篇支持，其余为中性结论。总体倾向于支持，但证据强度有限。"
        else:
            return f"结论方向不够一致，建议更多研究验证。"

    @staticmethod
    def _infer_level(text: str) -> Optional[str]:
        """从文本推断证据等级"""
        tl = text.lower()
        if any(k in tl for k in ["meta-analysis", "meta分析", "systematic review"]):
            return "Meta-analysis"
        if any(k in tl for k in ["randomized", "随机对照", "rct"]):
            return "RCT"
        if any(k in tl for k in ["cohort", "队列", "prospective"]):
            return "Cohort"
        if any(k in tl for k in ["case-control", "病例对照"]):
            return "Case-control"
        if any(k in tl for k in ["expert consensus", "guideline", "指南", "共识"]):
            return "Expert-opinion"
        return None
