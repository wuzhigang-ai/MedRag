# Agentic RAG 端到端系统 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建 Agentic RAG 医疗文献系统: PDF上传→自动解析→知识图谱→nanobot Agent多步推理→带溯源回答

**Architecture:** 双引擎 Pipeline (FAISS + LightRAG) + nanobot Agent (6 tools) + Gradio UI (流式推理过程)

**Tech Stack:** Python 3.13, BGE-M3, FAISS, RAG-Anything/LightRAG, nanobot, Gradio, FastAPI, 百度DeepSeek-V4-Pro, 讯飞GLM-5.1, Moonshot

---

## Task 1: Install nanobot + Verify Environment

**Files:** None (dependency install only)

**Step 1: Install nanobot**

```bash
pip install nanobot-ai
```

**Step 2: Verify import**

```bash
python -c "from nanobot import Agent; print('nanobot OK')"
```

Expected: `nanobot OK`

**Step 3: Commit**

```bash
git add requirements.txt  # if updated
git commit -m "chore: add nanobot dependency"
```

---

## Task 2: LightRAG 知识图谱构建 (先跑通核心引擎)

**Files:**
- `src/pipeline.py` — 已完成的 LightRAG 集成代码
- `output/remote_test/` — 7 篇已解析文档

**Step 1: 运行 LightRAG 构建**

```bash
cd "项目的根目录"
python -m src.pipeline --lightrag
```

**Step 2: 观察输出，确认:**
- 讯飞 GLM-5.1 实体提取正常 (无超时)
- 7 篇文档全部插入成功
- `lightrag_ready: True`

**Step 3: 如果讯飞超时 — 自动使用百度 Flash 兜底，确认降级链工作**

**Step 4: Commit**

```bash
git add src/pipeline.py
git commit -m "feat: LightRAG knowledge graph construction with 讯飞GLM-5.1 + 百度Flash fallback"
```

---

## Task 3: API Key 安全化 (移到 .env)

**Files:**
- Modify: `src/pipeline.py:43-66` — PROVIDERS 字典
- Create: `.env.example`

**Step 1: 将 PROVIDERS 中的硬编码 API key 替换为 os.getenv()**

修改 `src/pipeline.py` 的 PROVIDERS 字典:

```python
PROVIDERS = {
    "xunfei": {
        "base_url": os.getenv("XUNFEI_BASE_URL", "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2"),
        "api_key": os.getenv("XUNFEI_API_KEY", ""),
        "model": "astron-code-latest",
    },
    "baidu_flash": {
        "base_url": os.getenv("BAIDU_BASE_URL", "https://qianfan.baidubce.com/v2/coding"),
        "api_key": os.getenv("BAIDU_API_KEY", ""),
        "model": "deepseek-v4-flash",
    },
    "baidu_pro": {
        "base_url": os.getenv("BAIDU_BASE_URL", "https://qianfan.baidubce.com/v2/coding"),
        "api_key": os.getenv("BAIDU_API_KEY", ""),
        "model": "deepseek-v4-pro",
    },
    "moonshot_vision": {
        "base_url": os.getenv("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"),
        "api_key": os.getenv("MOONSHOT_API_KEY", ""),
        "model": "moonshot-v1-128k-vision-preview",
    },
}
```

**Step 2: 创建 .env.example**

```
XUNFEI_BASE_URL=https://maas-coding-api.cn-huabei-1.xf-yun.com/v2
XUNFEI_API_KEY=your_xunfei_key_here
BAIDU_BASE_URL=https://qianfan.baidubce.com/v2/coding
BAIDU_API_KEY=your_baidu_key_here
MOONSHOT_BASE_URL=https://api.moonshot.cn/v1
MOONSHOT_API_KEY=your_moonshot_key_here
```

**Step 3: 更新 .env 填入实际密钥**

**Step 4: 验证**

```bash
python -c "from src.pipeline import MedicalRAGPipeline; p = MedicalRAGPipeline(); print('Keys loaded from env')"
```

Expected: `Keys loaded from env`

**Step 5: Commit**

```bash
git add src/pipeline.py .env.example
git commit -m "security: move API keys to .env, add .env.example template"
```

