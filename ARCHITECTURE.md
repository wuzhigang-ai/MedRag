# MedASR — 技术架构文档

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Frontend (零依赖原生)                           │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  index.html  │  │ login.html   │  │  chat.html   │  │ admin.html  │ │
│  │  产品落地页   │  │  用户认证     │  │  Agent 问答   │  │  管理后台    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘ │
│        │                 │                 │                  │         │
│        │            api.js           chat.js            admin.js        │
│        │         Auth + API           SSE + Agent         graph.js      │
│        │            client            renderer          Three.js 3D     │
└────────┼─────────────────┼─────────────────┼──────────────────┼────────┘
         │                 │                 │                  │
         ▼                 ▼                 ▼                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     API Layer (FastAPI + Uvicorn)                       │
│                                                                        │
│  /api/login   /api/query   /api/agent   /api/upload   /api/graph       │
│  /api/status  /api/files   /api/feedback  /api/agent/stream             │
│                                                                        │
│  SSE StreamingResponse ← Agent reasoning trace (type: step → answer)   │
│  Background Tasks      ← PDF upload → async parse → index → done       │
│  Upload Progress       ← _upload_state dict → admin.js poll at 5s      │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Core Pipeline (MedicalRAGPipeline)                    │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Engine A: FAISS RAG ─────────────────────────────────────────    │  │
│  │                                                                    │  │
│  │  Content JSON → chunk_text → MD5 dedup → BGE-M3 encode(GPU)      │  │
│  │       → FAISS IndexFlatIP.add_with_ids() → save binary            │  │
│  │                                                                    │  │
│  │  MedicalChunker: classify_section(text) → section_tag              │  │
│  │  MedicalVLMProcessor: analyze_chart_image(img, caption) → JSON     │  │
│  │  _faiss_retrieve(query, top_k=8) → [(text, score, source)]        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Engine B: LightRAG GraphRAG ──────────────────────────────────    │  │
│  │                                                                    │  │
│  │  讯飞 GLM-5.1 → entity_extraction → entities + relations           │  │
│  │  Moonshot Vision → chart_caption → entity enrichment               │  │
│  │  LightRAG ainsert() → KV store + GraphML + Vector DB              │  │
│  │                                                                    │  │
│  │  GraphManager: parse KV JSON → nodes(863) + edges(771) + stats    │  │
│  │  snapshot() / get_delta() → incremental update tracking            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Agent Layer (MedicalAgent) ──────────────────────────────────     │  │
│  │                                                                    │  │
│  │  OpenAI Client (百度 DeepSeek-V4-Pro)                              │  │
│  │  Function Calling:                                                 │  │
│  │    search_rag   → FAISS semantic search                            │  │
│  │    cross_check  → multi-doc consistency + evidence grading         │  │
│  │    get_evidence → specific doc detailed evidence                   │  │
│  │    list_docs    → enumerate indexed documents                      │  │
│  │    deep_retrieve→ multi-aspect search                              │  │
│  │    extract_chart→ chart structured data (VLM-enhanced)             │  │
│  │                                                                    │  │
│  │  Reasoning: max 15 steps, auto-terminate on answer                 │  │
│  │  SSE stream: step events → answer event → [DONE]                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Document Parsing Layer                              │
│                                                                        │
│  MinerU (Remote Linux via SSH)                                         │
│    └─ RemoteMinerUParser (scripts/remote_parse.py)                     │
│       ├─ connect()       → paramiko SSH to Linux server                │
│       ├─ upload_pdf()    → SFTP transfer to MinerU input dir            │
│       ├─ parse_pdf()     → execute MinerU CLI on remote                │
│       └─ download()      → SFTP fetch content_list.json to local       │
│                                                                        │
│  Local Fallback: content_dir glob *_content_list.json                  │
└────────────────────────────────────────────────────────────────────────┘
```

## 数据流

### 上传流程

```
1. POST /api/upload (PDF file)
   ├── File saved to ./uploads/
   ├── asyncio.create_task(_background_upload)
   │   ├── graph_manager.snapshot()
   │   ├── parse_remote_pdf(pdf_path)
   │   │   ├── SSH connect → upload → MinerU parse → download JSON
   │   │   └── _upload_state = {state: "downloading" → "done"}
   │   ├── add_parsed_document(content_list.json)
   │   │   ├── Load JSON items
   │   │   ├── For each text: MD5 hash → BGE-M3 encode → FAISS add
   │   │   ├── For each image: _analyze_chart_image() → VLM result → chunk
   │   │   ├── For each table: [表格] caption + body → chunk
   │   │   ├── MedicalChunker.classify_section() → section_tag
   │   │   └── save_index()
   │   └── graph_manager.build()
   └── _upload_state = {state: "indexing" → "done", chunks_added: N}

