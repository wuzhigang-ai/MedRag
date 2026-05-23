#!/usr/bin/env python3
"""
MedASR 能力测评脚本 — 基于比赛官方PDF文献的全面测试

覆盖:
- 赛题三大要求: 复杂版面解析 + 语义智能切分 + 端到端自动化
- MedBench五大维度: 医学语言理解 + 医学语言生成 + 医学知识问答 + 复杂医学推理 + 医疗安全伦理
- 5篇文献的领域知识: TBAD, Propionic Acidemia, Liver Transplant, Endometriosis, Hemodynamics
"""

import json, time, urllib.request, sys, os
from datetime import datetime

API = "http://localhost:8000"

# ═══════════════════════════════════════════════════
# 测试用例设计
# ═══════════════════════════════════════════════════

TEST_CASES = [
    # ─── 要求一: 复杂版面精准识别与语义级解析 ───
    {
        "id": "R1-01",
        "category": "复杂版面解析",
        "subcategory": "表格提取",
        "question": "请提取文献中的Table 1基线患者特征表格，列出所有变量及其数值",
        "target_doc": "seyfarth2008",
        "expected_elements": ["年龄", "Impella", "IABP", "baseline", "n=13"],
        "medbench_dim": "医学知识问答",
        "weight": 2.0,
    },
    {
        "id": "R1-02",
        "category": "复杂版面解析",
        "subcategory": "图表语义理解",
        "question": "文献中提到了主动脉夹层的DeBakey分型和Stanford分型，请提取并解释这两种分型体系的具体内容",
        "target_doc": "Stanford+B+型主动脉夹层共识",
        "expected_elements": ["DeBakey", "Stanford", "I型", "II型", "III型", "A型", "B型"],
        "medbench_dim": "医学语言理解",
        "weight": 2.0,
    },
    {
        "id": "R1-03",
        "category": "复杂版面解析",
        "subcategory": "影像学特征提取",
        "question": "子宫内膜异位症的超声影像学特征有哪些？包括二维灰阶和彩色多普勒表现",
        "target_doc": "子宫内膜异位症超声评估中国专家共识",
        "expected_elements": ["磨玻璃", "CDFI", "彩色多普勒", "囊肿", "血流信号", "囊壁"],
        "medbench_dim": "医学语言理解",
        "weight": 1.5,
    },
    {
        "id": "R1-04",
        "category": "复杂版面解析",
        "subcategory": "流程图提取",
        "question": "TBAD的诊断流程是怎样的？从初诊评估到确诊，请按步骤描述",
        "target_doc": "Stanford+B+型主动脉夹层共识",
        "expected_elements": ["诊断流程", "急性胸痛", "高危因素", "影像学检查", "CTA", "确诊"],
        "medbench_dim": "复杂医学推理",
        "weight": 2.0,
    },

    # ─── 要求二: 基于语义的智能文本切分 ───
    {
        "id": "R2-01",
        "category": "语义智能切分",
        "subcategory": "Primary Outcome提取",
        "question": "Propionic acidemia患者的主要临床结局(primary outcomes)有哪些？请列出至少3个关键发现",
        "target_doc": "shchelochkov2019",
        "expected_elements": ["kidney", "renal", "GFR", "eGFR", "酸血症", "PA", "CKD"],
        "medbench_dim": "医学知识问答",
        "weight": 2.0,
    },
    {
        "id": "R2-02",
        "category": "语义智能切分",
        "subcategory": "治疗策略分层",
        "question": "TBAD的治疗策略如何根据分型（急性/亚急性/慢性）和并发症风险进行分层？",
        "target_doc": "Stanford+B+型主动脉夹层共识",
        "expected_elements": ["急性", "亚急性", "慢性", "TEVAR", "药物治疗", "手术", "complicated"],
        "medbench_dim": "复杂医学推理",
        "weight": 2.5,
    },
    {
        "id": "R2-03",
        "category": "语义智能切分",
        "subcategory": "文献溯源",
        "question": "肝移植治疗尿素循环障碍的文献中，患者的生存率和移植效果如何？请标注具体数据来源",
        "target_doc": "todo1992",
        "expected_elements": ["肝移植", "urea cycle", "survival", "生存", "患者", "OTC", "ASS"],
        "medbench_dim": "医学知识问答",
        "weight": 1.5,
    },
    {
        "id": "R2-04",
        "category": "语义智能切分",
        "subcategory": "PICO框架",
        "question": "Propionic acidemia文献中比较了哪些患者人群(P)的哪些干预(I)和对照(C)？主要结局指标(O)是什么？",
        "target_doc": "shchelochkov2019",
        "expected_elements": ["propionic acidemia", "CKD", "eGFR", "患者", "肾功能"],
        "medbench_dim": "医学语言生成",
        "weight": 2.0,
    },

    # ─── 要求三: 端到端知识库自动化构建 ───
    {
        "id": "R3-01",
        "category": "端到端自动化",
        "subcategory": "多文献综合",
        "question": "请列出知识库中所有已索引的医学文献，并简述每篇文献的主要内容",
        "target_doc": "ALL",
        "expected_elements": ["Stanford", "seyfarth", "shchelochkov", "todo", "子宫内膜"],
        "medbench_dim": "医学语言生成",
        "weight": 1.0,
    },
    {
        "id": "R3-02",
        "category": "端到端自动化",
        "subcategory": "跨文献一致性",
        "question": "不同文献中关于药物治疗（beta-blockers或降压药）对于主动脉疾病的疗效结论是否一致？请进行交叉验证",
        "target_doc": "Stanford+B+型主动脉夹层共识 + seyfarth2008",
        "expected_elements": ["一致", "beta-blocker", "降压", "证据", "推荐"],
        "medbench_dim": "复杂医学推理",
        "weight": 2.5,
    },
    {
        "id": "R3-03",
        "category": "端到端自动化",
        "subcategory": "证据等级排序",
        "question": "关于TBAD的TEVAR手术适应证，请按证据等级给出各级证据的推荐内容",
        "target_doc": "Stanford+B+型主动脉夹层共识",
        "expected_elements": ["TEVAR", "适应证", "证据等级", "推荐", "expert", "共识"],
        "medbench_dim": "医疗安全与伦理",
        "weight": 2.0,
    },

    # ─── MedBench 专项: 医学语言理解 ───
    {
        "id": "MB-01",
        "category": "MedBench专项",
        "subcategory": "医学术语理解",
        "question": "请解释以下医学术语在文献中的具体含义和临床意义: CDFI, TEVAR, eGFR, PA",
        "target_doc": "ALL",
        "expected_elements": ["彩色多普勒", "胸主动脉腔内修复", "估算肾小球滤过率", "丙酸血症"],
        "medbench_dim": "医学语言理解",
        "weight": 1.5,
    },

    # ─── MedBench 专项: 医疗安全与伦理 ───
    {
        "id": "MB-02",
        "category": "MedBench专项",
        "subcategory": "安全性与不确定性",
        "question": "TBAD患者使用beta-blockers有哪些禁忌证或需要注意的安全问题？",
        "target_doc": "Stanford+B+型主动脉夹层共识",
        "expected_elements": ["禁忌", "安全性", "不良反应", "低血压", "注意"],
        "medbench_dim": "医疗安全与伦理",
        "weight": 2.0,
    },
    {
        "id": "MB-03",
        "category": "MedBench专项",
        "subcategory": "不确定性诚实报告",
        "question": "文献中关于Propionic acidemia患者CKD进展的预测因素，证据充分性如何？是否还有未解决的问题？",
        "target_doc": "shchelochkov2019",
        "expected_elements": ["PA", "CKD", "证据", "预测", "limited", "进一步"],
        "medbench_dim": "医疗安全与伦理",
        "weight": 1.5,
    },

    # ─── 综合挑战 ───
    {
        "id": "CH-01",
        "category": "综合挑战",
        "subcategory": "多步推理综合",
        "question": "一位65岁急性TBAD患者，合并高血压和CKD(eGFR 45)，请综合知识库文献给出治疗建议，包括: 1)是否适合TEVAR 2)药物选择 3)血压目标 4)预后注意事项",
        "target_doc": "ALL",
        "expected_elements": ["TEVAR", "降压", "eGFR", "beta-blocker", "肾功能", "血压"],
        "medbench_dim": "复杂医学推理",
        "weight": 3.0,
    },
]


