"""
Gradio UI v3 — async agent with reasoning trace

Features:
  - Dual-column UI: left = reasoning trace (streaming), right = answer
  - Document upload tab with progress indicator
  - Knowledge base stats tab
  - Async callbacks for LightRAG compatibility
"""

import sys
import json
from pathlib import Path
from datetime import datetime
import gradio as gr

sys.path.insert(0, str(Path(__file__).parent))
from src.pipeline import MedicalRAGPipeline
from src.agent import MedicalAgent

_pipeline = None


def get_pipeline():
    global _pipeline
    if _pipeline is None:
        _pipeline = MedicalRAGPipeline(content_dir="./output/remote_test")
        try:
            _pipeline.load_index()
        except Exception:
            _pipeline.load_documents()
            _pipeline.build_index()
        # Auto-restore LightRAG if storage exists
        if Path("./lightrag_storage/graph_chunk_entity_relation.graphml").exists():
            try:
                _pipeline._init_lightrag()
                _pipeline._lightrag_ready = True
            except Exception:
                pass
    return _pipeline


async def ask_agent(question, top_k):
    """Async agent query with reasoning trace."""
    if not question.strip():
        return "请输入问题", "等待推理..."

    p = get_pipeline()
    agent = MedicalAgent(p)
    result = agent.run(question)

    answer = result["answer"]
    trace = result.get("reasoning_trace", [])
    steps = result.get("steps", 0)

    trace_md = f"### 推理过程 ({steps}步)\n"
    if trace:
        for t in trace:
            tool = t.get("tool", "unknown")
            args = t.get("args", {})
            preview = t.get("result_preview", "")[:200]
            trace_md += f"\n**Step {t['step']}: `{tool}`**\n"
            trace_md += f"- 参数: {json.dumps(args, ensure_ascii=False)}\n"
            trace_md += f"- 结果: {preview}...\n"
    else:
        trace_md += "\n*(无推理步骤 — LLM直接回答)*\n"

    return answer, trace_md


def get_stats():
    """Get knowledge base stats."""
    p = get_pipeline()
    s = p.get_stats()
    unique = sorted(set(x.split(" [p.")[0] for x in p.sources))
    return f"""## 知识库状态
- **文档数**: {s['total_documents']}
- **文本块**: {s['total_chunks']}
- **索引向量**: {s['faiss_index_size']}
- **嵌入维度**: {s.get('embedding_dim', 1024)}
- **LightRAG**: {'已就绪' if s.get('lightrag_ready') else '未构建'}

### 已加载文献
""" + "\n".join(f"- {u}" for u in unique)


def rebuild_kb():
    """Rebuild knowledge base from scratch."""
    p = get_pipeline()
    p.load_documents()
    p.build_index(force_rebuild=True)
    return get_stats()


def upload_document(file):
    """Handle document upload with progress."""
    if file is None:
        return "请选择文件上传", None

    upload_dir = Path("./uploads")
    upload_dir.mkdir(exist_ok=True)

    file_path = upload_dir / Path(file).name
    content = Path(file).read_bytes()
    file_path.write_bytes(content)

    upload_status = f"""### 上传完成
- 文件: {Path(file).name}
- 大小: {len(content) / 1024:.1f} KB
- 保存路径: {file_path}
- 状态: 已保存，请使用远程MinerU解析后通过 `/api/batch-import` 导入

> 提示: 将解析后的 `*_content_list.json` 文件放入 `output/remote_test/` 目录后点击"重建索引"
"""
    return upload_status, None


def load_design_doc():
    """Load the architecture design doc for the system info tab."""
    doc_path = Path("docs/plans/2026-05-22-agentic-rag-design.md")
    if doc_path.exists():
        return doc_path.read_text(encoding="utf-8")[:3000]
    return """### 技术架构

```
PDF → MinerU解析 → BGE-M3 Embedding → FAISS向量索引 → Agent多步推理 → 带溯源的答案
```

#### 技术栈
| 组件 | 技术 |
|------|------|
| 文档解析 | MinerU 3.1 (pipeline backend, Linux GPU) |
| 文本嵌入 | BGE-M3 (1024维, 本地GPU) |
| 向量检索 | FAISS IndexFlatIP |
| Agent推理 | OpenAI Function Calling + DeepSeek-V4-Pro |
| UI框架 | Gradio (async) |
| API框架 | FastAPI |
"""


