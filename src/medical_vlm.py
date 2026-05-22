"""
医学多模态理解层 (Medical VLM Understanding Layer)

使用Kimi-K2.6 VLM 深度理解医学图表，将视觉内容转化为结构化的医学语义描述。

核心功能:
1. 临床基线表 → 结构化患者特征提取
2. 结局指标表 → 效应量提取（RR/OR/HR + 95%CI + p值）
3. 森林图 → subgroup结果文字化
4. Kaplan-Meier曲线 → 生存分析描述
5. 诊断流程图 → 决策步骤文字化
"""

import json
import base64
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

# ─── VLM Prompt模板 ──────────────────────────────────────────

MEDICAL_CHART_SYSTEM = """你是一位资深医学统计学家和临床流行病学家，专精于解读医学文献中的图表。
你需要对输入的医学图表进行深度解析，提取所有关键医学信息。

## 通用规则
1. 始终使用中文输出，但保留医学术语和统计量的标准英文缩写
2. 对所有数字精确到原始数据的小数位数
3. 明确标注95%CI区间、p值、效应量方向
4. 区分统计显著性和临床显著性
5. 如有不确定信息，标注[不确定]
"""

BASELINE_TABLE_PROMPT = """请深度解析这张临床基线特征表。

## 输出格式
```json
{{
    "table_type": "baseline_characteristics",
    "study_groups": ["组别1名称", "组别2名称"],
    "total_patients": integer,
    "characteristics": [
        {{
            "variable": "变量名（中英文）",
            "group1_value": "组1值（含单位）",
            "group2_value": "组2值（含单位）",
            "statistic": "统计量",
            "p_value": "p值（如有）",
            "clinical_significance": "临床说明"
        }}
    ],
    "balance_assessment": "组间均衡性评估：关键变量是否可比",
    "summary": "一句话总结该基线表"
}}
```

请分析以下基线表：
{table_content}
"""

OUTCOME_TABLE_PROMPT = """请深度解析这张临床结局指标表，提取所有效应量和统计信息。

## 输出格式
```json
{{
    "table_type": "outcome_measures",
    "outcomes": [
        {{
            "outcome_name": "结局指标名称",
            "intervention_events": "干预组事件数/总数",
            "control_events": "对照组事件数/总数",
            "effect_measure": "RR/OR/HR",
            "effect_value": 0.85,
            "ci_lower": 0.72,
            "ci_upper": 0.98,
            "p_value": 0.03,
            "direction": "favor_intervention/favor_control/no_difference",
            "interpretation": "一句话医学解释"
        }}
    ],
    "primary_endpoint_met": true/false,
    "summary": "整体结果一句话总结"
}}
```

请分析以下结局指标表：
{table_content}
"""

FOREST_PLOT_PROMPT = """请深度解析这张森林图（通常是亚组分析的森林图）。

## 输出格式
```json
{{
    "chart_type": "forest_plot",
    "overall_effect": {{
        "measure": "HR/OR/RR",
        "value": 0.85,
        "ci_lower": 0.72,
        "ci_upper": 0.98,
        "p_value": 0.03
    }},
    "subgroups": [
        {{
            "subgroup_name": "亚组名称",
            "n_intervention": integer,
            "n_control": integer,
            "effect_value": 0.88,
            "ci_lower": 0.70,
            "ci_upper": 1.05,
            "p_interaction": "交互p值（如有）",
            "interpretation": "该亚组结果解读"
        }}
    ],
    "heterogeneity_assessment": "异质性评估",
    "summary": "森林图整体解读"
}}
```

请分析这张森林图：
"""

KM_CURVE_PROMPT = """请深度解析这张Kaplan-Meier生存曲线。

## 输出格式
```json
{{
    "chart_type": "kaplan_meier",
    "groups": ["组1", "组2"],
    "time_range": "X轴时间范围",
    "survival_rates": [
        {{
            "timepoint": "时间点",
            "group1_survival": "组1生存率%",
            "group2_survival": "组2生存率%",
            "absolute_difference": "绝对差异%"
        }}
    ],
    "median_survival": {{
        "group1": "中位生存期",
        "group2": "中位生存期"
    }},
    "hr": {{"value": 0.75, "ci_lower": 0.60, "ci_upper": 0.92, "p_value": 0.01}},
    "log_rank_p": "log-rank p值",
    "number_at_risk": "是否显示风险人数",
    "crossover": "是否有曲线交叉",
    "interpretation": "生存分析解读"
}}
```

请分析这张生存曲线：
"""