2. admin.js startProgressPolling()
   ├── Every 5s: GET /api/status → _upload_state
   ├── updateProgressUI(up) → progress bar + steps
   ├── When "indexing": startGraphPolling()
   └── When "done": addFileRow() + Toast + stop

3. admin.js startGraphPolling()
   ├── Every 3s: GET /api/graph/delta → new_node_count
   ├── If new_nodes > 0: graph3d.addNodesWithAnimation()
   └── When "done" in upload: stopGraphPolling()
```

### 问答流程

```
1. User submits question → chat.js sendMessage()
   ├── showThinking() → agent-workbench with pulse dot + timer
   ├── streamAgentResponse(question, agentMsg)
   │   ├── GET /api/agent/stream?question=...
   │   ├── ReadableStream reader → processChunk()
   │   ├── Parse SSE: data: {"type":"step",...} → addWorkbenchStep()
   │   ├── Parse SSE: data: {"type":"answer",...} → agentMsg.answer
   │   └── Parse SSE: data: [DONE] → finishWorkbench()
   └── appendMessageBubble(agentMsg) → formatted answer + trace + sources + feedback

2. Backend: /api/agent/stream
   ├── yield {"type":"start"}
   ├── agent.run(question)
   │   ├── LLM decides: need search_rag? → tool call
   │   ├── _tool_search_rag(args) → FAISS retrieve → JSON result
   │   ├── yield {"type":"step","tool":"search_rag",...}
   │   ├── LLM with tool results → need cross_check? → tool call
   │   ├── _tool_cross_check(args) → multi-doc comparison → JSON result
   │   ├── yield {"type":"step","tool":"cross_check",...}
   │   ├── LLM synthesizes → final answer
   │   └── return {"answer":..., "reasoning_trace":...}
   ├── yield {"type":"answer","answer":...}
   └── yield "data: [DONE]"
```

## 关键技术决策

### 1. 为什么 BGE-M3 + FAISS 而不是全用 LightRAG？

- BGE-M3 是专门的中英双语 Embedding 模型，医学中文语义理解优于通用 Embedding
- FAISS IndexFlatIP 提供精确余弦相似度，适合当前数据规模（<1000 chunks）
- LightRAG GraphRAG 补充实体关系检索，两者互补而非替代
- 当 LightRAG 不可用时，FAISS 自动作为 fallback

### 2. 为什么 O(n²) 力导向而不是 Barnes-Hut？

- 863 节点 × 863 节点 ≈ 745K 对 × 60fps，JavaScript 完全可承受
- 距离截断（8.0 单位以外跳过）将有效计算量减少 60%+
- 实现简单，无需引入额外依赖

### 3. 为什么原生 HTML/CSS/JS 而不是 React/Vue？

- 比赛交付物是 Demo，不是长期维护的产品
- 零构建步骤，评委可直接打开 HTML 查看
- Three.js CDN importmap 加载，无额外打包
- 减小交付体积，4 个页面总大小 < 50KB（不含 Three.js CDN）

## 故障模式与容错

| 故障 | 检测方式 | 恢复策略 | 用户影响 |
|------|---------|---------|---------|
| MinerU SSH 密码错误 | paramiko AuthenticationException | 返回 None, _upload_state=error | Toast: "解析失败" |
| BGE-M3 GPU OOM | cuda out of memory | 自动降级 CPU embedding | 速度变慢，功能正常 |
| 百度 API 超时 | httpx.TimeoutException | resilience.py 重试 3 次 | 回答稍慢 |
| 讯飞 API 失败 | HTTP 4xx/5xx | try/except → 百度 Flash 兜底 | 无感知 |
| LightRAG 不可用 | KV store 文件缺失 | /api/query fallback 到 FAISS | 无感知 |
| VLM 分析失败 | API error / JSON parse error | 降级为 `[图片] {caption}` | 图表问答精度下降 |
| FAISS index 不完整 | load_index 失败 | 自动 rebuild from content JSON | 启动稍慢 |
