# 端到端自动化 Pipeline 设计

Date: 2026-05-23
Status: APPROVED
Topic: PDF上传 → 远程MinerU解析 → 自动索引 → 可查询闭环

## 目标

实现比赛任务三核心要求：从原始 PDF 输入到高质量 RAG 知识库输出的端到端自动化。

## 架构

```
POST /api/upload (PDF multipart)
  │
  ▼
api.py: async background task
  │
  ├─ state="uploading"   → 保存文件
  ├─ state="parsing"     → SSH远程MinerU解析
  ├─ state="indexing"    → 加载content_list → Chunker → Embed → FAISS + LightRAG
  └─ state="done"        → 知识库就绪
  │
  ▼
GET /api/status → { ...stats, upload_progress: {state, filename, error?} }
  │
  ▼
Admin UI: 5s轮询 → 进度条 (上传中 → 解析中 → 索引中 → 完成)
```

## 改动文件

| 文件 | 改动 | 说明 |
|------|------|------|
| `api.py` | 修改 | `/api/upload` 改为 async background task, 新增 pipeline state tracking |
| `src/pipeline.py` | 修改 | 新增 `parse_remote_pdf()` 方法, 新增 `_upload_state` 属性 |
| `static/js/admin.js` | 修改 | 上传后轮询 status, 渲染进度条 |
| `templates/admin.html` | 修改 | 添加进度条 UI 组件 |

## 数据流

```
User: 选择PDF → [上传]
  → fetch POST /api/upload (multipart/form-data)
  → 返回 202 Accepted {task_id, status: "uploading"}

Admin JS: setInterval 5s
  → fetch GET /api/status
  → {upload_progress: {state, filename, error?}}
  → 更新进度条

完成时:
  → upload_progress = {state: "done", filename, chunks_added}
  → 刷新文件列表和统计卡片
```

## 关键技术选择

- **远程解析**: 复用 `scripts/remote_parse.py` 的 paramiko SSH 逻辑
- **状态管理**: `pipeline._upload_state` dict，线程安全（asyncio）
- **后台任务**: FastAPI `BackgroundTasks` 或 `asyncio.create_task`
- **进度轮询**: 前端 5 秒间隔，解析中状态显示 "解析中 (已用时 45s)"

## 错误处理

| 场景 | 处理 |
|------|------|
| SSH 连接失败 | state="error", 显示 "远程服务器连接失败" |
| MinerU 解析失败 | state="error", 显示错误详情 |
| content_list 空 | state="error", 显示 "解析结果为空" |
| 索引构建失败 | state="error", 显示 "索引构建失败" |

## 验证

1. `pytest tests/test_frontend.py` — 现有 4 测试通过
2. 浏览器: Admin 页面上传 PDF → 进度条变化 → 文件列表更新 → 统计刷新
3. 上传完成后 `/chat` 可检索到新文献内容
