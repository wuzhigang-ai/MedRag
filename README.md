# MedASR — 基于 MinerU 的医疗文献高质量知识库（RAG）系统

端到端 Agentic RAG 系统，实现从医疗 PDF 文献到高质量知识库的全流程自动化构建。

**MinerU 赛道三 · 医疗赛题**

## 核心特性

- **双引擎混合检索** — FAISS 向量检索 (BGE-M3) + LightRAG 知识图谱 (863 实体 / 771 关系)
- **VLM 图表语义理解** — Moonshot 128K Vision 自动分析临床图表（基线表、森林图、KM 曲线）
- **Agent 多步推理** — 6 工具 OpenAI Function Calling，SSE 流式推理过程可视化
- **医学语义分块** — PICO 框架标注 + 章节逻辑切分 + 证据等级自动推断
- **知识图谱 3D 可视化** — Three.js 力导向图，节点悬停交互，上传时实时生长
- **全异步端到端** — PDF 上传 → SSH MinerU 解析 → VLM 分析 → 增量索引，全自动闭环
- **企业级工程化** — 容错降级、增量去重、流式输出、用户反馈闭环

## 快速启动

### 环境要求

- Python 3.11+
- CUDA GPU (4GB+ VRAM，用于 BGE-M3 embedding)
- 远程 Linux 服务器部署 MinerU（或跳过上传功能，使用已有解析数据）

### 安装

```bash
# 克隆项目
git clone <repo-url> && cd <project-dir>

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入 API Key

# 启动服务
uvicorn api:app --host 0.0.0.0 --port 8000
```

### 访问

| 页面 | URL | 说明 |
|------|-----|------|
| 落地页 | http://localhost:8000/ | 产品介绍 |
| 登录 | http://localhost:8000/login | 演示账号: admin/admin123 或 user/user123 |
| 问答 | http://localhost:8000/chat | 医学问答 + Agent 推理 |
| 管理后台 | http://localhost:8000/admin | 上传 PDF + 知识图谱 + 统计面板 |

## 架构概览

```
PDF 文献
  → MinerU 远程解析 (SSH)
    → VLM 图表分析 (Moonshot Vision)
      → 医学语义分块 (PICO + 章节规则)
        → BGE-M3 Embedding (GPU)
          → FAISS 向量索引
          → LightRAG 知识图谱
        → Agent 多步推理 (6 Tools)
      → 答案 + 溯源 + 证据等级
    → 3D 知识图谱可视化 (Three.js)
  → 用户反馈闭环
```

## 技术栈

| 组件 | 技术选型 |
|------|---------|
| PDF 解析 | MinerU (远程 Linux SSH) |
| Embedding | BGE-M3 (1024d, 本地 GPU) |
| 向量检索 | FAISS IndexFlatIP |
| 知识图谱 | LightRAG / RAG-Anything 1.3.0 |
| LLM (问答) | 百度 DeepSeek-V4-Pro |
| LLM (实体提取) | 讯飞 astron-code-latest (GLM-5.1) |
| VLM (图表) | Moonshot moonshot-v1-128k-vision-preview |
| API 框架 | FastAPI + Uvicorn |
| 前端 | 原生 HTML/CSS/JS + Three.js CDN |
| 3D 可视化 | Three.js + 力导向算法 (O(n²) + 距离截断) |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/login | 用户登录 |
| POST | /api/register | 用户注册 |
| POST | /api/query | FAISS RAG 问答 |
| POST | /api/agent | Agent 多步推理问答 |
| GET | /api/agent/stream | Agent SSE 流式推理 |
| POST | /api/upload | 上传 PDF（后台异步解析） |
| GET | /api/status | 知识库状态 + 上传进度 |
| GET | /api/graph | 知识图谱全量数据 |
| GET | /api/graph/delta | 知识图谱增量更新 |
| GET | /api/files | 已上传文件列表 |
| POST | /api/feedback | 提交答案反馈 |
| GET | /api/feedback/stats | 反馈统计 |

## 创新点

1. **VLM 图表语义理解** — 将多模态大模型应用于医学文献图表的自动语义解析，超越纯文本 RAG 局限
2. **双引擎混合检索** — FAISS 向量检索 + LightRAG GraphRAG 互补覆盖，语义匹配与实体关系兼顾
3. **证据等级驱动排序** — Meta > RCT > Cohort > Case-control，高等级证据优先采信
4. **知识图谱 3D 实时可视化** — 863 实体节点 + 771 关系边，鼠标悬停查看实体详情
5. **Agentic 多步推理** — 6 工具自动编排（检索→验证→综合），推理过程透明可追溯

## 项目结构

```
.
├── api.py                  # FastAPI 应用
├── src/
│   ├── pipeline.py         # 双引擎 Pipeline
│   ├── agent.py            # 6 工具 MedicalAgent
│   ├── graph.py            # 知识图谱数据层
│   ├── medical_vlm.py      # VLM 图表处理器
│   ├── medical_chunker.py  # 医学语义分块器
│   ├── medical_kg.py       # 证据等级 + 一致性判断
│   ├── dual_retriever.py   # FAISS 检索 + 排序
│   └── resilience.py       # API 容错重试
├── static/
│   ├── css/                # main.css + pages.css + animations.css
│   └── js/                 # api.js + chat.js + admin.js + login.js + graph.js
├── templates/              # index.html + login.html + admin.html + chat.html
├── docs/
│   ├── 技术方案文档.md       # 竞赛交付文档
│   └── ppt.html            # HTML 演示文稿
├── lightrag_storage/       # LightRAG 知识图谱持久化
├── output/remote_test/     # MinerU 解析结果
├── cache/                  # FAISS 索引缓存
└── uploads/                # PDF 上传目录
```

## 许可证

MIT License
