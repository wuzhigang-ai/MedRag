# Agentic RAG 端到端系统设计

Date: 2026-05-22
Status: APPROVED
Topic: 端到端 Agentic RAG 医疗文献知识库系统

## 目标

构建 PDF → 知识库 → Agent 多轮推理 → 带溯源回答 的端到端医疗 RAG 系统。

**目标用户：** 研究员、实习生、辅助医疗问答

**核心差异化：**
- 自动化 Pipeline（上传→解析→索引→可查询，零人工）
- Agent 多步推理（自主选择检索策略、交叉验证、按证据等级排序）
- 完整溯源（每个回答附带文献名+页码+证据等级）

## 架构

```
PDF 文献
  │
  ├─► 远程 Linux MinerU 解析 → content_list.json
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│  双引擎 Pipeline (src/pipeline.py)                       │
│                                                         │
│  引擎A: FAISS (BGE-M3 + IndexFlatIP) — 快速语义检索       │
│  引擎B: LightRAG (RAG-Anything) — 知识图谱 + hybrid检索    │
│                                                         │
│  API: 讯飞GLM-5.1 (实体提取) / 百度Flash (兜底)            │
│  Q&A: 百度DeepSeek-V4-Pro                                │
│  Vision: Moonshot K2.6                                    │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│  nanobot Agent (src/agent.py)                            │
│                                                         │
│  LLM: 百度 DeepSeek-V4-Pro (OpenAI compatible)            │
│  Tools: search_rag, cross_check, get_evidence,           │
│         list_docs, deep_retrieve, extract_chart          │
│  Loop: Perceive → Think → Act → Loop                     │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│  UI: Gradio + FastAPI                                    │
│  - 实时推理过程流式展示                                    │
│  - 回答按证据等级排列                                      │
│  - 引用带文献名+页码+证据等级                               │
│  - PDF 上传 → 进度条 → 可查询                             │
└─────────────────────────────────────────────────────────┘
```

## Agent Tools (6个)

| Tool | 功能 | 参数 |
|------|------|------|
| `search_rag` | 检索医学文献知识库 | query, top_k(5), engine("faiss"/"lightrag"/"hybrid"), min_score(0.3) |
| `cross_check` | 多文献结论一致性检测 | topic |
| `get_evidence` | 获取文献证据等级和PICO | doc_name |
| `list_docs` | 列出知识库所有文献 | — |
| `deep_retrieve` | 多角度深度检索 | topic, aspects(["diagnosis","treatment","prognosis",...]) |
| `extract_chart` | 提取图表具体数据 (Moonshot VLM) | doc_name, chart_description |

## Agent 推理流程示例

```
用户: "Stanford B型主动脉夹层不同治疗方式的疗效对比如何？
       请按证据等级排列推荐。"

Step 1: search_rag("TBAD 治疗方式 疗效对比", top_k=8, engine="hybrid")
  → 5段文本: β-blockers、TEVAR、开放手术、药物联合
  → 来自: Stanford共识、shchelochkov2019、todo1992

Step 2: cross_check("TBAD治疗疗效")
  → 一致: 3篇认为TEVAR优于药物(复杂型)
  → 矛盾: 非复杂型首选治疗有分歧

Step 3: get_evidence("Stanford共识")  → 等级6(专家共识)
        get_evidence("shchelochkov2019") → 等级5(病例报告)
        get_evidence("todo1992")         → 等级2(RCT)

Step 4: deep_retrieve("TBAD治疗", aspects=["非复杂型","药物治疗","长期预后"])
  → 补充药物治疗长期预后数据

Step 5: 综合回答 → 按证据等级排列推荐
  引用: [Stanford共识 p.3] [todo1992 p.7] [shchelochkov2019 p.2]
```

## 增量构建流程

```
POST /api/upload (PDF)
  → Background Task:
    ① scp → 远程Linux
    ② mineru解析
    ③ scp content_list.json ← 远程
    ④ MedicalChunker 规则分段
    ⑤ BGE-M3 增量向量化
    ⑥ FAISS.add 增量索引
    ⑦ LightRAG.insert_content_list (async)
    ⑧ pipeline.save_index
  → /api/status → {progress: "100%"}
  → Agent 立即可查询
```

## Demo 模式

- 预置 4-5 篇已解析文献，评委打开即可提问
- PDF 上传作为高级功能展示
- 降低演示风险，同时展示全流程能力

## UI 布局 (Gradio)

```
┌──────────────────────────────────────────────────────────┐
│  🩺 医疗文献 Agentic RAG 知识库系统                         │
├──────────────────────────────────────────────────────────┤
│  Tab: [📄 文献管理] [🔍 智能问答] [📊 知识库] [⚙️ 系统]    │
├──────────────────────────────────────────────────────────┤
│  🔍 智能问答 (默认页):                                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │  输入框                               [提交] [清空]  │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌─ 推理过程 (实时流式) ────────────────────────────────┐  │
│  │ 🧠 理解问题 → 🔍 search_rag → 🔬 cross_check → ✨ 回答 │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌─ 回答 (按证据等级排列) ──────────────────────────────┐  │
│  │ [高] RCT证据 ... [中] 专家共识 ...                    │  │
│  │ 📎 引用: [1] xxx p.3 (专家共识) [2] xxx p.7 (RCT)    │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## 文件清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/pipeline.py` | ✅ 已完成 | 双引擎 Pipeline |
| `src/agent.py` | 🆕 待创建 | nanobot Agent + 6 tool 定义 |
| `src/resilience.py` | ✅ 需集成 | API 重试/降级 |
| `src/medical_chunker.py` | ✅ 需集成 | 规则分段 + PICO |
| `src/medical_kg.py` | ✅ 已完成 | 证据等级 + 一致性 |
| `src/medical_vlm.py` | ✅ 已完成 | VLM 图表分析 |
| `src/dual_retriever.py` | ✅ 已完成 | FAISS 检索 |
| `api.py` | ✅ 需更新 | 增量构建 + Agent 端点 |
| `app.py` | ✅ 需更新 | 新 UI 布局 + 流式推理 |
| `scripts/remote_parse.py` | ✅ 已完成 | SSH 远程解析 |

## 依赖

- nanobot (`pip install nanobot-ai`) — Agent 框架
- RAG-Anything 1.3.0 — LightRAG 引擎
- BGE-M3 — 本地 Embedding
- 百度 DeepSeek-V4-Pro — Agent LLM + Q&A
- 讯飞 GLM-5.1 — 实体提取
- Moonshot K2.6 — 图表视觉

## Verification

1. `python -m src.pipeline` — FAISS 基线通过
2. `python -m src.pipeline --lightrag` — LightRAG 知识图谱构建
3. Agent 多步推理演示: 复杂医学问题 → 5步推理链 → 带溯源回答
4. PDF 上传 → 2分钟内可查询
5. Gradio UI: 推理过程流式展示 + 证据等级排列
