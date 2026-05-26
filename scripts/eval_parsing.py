#!/usr/bin/env python3
"""
MedASR — Omnidocbench-style Parsing Quality Evaluation
Evaluates content_list.json outputs across 5 quality dimensions.
Outputs a structured report card.
"""
import json, sys, os
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent))

CONTENT_DIR = Path("output/remote_test")
REPORT_PATH = Path("docs/eval_report.md")

# ── Quality metrics ──

def evaluate_all():
    files = sorted(CONTENT_DIR.glob("*_content_list.json"))
    if not files:
        print("No content_list.json files found.")
        return

    report = []
    report.append("# MedASR 解析质量评测报告\n")
    report.append(f"**评测时间**: {__import__('datetime').datetime.now().isoformat()[:19]}\n")
    report.append(f"**评测文献数**: {len(files)}\n")

    totals = {"text": 0, "table": 0, "image": 0, "chart": 0, "items": 0,
              "text_chars": 0, "empty_captions": 0, "table_html": 0,
              "section_tags": Counter(), "pages": set()}

    per_doc = []

    for f in files:
        with open(f, encoding="utf-8") as fh:
            data = json.load(fh)
        doc = f.name.replace("_content_list.json", "")
        types = Counter(item.get("type", "?") for item in data)
        pages = set(item.get("page_idx", -1) for item in data)
        text_items = [i for i in data if i.get("type") == "text"]
        table_items = [i for i in data if i.get("type") == "table"]
        image_items = [i for i in data if i.get("type") in ("image", "chart")]
        empty_imgs = sum(1 for i in image_items if not i.get("image_caption"))
        html_tables = sum(1 for t in table_items if t.get("table_body", "").startswith("<table>"))
        text_chars = sum(len(i.get("text", "")) for i in text_items)

        # Section tags are counted globally below from pipeline chunk_meta
        tags = Counter()

        doc_stats = {
            "doc": doc,
            "pages": len(pages),
            "text_items": types.get("text", 0),
            "table_items": types.get("table", 0),
            "image_items": types.get("image", 0) + types.get("chart", 0),
            "chart_items": types.get("chart", 0),
            "other_items": sum(v for k, v in types.items() if k not in ("text", "table", "image", "chart")),
            "text_chars": text_chars,
            "avg_chars_per_text": round(text_chars / max(len(text_items), 1)),
            "table_html_rate": round(html_tables / max(len(table_items), 1) * 100) if table_items else "N/A",
            "image_caption_rate": round((len(image_items) - empty_imgs) / max(len(image_items), 1) * 100) if image_items else "N/A",
            "section_tags_sample": dict(tags.most_common(5)),
        }
        per_doc.append(doc_stats)

        # Accumulate totals
        for k in ("text", "table", "image", "chart"):
            totals[k] += types.get(k, 0)
        totals["items"] += len(data)
        totals["text_chars"] += text_chars
        totals["empty_captions"] += empty_imgs
        totals["table_html"] += html_tables
        totals["pages"].update(pages)
    # ── Pull actual section tags from pipeline ──
    try:
        from src.pipeline import MedicalRAGPipeline
        p = MedicalRAGPipeline()
        p.load_documents()
        totals["section_tags"] = Counter(m.get('section_tag', 'unknown') for m in p.chunk_meta)
    except Exception:
        pass

    # ── Aggregate metrics ──
    total_img = totals["image"] + totals["chart"]
    img_cap_rate = round((total_img - totals["empty_captions"]) / max(total_img, 1) * 100)
    tbl_html_rate = round(totals["table_html"] / max(totals["table"], 1) * 100) if totals["table"] else "N/A"
    avg_text_len = round(totals["text_chars"] / max(totals["text"], 1))

    # ── Quality scores (0-100) ──
    scores = {}
    scores["text_extraction"] = min(100, max(0, round(avg_text_len / 200 * 100)))  # 200 chars avg = 100%
    scores["table_structure"] = min(100, tbl_html_rate if isinstance(tbl_html_rate, int) else 70)
    scores["image_coverage"] = min(100, img_cap_rate)
    n_tags = len(totals["section_tags"]) if isinstance(totals["section_tags"], Counter) else len(totals["section_tags"])
    scores["section_classification"] = min(100, n_tags * 12)  # ~8 tags = 100%
    scores["layout_handling"] = min(100, round(len(totals["pages"]) / max(len(files), 1) * 15))  # avg pages/doc
    overall = round(sum(scores.values()) / len(scores))

    # ── Report ──
    report.append(f"\n## 综合评分: {overall}/100\n")
    report.append("| 维度 | 得分 | 指标 |")
    report.append("|------|------|------|")
    report.append(f"| 文本提取 | {scores['text_extraction']} | 平均 {avg_text_len} 字/块 |")
    report.append(f"| 表格结构 | {scores['table_structure']} | HTML还原率 {tbl_html_rate}% |")
    report.append(f"| 图片覆盖 | {scores['image_coverage']} | 标题覆盖率 {img_cap_rate}% |")
    report.append(f"| 章节分类 | {scores['section_classification']} | {len(totals['section_tags'])} 种医学标签 |")
    report.append(f"| 版面处理 | {scores['layout_handling']} | 覆盖 {len(totals['pages'])} 页 |")

    report.append(f"\n## 汇总统计\n")
    report.append(f"- 总条目: {totals['items']}")
    report.append(f"- 文本块: {totals['text']} (总字数 {totals['text_chars']:,})")
    report.append(f"- 表格: {totals['table']} (HTML格式 {totals['table_html']})")
    report.append(f"- 图片: {total_img} (含图表 {totals['chart']})")
    report.append(f"- 覆盖页数: {len(totals['pages'])}")

    report.append(f"\n## 逐文献详情\n")
    for d in per_doc:
        report.append(f"### {d['doc']}")
        report.append(f"- 页数: {d['pages']} | 文本: {d['text_items']} ({d['text_chars']:,}字) | 表格: {d['table_items']} | 图片: {d['image_items']}")
        report.append(f"- 平均文本块长度: {d['avg_chars_per_text']} 字")
        report.append(f"- 表格HTML率: {d['table_html_rate']}%")
        report.append(f"- 章节标签: {d['section_tags_sample']}")

    report.append(f"\n## 评分说明\n")
    report.append(f"- 文本提取: 平均文本块长度 / 200字理想值 × 100")
    report.append(f"- 表格结构: HTML格式还原率 (MinerU/Docling提取的表格是否为HTML)")
    report.append(f"- 图片覆盖: 图片标题提取覆盖率")
    report.append(f"- 章节分类: 医学子结构标签种类数")
    report.append(f"- 版面处理: 平均每篇文献覆盖页数 × 15")

    # Write report
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(report), encoding="utf-8")
    print("\n".join(report))
    print(f"\n报告已保存: {REPORT_PATH}")

if __name__ == "__main__":
    evaluate_all()