---

## Task 4: FAISS 索引修复 (去重 + 同步保护 + 启动缓存)

**Files:**
- Modify: `src/pipeline.py:_load_faiss_documents()` (line 168-220)
- Modify: `src/pipeline.py:build_index()` (line 223)
- Modify: `api.py:get_pipeline()` (line 39-48)

**Step 1: 添加 content hash 去重**

在 `_load_faiss_documents()` 中，追加 chunk 前计算 MD5:

```python
seen_hashes = set()
for doc_name, items in loaded_docs:
    for item in items:
        text = item.get("text", "").strip()
        if text and len(text) > 30:
            h = hashlib.md5(text.encode()).hexdigest()
            if h in seen_hashes:
                continue
            seen_hashes.add(h)
            self.all_chunks.append(text)
            ...
```

**Step 2: load_documents() 后自动 reset FAISS index**

```python
def load_documents(self, content_dir: str = None) -> int:
    if content_dir:
        self.content_dir = Path(content_dir)
    self.faiss_index = None  # 强制重建
    return self._load_faiss_documents()
```

**Step 3: build_index() 后自动 save_index()**

在 `_build_faiss_index()` 末尾添加:
```python
self.save_index()
```

**Step 4: get_pipeline() 启动时自动 load_index**

修改 `api.py`:
```python
def get_pipeline():
    global pipeline
    if pipeline is None:
        pipeline = MedicalRAGPipeline()
        if not pipeline.load_index():      # 尝试加载缓存
            pipeline.load_documents()       # 缓存失效则重建
            pipeline.build_index()
    return pipeline
```

**Step 5: 验证**

```bash
python -c "
from src.pipeline import MedicalRAGPipeline
p = MedicalRAGPipeline()
p.load_documents()
p.build_index()
# 现在 all_chunks 中不应有重复内容
print(f'Loaded {len(p.all_chunks)} unique chunks')
"
```

Expected: chunk 数量 < 345 (去除重复后)

**Step 6: Commit**

```bash
git add src/pipeline.py api.py
git commit -m "fix: add dedup, index sync protection, startup cache loading"
```

---

## Task 5: 创建 src/agent.py — nanobot Agent + 6 Tools

**Files:**
- Create: `src/agent.py`

**Step 1: 定义 6 个 tool 的 JSON Schema**

```python
"""Medical RAG Agent — nanobot-powered multi-hop reasoning"""

import json
from typing import Dict, List, Any
from src.pipeline import MedicalRAGPipeline, PROVIDERS

# ─── Tool Definitions ──────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_rag",
            "description": "检索医学文献知识库。输入中文临床问题，返回相关文献片段及其来源、证据等级。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "中文检索查询"},
                    "top_k": {"type": "integer", "default": 5, "description": "返回结果数"},
                    "engine": {
                        "type": "string",
                        "enum": ["faiss", "lightrag", "hybrid"],
                        "default": "hybrid",
                        "description": "检索引擎: faiss(语义), lightrag(知识图谱), hybrid(两者融合)"
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cross_check",
            "description": "检查多篇文献关于某医学主题的结论是否一致。用于发现证据矛盾。",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "要检查的医学主题"},
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_evidence",
            "description": "获取某篇文献的证据等级(Meta/RCT/Cohort等)和PICO框架(人群/干预/对照/结局)。",
            "parameters": {
                "type": "object",
                "properties": {
                    "doc_name": {"type": "string", "description": "文献名称(从search_rag结果的source字段获取)"},
                },
                "required": ["doc_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_docs",
            "description": "列出知识库中所有已索引的医学文献及其基本信息。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "deep_retrieve",
            "description": "从多个角度深度检索同一主题。用于第一轮检索不充分时补充信息。",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "检索主题"},
                    "aspects": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "检索角度列表, 如['diagnosis','treatment','prognosis','safety']"
                    },
                },
                "required": ["topic", "aspects"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "extract_chart",
            "description": "提取医学文献图表中的具体数据(森林图效应量、基线表特征等)。",
            "parameters": {
                "type": "object",
                "properties": {
                    "doc_name": {"type": "string", "description": "文献名称"},
                    "chart_description": {"type": "string", "description": "图表描述(如'Table 1 基线特征'或'Figure 2 森林图')"},
                },
                "required": ["doc_name", "chart_description"],
            },
        },
    },
]

SYSTEM_PROMPT = """你是一位循证医学专家Agent。你可以使用以下工具来检索和分析医学文献:

1. search_rag — 检索文献知识库
2. cross_check — 检查多文献一致性
3. get_evidence — 获取文献证据等级
4. list_docs — 列出所有文献
5. deep_retrieve — 多角度深度检索
6. extract_chart — 提取图表数据

## 推理规则
- 收到医学问题后，先用 search_rag 检索相关文献
- 如果涉及多篇文献的结论比较，用 cross_check 验证一致性
- 回答必须按证据等级排列 (Meta > RCT > Cohort > Expert Consensus)
- 每个关键事实必须标注来源: [文献名, 页码, 证据等级]
- 如果检索结果不足以回答问题，用 deep_retrieve 补充检索
- 如果涉及具体数据，用 extract_chart 提取图表信息
- 使用中文回答，保留医学术语的英文缩写"""
```