with gr.Blocks(
    title="医疗文献 Agentic RAG",
    theme=gr.themes.Soft(primary_hue="blue"),
    css="""
    .medical-header { background: linear-gradient(135deg, #1e3a5f, #2d6da4); color: white; padding: 20px; border-radius: 10px; margin-bottom: 10px; }
    """
) as demo:
    gr.HTML("""
    <div class="medical-header">
        <h1>医疗文献 Agentic RAG 知识库系统</h1>
        <p>MinerU文档解析 + BGE-M3向量嵌入 + FAISS检索 + Agent多步推理 + DeepSeek-V4-Pro问答</p>
    </div>
    """)

    with gr.Tabs():
        # ── Tab 1: 智能问答 (dual-column) ──
        with gr.TabItem("智能问答"):
            with gr.Row():
                query_input = gr.Textbox(
                    label="医学问题",
                    placeholder="例如: Stanford B型主动脉夹层不同治疗方式的疗效对比如何？请按证据等级排列。",
                    lines=3, scale=3)
                with gr.Column(scale=1):
                    top_k = gr.Slider(1, 20, value=8, step=1, label="检索数量")
                    submit_btn = gr.Button("提交", variant="primary")

            with gr.Row():
                with gr.Column(scale=1):
                    reasoning_output = gr.Markdown("等待推理...", label="推理过程")
                with gr.Column(scale=2):
                    answer_output = gr.Markdown("等待回答...", label="回答")

            submit_btn.click(
                fn=ask_agent,
                inputs=[query_input, top_k],
                outputs=[answer_output, reasoning_output]
            )

            gr.Markdown("### 快速测试")
            gr.Examples(
                examples=[
                    ["Stanford B型主动脉夹层的诊断标准是什么？", 8],
                    ["Stanford B型主动脉夹层如何分型和分期？", 8],
                    ["TBAD的药物治疗方案有哪些？", 8],
                    ["主动脉夹层腔内修复术的适应症是什么？", 8],
                ],
                inputs=[query_input, top_k],
            )

        # ── Tab 2: 文档上传 ──
        with gr.TabItem("文档上传"):
            gr.Markdown("### 上传医学文献PDF")
            gr.Markdown("上传后需通过远程MinerU解析，然后将解析结果导入知识库。")

            with gr.Row():
                upload_input = gr.File(
                    label="选择PDF文件",
                    file_types=[".pdf"],
                    type="filepath",
                )
                upload_btn = gr.Button("上传", variant="primary")

            upload_status = gr.Markdown("等待上传...")
            upload_btn.click(
                fn=upload_document,
                inputs=[upload_input],
                outputs=[upload_status, upload_input],
            )

            gr.Markdown("---")
            gr.Markdown("### 工作流程")
            gr.Markdown("""
            1. 上传PDF到此页面
            2. 将PDF传输到远程Linux服务器
            3. 使用 `scripts/remote_parse.py` 通过MinerU解析
            4. 将解析生成的 `*_content_list.json` 放入 `output/remote_test/`
            5. 去"知识库"标签页点击"重建索引"
            """)

        # ── Tab 3: 知识库 ──
        with gr.TabItem("知识库"):
            with gr.Row():
                refresh_btn = gr.Button("刷新状态", variant="primary")
                reload_btn = gr.Button("重建索引", variant="secondary")

            stats_output = gr.Markdown()
            refresh_btn.click(fn=get_stats, inputs=[], outputs=stats_output)
            reload_btn.click(fn=rebuild_kb, inputs=[], outputs=stats_output)

        # ── Tab 4: 系统信息 ──
        with gr.TabItem("系统信息"):
            sys_info = gr.Markdown(load_design_doc())

if __name__ == "__main__":
    demo.launch(server_name="127.0.0.1", server_port=7860, share=False, show_error=True)