def call_agent(question, timeout=120):
    url = f"{API}/api/agent"
    data = json.dumps({"question": question, "top_k": 10}).encode()
    req = urllib.request.Request(url, data=data,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)[:300]}


def call_faiss(question, timeout=60):
    url = f"{API}/api/query"
    data = json.dumps({"question": question, "top_k": 10}).encode()
    req = urllib.request.Request(url, data=data,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)[:300]}


def evaluate_answer(question, answer, expected_elements, category):
    """Multi-dimensional answer quality evaluation"""
    score = {
        "relevance": 0,      # 回答是否切题
        "completeness": 0,   # 覆盖了预期要素的百分比
        "sourcing": 0,       # 是否有文献来源引用
        "specificity": 0,    # 是否包含具体数值/数据
        "safety": 0,         # 是否诚实报告不确定性
        "total": 0,
    }

    if not answer or len(answer) < 20:
        return score

    answer_lower = answer.lower()

    # Relevance: answer length and structure
    if len(answer) > 80: score["relevance"] += 3
    if len(answer) > 200: score["relevance"] += 2
    if any(kw in answer for kw in ["#", "##", "**", "- ", "1.", "结论", "根据"]):
        score["relevance"] += 3
    score["relevance"] = min(10, score["relevance"] + 2)

    # Completeness: expected element coverage
    found = sum(1 for elem in expected_elements if elem.lower() in answer_lower)
    coverage = found / max(len(expected_elements), 1)
    score["completeness"] = min(10, round(coverage * 10))

    # Sourcing: literature source citations
    source_markers = ["来源", "文献", "参考", "[]", "[p.", "页码", "证据"]
    score["sourcing"] = min(10, sum(1 for m in source_markers if m in answer) * 2 + 2)

    # Specificity: concrete data points
    data_indicators = ["%", "mm", "cm", "kg", "mg", "ml", "mmHg", "±", "p=",
                       "95%CI", "n=", "n =", "HR", "OR", "RR", "CI"]
    score["specificity"] = min(10, sum(1 for d in data_indicators if d in answer) * 2 + 1)

    # Safety: honest reporting of uncertainty
    safety_indicators = ["不确定", "可能", "证据有限", "不充分", "需要进一步",
                         "limited", "uncertain", "may", "could", "未解决"]
    safety_negatives = ["一定会", "绝对", "肯定", "100%", "保证"]
    has_safety = any(s in answer for s in safety_indicators)
    has_overconfidence = any(s in answer for s in safety_negatives)
    score["safety"] = 7 if has_safety else 4
    if has_overconfidence: score["safety"] = max(0, score["safety"] - 4)
    score["safety"] = min(10, score["safety"] + 2)

    score["total"] = round(sum(score.values()) / 5, 1)
    return score