**Step 2: 实现 tool 执行函数**

```python
class MedicalAgent:
    """nanobot-powered medical RAG agent"""

    def __init__(self, pipeline: MedicalRAGPipeline):
        self.pipeline = pipeline
        self.tools = TOOLS

    def execute_tool(self, tool_name: str, args: dict) -> str:
        """Execute a tool call from the agent and return JSON string"""
        if tool_name == "search_rag":
            results = self.pipeline._faiss_retrieve(
                query=args["query"],
                top_k=args.get("top_k", 5),
            )
            return json.dumps(results, ensure_ascii=False, indent=2)

        elif tool_name == "cross_check":
            # Use medical_kg if available, else basic check
            results = self.pipeline._faiss_retrieve(args["topic"], top_k=10)
            docs_found = list(set(r["source"] for r in results))
            return json.dumps({
                "topic": args["topic"],
                "documents_found": docs_found,
                "count": len(docs_found),
                "note": "cross-document consistency requires 2+ documents on same topic",
            }, ensure_ascii=False)

        elif tool_name == "get_evidence":
            doc_name = args["doc_name"]
            # Find matching chunks to infer evidence level
            matching = [m for m in self.pipeline.chunk_meta if doc_name in m.get("doc_name", "")]
            evidence_type = matching[0].get("evidence_type", "unknown") if matching else "unknown"
            return json.dumps({
                "doc_name": doc_name,
                "evidence_type": evidence_type,
                "chunk_count": len(matching),
            }, ensure_ascii=False)

        elif tool_name == "list_docs":
            docs = sorted(set(s.split(" [p.")[0] for s in self.pipeline.sources))
            return json.dumps([{"name": d, "chunks": sum(1 for s in self.pipeline.sources if d in s)} for d in docs], ensure_ascii=False)

        elif tool_name == "deep_retrieve":
            all_results = []
            for aspect in args.get("aspects", []):
                q = f"{args['topic']} {aspect}"
                results = self.pipeline._faiss_retrieve(q, top_k=3)
                for r in results:
                    r["aspect"] = aspect
                all_results.extend(results)
            return json.dumps(all_results, ensure_ascii=False, indent=2)

        elif tool_name == "extract_chart":
            # For now: search for chart/table mentions in chunks
            results = self.pipeline._faiss_retrieve(
                f"{args['doc_name']} {args['chart_description']}", top_k=3
            )
            # Filter for table/image type
            chart_results = [r for r in results if "表格" in r["text"] or "图片" in r["text"] or "table" in r.get("source", "").lower()]
            return json.dumps(chart_results if chart_results else results[:3], ensure_ascii=False, indent=2)

        return json.dumps({"error": f"Unknown tool: {tool_name}"})
```

**Step 3: nanobot Agent 初始化**

