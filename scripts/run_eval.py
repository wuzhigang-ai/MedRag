"""
MedASR 评测运行脚本 — 一键生成完整评测报告

用法:
  python scripts/run_eval.py          # 运行完整评测
  python scripts/run_eval.py --quick  # 快速评测(5题采样)
  python scripts/run_eval.py --grade  # GRADE证据评估报告
"""

import sys
import json
import asyncio
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.pipeline import MedicalRAGPipeline
from eval.medbench_eval import MedBenchEvaluator
from src.grade_evaluator import GRADEEvaluator


def run_quick_eval(pipeline):
    """快速评测 - 5题采样"""
    evaluator = MedBenchEvaluator(pipeline)
    
    # 只取前5题
    quick_questions = [
        {"id": "quick-001", "question": "Stanford B型主动脉夹层的定义是什么？",
         "expected_keywords": ["主动脉", "夹层", "降主动脉"], "category": "knowledge_qa"},
        {"id": "quick-002", "question": "TBAD的首选影像学检查是什么？",
         "expected_keywords": ["CTA", "CT", "血管造影"], "category": "clinical_diagnosis"},
        {"id": "quick-003", "question": "非复杂性TBAD的首选治疗策略是什么？",
         "expected_keywords": ["药物治疗", "OMT", "BMT"], "category": "treatment_recommendation"},
        {"id": "quick-004", "question": "TEVAR的适应症有哪些？",
         "expected_keywords": ["复杂性", "灌注不良", "破裂"], "category": "treatment_recommendation"},
        {"id": "quick-005", "question": "β受体阻滞剂在TBAD治疗中的作用机制",
         "expected_keywords": ["心率", "血压", "β受体"], "category": "pharmacology"},
    ]
    
    results = []
    for q in quick_questions:
        ret = pipeline.retrieve(q["question"], top_k=5)
        all_text = " ".join([r.get("text", "")[:300] for r in ret])
        hits = [kw for kw in q["expected_keywords"] if kw in all_text]
        results.append({
            "id": q["id"], "question": q["question"],
            "keyword_hits": len(hits), "keywords_expected": len(q["expected_keywords"]),
            "recall": len(hits) / max(1, len(q["expected_keywords"])),
            "sources": len(ret),
        })
    
    return {
        "mode": "quick",
        "questions": len(quick_questions),
        "avg_recall": sum(r["recall"] for r in results) / len(results),
        "results": results,
    }


def run_grade_eval(pipeline):
    """GRADE证据评估"""
    evaluator = GRADEEvaluator()
    
    # 获取所有文档的chunk_meta信息
    doc_types = {}
    if hasattr(pipeline, 'chunk_meta'):
        for meta in pipeline.chunk_meta:
            doc_name = meta.get("doc_name", "unknown")
            et = meta.get("evidence_type", "unknown")
            if doc_name not in doc_types:
                doc_types[doc_name] = et
    
    # 或从_doc_map获取
    if hasattr(pipeline, '_doc_map') and not doc_types:
        doc_types = {name: "unknown" for name in pipeline._doc_map.keys()}
    
    if not doc_types:
        return {"error": "未找到已索引的文献"}
    
    assessments = {}
    for doc_name, ev_type in doc_types.items():
        # 检索该文献的关键发现
        ret = pipeline.retrieve(doc_name, top_k=3)
        findings = [r.get("text", "")[:800] for r in ret]
        
        a = evaluator.assess_single(
            doc_id=doc_name, title=doc_name,
            evidence_type=ev_type, key_findings=findings, pico={}
        )
        assessments[doc_name] = a
    
    return evaluator.generate_evidence_profile(assessments)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="MedASR 评测运行脚本")
    parser.add_argument("--quick", action="store_true", help="快速评测")
    parser.add_argument("--grade", action="store_true", help="GRADE证据评估")
    parser.add_argument("--full", action="store_true", help="完整MedBench评测")
    parser.add_argument("--output", type=str, default="eval_report.json", help="输出文件")
    args = parser.parse_args()
    
    print("初始化 MedicalRAGPipeline...")
    pipeline = MedicalRAGPipeline()
    pipeline.load_documents()
    pipeline.build_index()
    stats = pipeline.get_stats()
    print(f"知识库: {stats}")
    
    report = {
        "system": "MedASR v1.0",
        "evaluation_type": "quick" if args.quick else ("grade" if args.grade else "full"),
        "knowledge_base_stats": stats,
    }
    
    if args.quick:
        print("\n运行快速评测...")
        report["quick_eval"] = run_quick_eval(pipeline)
        print(f"  平均Recall: {report['quick_eval']['avg_recall']:.2%}")
        
    elif args.grade:
        print("\n运行GRADE证据评估...")
        report["grade_eval"] = run_grade_eval(pipeline)
        profile = report["grade_eval"]
        print(f"  评估文献: {profile['total_assessed']}篇")
        print(f"  证据分布: {profile['distribution']}")
        print(f"  整体评估: {profile['overall_assessment']}")
        
    else:  # full
        print("\n运行完整MedBench评测...")
        evaluator = MedBenchEvaluator(pipeline)
        report["medbench"] = asyncio.run(evaluator.run_full_evaluation())
        report["comparison"] = evaluator.run_comparison_benchmark()
        
        summary = report["medbench"]["summary"]
        print(f"  MRR: {summary['mrr']:.4f}")
        print(f"  Recall@5: {summary['recall@5']:.4f}")
        print(f"  Precision@5: {summary['precision@5']:.4f}")
        print(f"  关键词命中率: {summary['keyword_hit_rate']:.4f}")
    
    # 保存
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n评测报告已保存: {args.output}")


if __name__ == "__main__":
    main()