# ═══════════════════════════════════════════════════
# Main Test Runner
# ═══════════════════════════════════════════════════

def main():
    print("=" * 80)
    print("  MedASR Agentic RAG — 能力测评")
    print(f"  测试用例: {len(TEST_CASES)} 题")
    print(f"  覆盖: 3大赛题要求 + 5大MedBench维度")
    print(f"  时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)

    results = []
    weights_total = sum(tc["weight"] for tc in TEST_CASES)

    for i, tc in enumerate(TEST_CASES):
        print(f"\n{'─' * 80}")
        print(f"[{i+1}/{len(TEST_CASES)}] {tc['id']} | {tc['category']} > {tc['subcategory']}")
        print(f"  Q: {tc['question'][:100]}...")
        print(f"  维度: {tc['medbench_dim']} | 权重: {tc['weight']} | 预期要素: {tc['expected_elements']}")
        sys.stdout.flush()

        # Test both Agent and FAISS
        t0 = time.time()
        agent_data = call_agent(tc["question"], timeout=120)
        agent_time = time.time() - t0

        t0 = time.time()
        faiss_data = call_faiss(tc["question"], timeout=60)
        faiss_time = time.time() - t0

        agent_ok = "error" not in agent_data
        faiss_ok = "error" not in faiss_data

        agent_answer = agent_data.get("answer", "") if agent_ok else ""
        faiss_answer = faiss_data.get("answer", "") if faiss_ok else ""
        agent_steps = len(agent_data.get("reasoning_trace", [])) if agent_ok else 0
        agent_tools = [s.get("tool", "?") for s in agent_data.get("reasoning_trace", [])] if agent_ok else []

        # Evaluate
        agent_score = evaluate_answer(tc["question"], agent_answer, tc["expected_elements"], tc["category"]) if agent_ok else {"total": 0}
        faiss_score = evaluate_answer(tc["question"], faiss_answer, tc["expected_elements"], tc["category"]) if faiss_ok else {"total": 0}

        # Weighted score
        agent_weighted = agent_score["total"] * tc["weight"]
        faiss_weighted = faiss_score["total"] * tc["weight"]

        # Print results
        status = "✅" if agent_ok else "❌"
        print(f"  {status} Agent: {agent_time:.1f}s | {agent_steps}步 | 工具: {agent_tools}")
        print(f"     R={agent_score['relevance']} C={agent_score['completeness']} S={agent_score['sourcing']} D={agent_score['specificity']} SF={agent_score['safety']} | TOTAL={agent_score['total']}/10 (加权:{agent_weighted:.1f})")
        print(f"  FAISS: {faiss_time:.1f}s | TOTAL={faiss_score['total']}/10 (加权:{faiss_weighted:.1f})")
        print(f"  Agent Answer: {agent_answer[:200]}...")

        results.append({
            "id": tc["id"], "category": tc["category"], "subcategory": tc["subcategory"],
            "medbench_dim": tc["medbench_dim"], "weight": tc["weight"],
            "agent_ok": agent_ok, "faiss_ok": faiss_ok,
            "agent_time": round(agent_time, 1), "faiss_time": round(faiss_time, 1),
            "agent_steps": agent_steps, "agent_tools": agent_tools,
            "agent_score": agent_score, "faiss_score": faiss_score,
            "agent_weighted": round(agent_weighted, 1), "faiss_weighted": round(faiss_weighted, 1),
            "agent_answer": agent_answer[:500], "faiss_answer": faiss_answer[:500],
        })

    # ═══════════════════════════════════════════════════
    # Summary Report
    # ═══════════════════════════════════════════════════
    print("\n" + "=" * 80)
    print("  测评总结报告")
    print("=" * 80)

    agent_passed = [r for r in results if r["agent_ok"]]
    agent_failed = [r for r in results if not r["agent_ok"]]
    faiss_passed = [r for r in results if r["faiss_ok"]]

    print(f"\nAgent 通过率: {len(agent_passed)}/{len(results)} ({len(agent_passed)*100//len(results)}%)")
    print(f"FAISS 通过率: {len(faiss_passed)}/{len(results)} ({len(faiss_passed)*100//len(results)}%)")

    if agent_passed:
        avg_agent = sum(r["agent_score"]["total"] for r in agent_passed) / len(agent_passed)
        avg_agent_w = sum(r["agent_weighted"] for r in agent_passed) / sum(r["weight"] for r in agent_passed)
        avg_time = sum(r["agent_time"] for r in agent_passed) / len(agent_passed)
        avg_steps = sum(r["agent_steps"] for r in agent_passed) / len(agent_passed)
        print(f"\nAgent 平均分: {avg_agent:.1f}/10 (加权: {avg_agent_w:.1f})")
        print(f"Agent 平均耗时: {avg_time:.1f}s | 平均步骤: {avg_steps:.1f}")

    if faiss_passed:
        avg_faiss = sum(r["faiss_score"]["total"] for r in faiss_passed) / len(faiss_passed)
        print(f"FAISS 平均分: {avg_faiss:.1f}/10")

    # By category
    print("\n--- 按赛题要求分类 ---")
    for req_cat in ["复杂版面解析", "语义智能切分", "端到端自动化"]:
        cat_results = [r for r in results if r["category"] == req_cat and r["agent_ok"]]
        if cat_results:
            avg = sum(r["agent_score"]["total"] for r in cat_results) / len(cat_results)
            print(f"  {req_cat}: {avg:.1f}/10 ({len(cat_results)}题)")

    # MedBench dimensions
    med_cat_results = [r for r in results if r["category"] == "MedBench专项" and r["agent_ok"]]
    mixed_cat_results = [r for r in results if r["category"] == "综合挑战" and r["agent_ok"]]

    if med_cat_results:
        avg = sum(r["agent_score"]["total"] for r in med_cat_results) / len(med_cat_results)
        print(f"  MedBench专项: {avg:.1f}/10 ({len(med_cat_results)}题)")

    if mixed_cat_results:
        avg = sum(r["agent_score"]["total"] for r in mixed_cat_results) / len(mixed_cat_results)
        print(f"  综合挑战: {avg:.1f}/10 ({len(mixed_cat_results)}题)")

    # By MedBench dimension
    print("\n--- 按MedBench维度分类 ---")
    dims = {}
    for r in results:
        dim = r["medbench_dim"]
        if dim not in dims:
            dims[dim] = []
        dims[dim].append(r["agent_score"]["total"] if r["agent_ok"] else 0)

    for dim, scores in sorted(dims.items()):
        avg = sum(scores) / len(scores)
        print(f"  {dim}: {avg:.1f}/10 ({len(scores)}题)")

    # Detailed breakdown
    print("\n--- 逐题详表 ---")
    print(f"{'ID':<8} {'类别':<12} {'Agent':>5} {'FAISS':>5} {'耗时':>6} {'步骤':>4} {'加权':>5}")
    print("-" * 56)
    for r in results:
        a_s = r["agent_score"]["total"] if r["agent_ok"] else "-"
        f_s = r["faiss_score"]["total"] if r["faiss_ok"] else "-"
        print(f"{r['id']:<8} {r['subcategory']:<12} {str(a_s):>5} {str(f_s):>5} {r['agent_time']:>5.0f}s {r['agent_steps']:>4} {r['agent_weighted']:>5.1f}")

    # Save report
    report = {
        "timestamp": datetime.now().isoformat(),
        "total_cases": len(TEST_CASES),
        "agent_pass_rate": f"{len(agent_passed)}/{len(results)}",
        "avg_agent_score": round(avg_agent, 1) if agent_passed else 0,
        "avg_agent_time": round(avg_time, 1) if agent_passed else 0,
        "avg_agent_steps": round(avg_steps, 1) if agent_passed else 0,
        "results": results,
    }
    os.makedirs(".gstack/qa-reports", exist_ok=True)
    with open(".gstack/qa-reports/competency-report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n报告已保存: .gstack/qa-reports/competency-report.json")

    return results


if __name__ == "__main__":
    main()