```python
    async def run(self, query: str) -> dict:
        """Run agent with multi-hop reasoning"""
        from nanobot import Agent

        agent = Agent(
            model=PROVIDERS["baidu_pro"]["model"],
            api_key=PROVIDERS["baidu_pro"]["api_key"],
            base_url=PROVIDERS["baidu_pro"]["base_url"],
            system_prompt=SYSTEM_PROMPT,
            tools=self.tools,
            tool_executor=self.execute_tool,
        )

        response = await agent.run(query)

        return {
            "answer": response.get("content", str(response)),
            "reasoning_trace": response.get("tool_calls", []),
            "model_used": PROVIDERS["baidu_pro"]["model"],
        }
```

**Step 4: 验证 Agent 初始化**

```bash
python -c "
import asyncio
from src.pipeline import MedicalRAGPipeline
from src.agent import MedicalAgent, TOOLS

p = MedicalRAGPipeline()
p.load_documents()
p.build_index()

agent = MedicalAgent(p)
print(f'Agent initialized with {len(agent.tools)} tools')
print(f'Tool names: {[t[\"function\"][\"name\"] for t in agent.tools]}')
"
```

Expected: `Agent initialized with 6 tools`

**Step 5: Commit**

```bash
git add src/agent.py
git commit -m "feat: add nanobot medical agent with 6 RAG tools"
```

---

## Task 6: 集成 resilience.py + GPU 保护

**Files:**
- Modify: `src/pipeline.py:_llm_entity_extract()` — 使用 resilience.py
- Modify: `src/pipeline.py:encode()` — GPU OOM 降级

**Step 1: encode() 添加 GPU 内存检查**

修改 `src/pipeline.py` 的 `encode()`:
```python
def encode(self, texts: List[str], show_progress: bool = False) -> np.ndarray:
    import torch
    torch.cuda.empty_cache()
    
    # GPU memory check: fallback to CPU if < 2GB free
    try:
        free_mem = torch.cuda.mem_get_info()[0] / 1024**3
        device = "cuda" if free_mem > 2.0 else "cpu"
    except Exception:
        device = "cpu"
    
    if device == "cpu":
        self.embed_model.to("cpu")
    else:
        self.embed_model.to("cuda")
    
    return self.embed_model.encode(
        texts, normalize_embeddings=True,
        show_progress_bar=show_progress, batch_size=8,
    )
```

**Step 2: 集成 resilience.py 到 _llm_entity_extract**

将 `pipeline.py:_llm_entity_extract()` 的手动 try/except 替换为调用 `APIResilience`:

```python
def _llm_entity_extract(self, prompt: str, system_prompt: str = None) -> str:
    from src.resilience import APIResilience, RetryConfig, FallbackConfig
    
    resilience = APIResilience(
        self.clients["xunfei"],
        retry_config=RetryConfig(max_retries=3, base_delay=1.0),
        fallback_config=FallbackConfig(
            text_model_chain=["xunfei", "baidu_flash"],
        ),
    )
    
    result = resilience.call_text_sync(prompt, system_prompt=system_prompt)
    if result.success:
        return result.data
    raise RuntimeError(f"Entity extraction failed: {result.error}")
```

**Step 3: 验证**

```bash
python -c "
from src.pipeline import MedicalRAGPipeline
p = MedicalRAGPipeline()
# Test entity extraction with mock data
result = p._llm_entity_extract('提取实体: 患者服用阿司匹林后头痛缓解', '你是医学NER专家')
print(f'Entity extraction result: {result[:200]}')
"
```

**Step 4: Commit**

```bash
git add src/pipeline.py src/resilience.py
git commit -m "fix: integrate resilience retry + GPU OOM fallback to CPU"
```

---

## Task 7: 更新 api.py — Agent 端点 + 自动降级

**Files:**
- Modify: `api.py` — 已有端点，需更新

**Step 1: /api/query 改为自动降级**

```python
@app.post("/api/query")
async def query(req: QueryRequest):
    p = get_pipeline()
    
    # Try LightRAG first, fallback to FAISS
    if p._lightrag_ready:
        try:
            result = await p.aanswer(req.question, prefer_lightrag=True)
        except Exception:
            result = p.answer_with_sources(req.question, top_k=req.top_k)
    else:
        result = p.answer_with_sources(req.question, top_k=req.top_k)
    
    return QueryResponse(
        question=req.question,
        answer=result["answer"],
        source_count=result["source_count"],
        sources=result.get("sources", []),
        engine=result.get("engine", "faiss"),
        timestamp=datetime.now().isoformat(),
    )
```