FLOWCHART_PROMPT = """请深度解析这张诊断/研究流程图。

## 输出格式
```json
{{
    "chart_type": "flowchart",
    "flow_type": "diagnosis/study_enrollment/treatment_algorithm",
    "steps": [
        {{
            "step_number": 1,
            "description": "步骤描述",
            "criteria": "判断标准",
            "next_step_if_yes": "下一步（满足条件）",
            "next_step_if_no": "下一步（不满足条件）"
        }}
    ],
    "start_point": "起点",
    "end_points": ["终点1", "终点2"],
    "summary": "流程图整体描述"
}}
```

请分析这张流程图：
"""


class MedicalVLMProcessor:
    """医学VLM图表处理器"""

    def __init__(self, vision_model_func, llm_model_func=None):
        """
        Args:
            vision_model_func: VLM调用函数 (Kimi-K2.6)
            llm_model_func: 文本LLM (降级fallback用)
        """
        self.vlm = vision_model_func
        self.llm = llm_model_func

    def encode_image(self, image_path: str) -> str:
        """将图片编码为base64"""
        try:
            with open(image_path, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8")
        except Exception as e:
            logger.error(f"Image encoding failed: {image_path} - {e}")
            return ""

    async def analyze_baseline_table(
        self, table_content: Dict[str, Any]
    ) -> Dict[str, Any]:
        """分析基线特征表"""
        table_body = table_content.get("table_body", "")
        caption = table_content.get("table_caption", [])

        # 尝试用VLM分析表格截图
        table_img_path = table_content.get("table_img_path", "")
        if table_img_path and Path(table_img_path).exists():
            image_b64 = self.encode_image(table_img_path)
            if image_b64:
                prompt = BASELINE_TABLE_PROMPT.format(
                    table_content=str(caption) + "\n" + str(table_body)[:2000]
                )
                try:
                    response = await self.vlm(
                        prompt,
                        system_prompt=MEDICAL_CHART_SYSTEM,
                        image_data=image_b64,
                    )
                    return self._parse_json_response(response)
                except Exception as e:
                    logger.warning(f"VLM baseline table fallback to text: {e}")

        # 降级：用文本LLM分析表格markdown
        if self.llm:
            prompt = BASELINE_TABLE_PROMPT.format(
                table_content=str(table_body)[:4000]
            )
            response = await self.llm(prompt)
            return self._parse_json_response(response)

        return {"error": "No available analyzer"}

    async def analyze_outcome_table(
        self, table_content: Dict[str, Any]
    ) -> Dict[str, Any]:
        """分析结局指标表 - 重点提取效应量"""
        table_body = table_content.get("table_body", "")
        caption = table_content.get("table_caption", [])

        table_img_path = table_content.get("table_img_path", "")
        if table_img_path and Path(table_img_path).exists():
            image_b64 = self.encode_image(table_img_path)
            if image_b64:
                try:
                    response = await self.vlm(
                        OUTCOME_TABLE_PROMPT.format(
                            table_content=str(caption) + "\n" + str(table_body)[:2000]
                        ),
                        system_prompt=MEDICAL_CHART_SYSTEM,
                        image_data=image_b64,
                    )
                    return self._parse_json_response(response)
                except Exception as e:
                    logger.warning(f"VLM outcome table fallback: {e}")

        if self.llm:
            prompt = OUTCOME_TABLE_PROMPT.format(
                table_content=str(table_body)[:4000]
            )
            response = await self.llm(prompt)
            return self._parse_json_response(response)

        return {"error": "No available analyzer"}

    async def analyze_image_content(
        self, image_content: Dict[str, Any]
    ) -> Dict[str, Any]:
        """通用医学图像分析"""
        img_path = image_content.get("img_path", "")
        caption = image_content.get("image_caption", [])
        caption_str = " ".join(caption) if caption else ""

        if not img_path or not Path(img_path).exists():
            return {
                "description": f"图像不可用: {caption_str}",
                "entity_info": {"entity_name": caption_str, "entity_type": "image"}
            }

        image_b64 = self.encode_image(img_path)
        if not image_b64:
            return {
                "description": f"图像编码失败: {caption_str}",
                "entity_info": {"entity_name": caption_str, "entity_type": "image"}
            }

        try:
            response = await self.vlm(
                f"请用中文描述这张医学图片的内容。图片标题: {caption_str}",
                system_prompt=MEDICAL_CHART_SYSTEM,
                image_data=image_b64,
            )
            return {
                "description": response,
                "entity_info": {
                    "entity_name": caption_str or "医学图像",
                    "entity_type": "image",
                }
            }
        except Exception as e:
            logger.error(f"VLM image analysis failed: {e}")
            return {
                "description": f"图像分析失败: {caption_str}",
                "entity_info": {"entity_name": caption_str, "entity_type": "image"}
            }

    async def analyze_special_chart(
        self, image_content: Dict[str, Any]
    ) -> Dict[str, Any]:
        """识别图表类型并用对应prompt分析"""
        img_path = image_content.get("img_path", "")
        caption = image_content.get("image_caption", [])
        caption_str = " ".join(caption) if caption else ""

        if not img_path:
            return {"error": "No image path"}

        image_b64 = self.encode_image(img_path)
        if not image_b64:
            return {"error": "Image encoding failed"}

        # 先用VLM识别图表类型
        type_prompt = f"""这是医学文献中的一张图表。请判断其类型。
标题: {caption_str}
类型选项: baseline_table（基线表）/ outcome_table（结局表）/ forest_plot（森林图）/
          km_curve（生存曲线）/ flowchart（流程图）/ mechanism_figure（机制图）/ other
只回复类型名称。"""

        try:
            chart_type_resp = await self.vlm(
                type_prompt,
                system_prompt=MEDICAL_CHART_SYSTEM,
                image_data=image_b64,
            )
            chart_type = chart_type_resp.strip().lower()
        except Exception:
            chart_type = "other"

        # 选择对应prompt
        type_prompts = {
            "forest_plot": FOREST_PLOT_PROMPT,
            "km_curve": KM_CURVE_PROMPT,
            "flowchart": FLOWCHART_PROMPT,
        }

        # 表格类型用表格prompt
        if "baseline_table" in chart_type:
            return await self.analyze_baseline_table(
                {"table_body": caption_str, "table_caption": caption}
            )

        # 特殊图表用特殊prompt
        prompt_func = type_prompts.get(chart_type)
        if prompt_func:
            try:
                response = await self.vlm(
                    prompt_func,
                    system_prompt=MEDICAL_CHART_SYSTEM,
                    image_data=image_b64,
                )
                return self._parse_json_response(response)
            except Exception as e:
                logger.warning(f"Special chart {chart_type} failed: {e}")

        # 降级到通用分析
        return await self.analyze_image_content(image_content)

    def _parse_json_response(self, response: str) -> Dict[str, Any]:
        """解析LLM/VLM返回的JSON"""
        try:
            text = response.strip()
            if "```json" in text:
                text = text[text.find("```json") + 7:]
            if "```" in text:
                text = text[:text.rfind("```")]
            return json.loads(text.strip())
        except json.JSONDecodeError:
            return {"raw_response": response, "error": "JSON parse failed"}

    def create_medical_enhanced_caption(
        self, analysis: Dict[str, Any], chart_type: str
    ) -> str:
        """根据分析结果生成医学增强caption"""
        if "error" in analysis:
            return json.dumps(analysis, ensure_ascii=False)

        if chart_type == "baseline_characteristics":
            parts = []
            groups = analysis.get("study_groups", [])
            if groups:
                parts.append(f"研究分组: {' vs '.join(groups)}")
            n = analysis.get("total_patients", 0)
            if n:
                parts.append(f"总例数: {n}")
            return ". ".join(parts) if parts else "基线特征表"

        if chart_type == "outcome_measures":
            parts = []
            for outcome in analysis.get("outcomes", []):
                parts.append(
                    f"{outcome.get('outcome_name', '')}: "
                    f"{outcome.get('effect_measure', '')}={outcome.get('effect_value', '')}, "
                    f"95%CI [{outcome.get('ci_lower', '')}-{outcome.get('ci_upper', '')}], "
                    f"p={outcome.get('p_value', '')}"
                )
            return "; ".join(parts) if parts else "结局指标表"

        return analysis.get("summary", analysis.get("description", ""))