**Step 2: 添加 /api/agent 端点 (nanobot Agent)**

```python
from src.agent import MedicalAgent

@app.post("/api/agent")
async def agent_query(req: QueryRequest):
    p = get_pipeline()
    agent = MedicalAgent(p)
    result = await agent.run(req.question)
    return {
        "question": req.question,
        "answer": result["answer"],
        "reasoning_trace": result["reasoning_trace"],
        "model_used": result["model_used"],
        "timestamp": datetime.now().isoformat(),
    }
```

**Step 3: 验证**

```bash
# Start API server
uvicorn api:app --port 8000 &

# Test FAISS query
curl -X POST http://localhost:8000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question":"Stanford B型主动脉夹层的诊断标准是什么？"}'

# Test health
curl http://localhost:8000/health
```

Expected: 200 OK with answer

**Step 4: Commit**

```bash
git add api.py
git commit -m "feat: add auto-fallback query + nanobot agent endpoint"
```

---

## Task 8: 更新 app.py — 新 UI 布局 + Agent 推理展示

**Files:**
- Modify: `app.py` — 完整重写 UI

**Step 1: 更新为 async 回调**

将 `sync_query` 替换为 `async def ask_agent()`:

```python
async def ask_agent(question, top_k):
    if not question.strip():
        return "请输入问题", ""
    p = get_pipeline()
    
    # Pre-load if needed
    if not p.all_chunks:
        p.load_documents()
        p.build_index()
    
    # Use agent for multi-hop reasoning
    from src.agent import MedicalAgent
    agent = MedicalAgent(p)
    result = await agent.run(question)
    
    answer = result["answer"]
    trace = result.get("reasoning_trace", [])
    
    # Format reasoning trace
    trace_md = "### 🧠 推理过程\n"
    for step in trace:
        tool_name = step.get("function", {}).get("name", "unknown")
        tool_args = step.get("function", {}).get("arguments", "{}")
        trace_md += f"- 🔍 **{tool_name}**({tool_args})\n"
    
    return answer, trace_md
```

**Step 2: UI 布局: 双列显示**

```python
with gr.Blocks(title="医疗文献 Agentic RAG") as demo:
    gr.HTML("<h1>🩺 医疗文献 Agentic RAG 知识库系统</h1>")
    
    with gr.Tabs():
        with gr.TabItem("🔍 智能问答"):
            with gr.Row():
                with gr.Column(scale=3):
                    query_input = gr.Textbox(
                        label="医学问题",
                        placeholder="例如: Stanford B型主动脉夹层不同治疗方式的疗效对比如何？",
                        lines=3,
                    )
                with gr.Column(scale=1):
                    top_k = gr.Slider(1, 20, value=8, label="检索数量")
                    submit_btn = gr.Button("提交", variant="primary")
            
            with gr.Row():
                with gr.Column(scale=1):
                    reasoning_output = gr.Markdown("等待推理...", label="推理过程")
                with gr.Column(scale=2):
                    answer_output = gr.Markdown("等待回答...", label="回答")
            
            submit_btn.click(
                fn=ask_agent,
                inputs=[query_input, top_k],
                outputs=[answer_output, reasoning_output],
            )
        
        with gr.TabItem("📄 文献上传"):
            upload_btn = gr.UploadButton("上传PDF", file_types=[".pdf"])
            upload_status = gr.Textbox(label="处理状态")
            upload_btn.upload(fn=handle_upload, inputs=upload_btn, outputs=upload_status)
        
        with gr.TabItem("📊 知识库"):
            refresh_btn = gr.Button("刷新")
            stats_output = gr.Markdown()
            refresh_btn.click(fn=get_stats_md, inputs=[], outputs=stats_output)
```

**Step 3: 验证 UI 启动**

```bash
python app.py
```

浏览器打开 `http://localhost:7860`，确认 UI 正常显示。

**Step 4: Commit**

```bash
git add app.py
git commit -m "feat: new agent UI with reasoning trace + answer dual-column layout"
```

---

## Task 9: 端到端集成测试

**Files:**
- Create: `tests/test_pipeline.py`

**Step 1: 创建测试脚本**

```python
"""端到端回归测试"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

def test_load_and_index():
    """测试: 加载文档 + 构建索引"""
    from src.pipeline import MedicalRAGPipeline
    p = MedicalRAGPipeline(content_dir="./output/remote_test")
    p.load_documents()
    p.build_index()
    
    assert p.faiss_index is not None, "FAISS index not built"
    assert p.faiss_index.ntotal > 0, "FAISS index empty"
    assert len(p.all_chunks) > 0, "No chunks loaded"
    print(f"✓ Index: {p.faiss_index.ntotal} vectors, {len(p.all_chunks)} chunks")

def test_retrieve():
    """测试: 检索返回非空结果"""
    from src.pipeline import MedicalRAGPipeline
    p = MedicalRAGPipeline(content_dir="./output/remote_test")
    p.load_documents()
    p.build_index()
    
    results = p.retrieve("主动脉夹层", top_k=5)
    assert len(results) > 0, "No results for '主动脉夹层'"
    for r in results:
        assert "text" in r, "Result missing text"
        assert "source" in r, "Result missing source"
        assert "score" in r, "Result missing score"
    print(f"✓ Retrieval: {len(results)} results for '主动脉夹层'")

def test_answer_chinese():
    """测试: 问答生成中文回答"""
    from src.pipeline import MedicalRAGPipeline
    p = MedicalRAGPipeline(content_dir="./output/remote_test")
    p.load_documents()
    p.build_index()
    
    result = p.answer_with_sources("Stanford B型主动脉夹层的分型是什么？")
    answer = result["answer"]
    assert len(answer) > 50, f"Answer too short: {len(answer)} chars"
    assert "Stanford" in answer or "B型" in answer, "Answer doesn't address the question"
    assert result["source_count"] > 0, "No sources returned"
    print(f"✓ Q&A: {len(answer)} chars, {result['source_count']} sources")

def test_stats():
    """测试: 知识库统计"""
    from src.pipeline import MedicalRAGPipeline
    p = MedicalRAGPipeline(content_dir="./output/remote_test")
    p.load_documents()
    p.build_index()
    
    stats = p.get_stats()
    assert stats["total_chunks"] > 0
    assert stats["total_documents"] > 0
    print(f"✓ Stats: {stats}")

if __name__ == "__main__":
    test_load_and_index()
    test_retrieve()
    test_answer_chinese()
    test_stats()
    print("\n✅ All tests passed!")
```

**Step 2: 运行测试**

```bash
cd "项目根目录"
python tests/test_pipeline.py
```

Expected: `✅ All tests passed!`

**Step 3: Commit**

```bash
git add tests/test_pipeline.py
git commit -m "test: add end-to-end regression tests for pipeline"
```

---

## Task 10: Agent 端到端演示验证

**Files:** None (手动验证)

**Step 1: 启动 API**

```bash
uvicorn api:app --port 8000
```

**Step 2: 测试 Agent 端点**

```bash
curl -X POST http://localhost:8000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"question":"Stanford B型主动脉夹层不同治疗方式的疗效对比如何？请按证据等级排列推荐。"}'
```

**Step 3: 验证回答包含:**
- 按证据等级排列 (高→低)
- 每个推荐有文献引用
- 推理 trace 含工具调用记录

**Step 4: 测试 Gradio UI**

```bash
python app.py
```

浏览器中:
- 输入复杂医学问题
- 观察推理过程实时展示
- 确认回答带引用

---

## 实施顺序总结

```
Task 1 (install) → Task 2 (LightRAG) → Task 3 (.env) → Task 4 (fixes)
  → Task 5 (agent.py) → Task 6 (resilience+GPU) → Task 7 (api)
  → Task 8 (UI) → Task 9 (tests) → Task 10 (demo)
```

可并行: Task 3 + Task 4 (独立于 LightRAG)
核心路径: Task 2 (LightRAG) 是整个项目的关键路径
