# MedRAG API 接口技术文档

> **版本**：v1.0 | **日期**：2026-05-31 | **团队**：天机运算  
> **Base URL**：`http://localhost:8000/api`  
> **Content-Type**：`application/json`（文件上传除外）

---

## 目录

1. [概述](#1-概述)
2. [认证体系](#2-认证体系)
3. [文献管理](#3-文献管理)
4. [文档上传与解析](#4-文档上传与解析)
5. [知识图谱](#5-知识图谱)
6. [Agent 智能问答](#6-agent-智能问答)
7. [对话会话](#7-对话会话)
8. [系统统计](#8-系统统计)
9. [全文检索](#9-全文检索)
10. [附录：错误码与通用响应](#10-附录错误码与通用响应)

---

## 1. 概述

### 1.1 接口规范

| 项目 | 说明 |
|------|------|
| Base URL | `http://localhost:8000/api` |
| 数据格式 | JSON（请求与响应均为 `application/json`） |
| 字符编码 | UTF-8 |
| 认证方式 | Bearer Token（Header: `Authorization: Bearer <token>`） |
| 流式响应 | SSE（Server-Sent Events）用于 Agent 推理直播 |

### 1.2 接口分类

| 分类 | 端点数量 | 说明 |
|------|---------|------|
| 认证体系 | 4 | 登录 / 注册 / 获取当前用户 / 登出 |
| 文献管理 | 8 | 文献 CRUD / 段落 / 图表 / 统计 |
| 文档上传与解析 | 5 | PDF上传 / 状态追踪 / 取消 / 重试 / 历史 |
| 知识图谱 | 3 | 图谱数据 / 统计 / 节点搜索 |
| Agent 智能问答 | 2 | SSE 流式问答 / 简单问答 |
| 对话会话 | 5 | 会话 CRUD / 消息 / 评价 |
| 系统统计 | 3 | 系统统计 / 趋势 / 科室分布 |
| 全文检索 | 2 | 关键词检索 / LightRAG 查询 |

### 1.3 认证模式

本系统采用**可选认证 + 角色鉴权**双层模式：

| 接口类型 | 无 Token | 有效 Token | 无效 Token | 角色要求 |
|---------|----------|-----------|-----------|---------|
| 公开读取（stats, graph） | ✅ 200 | ✅ 200 | ❌ 401 | 无 |
| 文献读取（articles GET） | ✅ 200 | ✅ 200 | ❌ 401 | 无 |
| 管理写入（POST/PATCH/DELETE） | ❌ 401 | ✅ 200/403 | ❌ 401 | admin / expert |
| 对话（chat） | ❌ 401 | ✅ 200 | ❌ 401 | 任意认证用户 |
| Agent 问答（agent） | ❌ 401 | ✅ 200 | ❌ 401 | 任意认证用户 |

---

## 2. 认证体系

### 2.1 登录

```http
POST /api/auth/login
```

**请求体**：
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**成功响应** (200)：
```json
{
  "token": "8f7ad1461b114951bb5cda71af8c436d...",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin"
  }
}
```

**失败响应**：
| 状态码 | 场景 | 响应体 |
|--------|------|--------|
| 401 | 用户名或密码错误 | `{"detail":"用户名或密码错误"}` |

**测试命令**：
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

---

### 2.2 注册

```http
POST /api/auth/register
```

**请求体**：
```json
{
  "username": "newdoctor",
  "password": "pass123",
  "confirmPassword": "pass123",
  "role": "user",
  "email": "doctor@hospital.com"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | ✅ | 用户名，不可重复 |
| password | string | ✅ | 密码，至少 6 位 |
| confirmPassword | string | ✅ | 必须与 password 一致 |
| role | string | ❌ | user / admin，默认 user |
| email | string | ❌ | 邮箱，含 @ 格式校验 |

**成功响应** (200)：
```json
{
  "success": true,
  "user": {
    "id": 5,
    "username": "newdoctor",
    "role": "user"
  }
}
```

**失败响应**：
| 状态码 | 场景 | 响应体 |
|--------|------|--------|
| 400 | 两次密码不一致 | `{"detail":"两次密码不一致"}` |
| 400 | 邮箱格式不正确 | `{"detail":"邮箱格式不正确"}` |
| 400 | 用户名已存在 | `{"detail":"用户名或邮箱已存在"}` |

**测试命令**：
```bash
# 正常注册
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123","confirmPassword":"test123","role":"user","email":"test@test.com"}'

# 密码不匹配
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123","confirmPassword":"wrong"}'

# 无效邮箱
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123","confirmPassword":"test123","email":"bad-email"}'
```

---

### 2.3 获取当前用户

```http
GET /api/auth/me
Authorization: Bearer <token>
```

**请求头**：
| Header | 必填 | 说明 |
|--------|------|------|
| Authorization | ❌ | `Bearer <token>` |

**成功响应** (200)：
```json
{
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin"
  }
}
```

**未登录** (200)：
```json
{
  "user": null
}
```

**Token 无效** (401)：
```json
{
  "detail": "令牌无效或已过期"
}
```

**测试命令**：
```bash
# 有效 token
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl http://localhost:8000/api/auth/me -H "Authorization: Bearer $TOKEN"

# 无效 token
curl http://localhost:8000/api/auth/me -H "Authorization: Bearer invalid-token"

# 无 token
curl http://localhost:8000/api/auth/me
```

---

### 2.4 登出

```http
POST /api/auth/logout
Authorization: Bearer <token>
```

**成功响应** (200)：
```json
{
  "success": true
}
```

**测试命令**：
```bash
curl -X POST http://localhost:8000/api/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

---

## 3. 文献管理

### 3.1 文献列表

```http
GET /api/articles
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | ❌ | 按状态筛选：pending / parsing / parsed / approved / rejected / error |
| search | string | ❌ | 按标题模糊搜索 |
| articleType | string | ❌ | 按类型筛选：clinical_trial / meta_analysis / guideline |
| department | string | ❌ | 按科室筛选 |

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "title": "seyfarth2008",
    "fileName": "seyfarth2008.pdf",
    "fileSize": 531222,
    "status": "approved",
    "articleType": "guideline",
    "department": "General",
    "authors": [],
    "journal": "",
    "doi": "",
    "keywords": [],
    "textSegmentsCount": 21,
    "figuresCount": 4,
    "uploadedAt": "2026-05-30T10:27:00"
  }
]
```

**测试命令**：
```bash
# 全部文献
curl http://localhost:8000/api/articles -H "Authorization: Bearer $TOKEN"

# 按状态筛选
curl "http://localhost:8000/api/articles?status=approved" -H "Authorization: Bearer $TOKEN"

# 按类型筛选
curl "http://localhost:8000/api/articles?articleType=guideline" -H "Authorization: Bearer $TOKEN"

# 搜索
curl "http://localhost:8000/api/articles?search=covid" -H "Authorization: Bearer $TOKEN"
```

---

### 3.2 文献统计

```http
GET /api/articles/stats
```

**成功响应** (200)：
```json
{
  "total": 4,
  "by_status": {
    "parsed": 1,
    "approved": 2,
    "parsing": 1
  },
  "in_knowledge_base": 3
}
```

| 字段 | 说明 |
|------|------|
| total | 文献总数 |
| by_status | 各状态文献数量 |
| in_knowledge_base | 已入库（FAISS 索引）文献数 |

**测试命令**：
```bash
curl http://localhost:8000/api/articles/stats -H "Authorization: Bearer $TOKEN"
```

---

### 3.3 文献详情

```http
GET /api/articles/{article_id}
```

**路径参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| article_id | int | 文献 ID |

**成功响应** (200)：
```json
{
  "id": 1,
  "title": "seyfarth2008",
  "status": "approved",
  "fileName": "seyfarth2008.pdf",
  "fileSize": 531222,
  "articleType": "guideline",
  "department": "General",
  "authors": [],
  "journal": "J Am Coll Cardiol",
  "publishDate": "2008",
  "doi": "NCT00417378",
  "keywords": ["cardiogenic shock", "Impella", "IABP"],
  "textSegmentsCount": 21,
  "figuresCount": 4
}
```

**失败响应**：
| 状态码 | 场景 | 响应体 |
|--------|------|--------|
| 404 | 文献不存在 | `{"detail":"文献不存在"}` |

**测试命令**：
```bash
# 存在的文献
curl http://localhost:8000/api/articles/1 -H "Authorization: Bearer $TOKEN"

# 不存在的文献
curl http://localhost:8000/api/articles/999 -H "Authorization: Bearer $TOKEN"
```

---

### 3.4 创建文献

```http
POST /api/articles
Authorization: Bearer <token>   # 需要 admin/expert 角色
```

**请求体**：
```json
{
  "title": "New Clinical Trial 2025",
  "fileName": "trial.pdf",
  "fileSize": 500000,
  "articleType": "clinical_trial",
  "department": "Cardiology",
  "authors": ["Zhang W", "Li M"],
  "journal": "The Lancet",
  "publishDate": "2025-03",
  "doi": "10.xxxx/xxxxx",
  "keywords": ["heart failure", "SGLT2"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | ✅ | 文献标题 |
| fileName | string | ❌ | 源文件名 |
| fileSize | int | ❌ | 文件大小（字节） |
| articleType | string | ❌ | 文献类型 |
| department | string | ❌ | 所属科室 |
| authors | list | ❌ | 作者列表 |
| journal | string | ❌ | 期刊名称 |
| publishDate | string | ❌ | 出版日期 |
| doi | string | ❌ | DOI 编号 |
| keywords | list | ❌ | 关键词列表 |

**成功响应** (200)：
```json
{
  "id": 5
}
```

**测试命令**：
```bash
curl -X POST http://localhost:8000/api/articles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Article","articleType":"guideline","department":"Cardiology"}'
```

---

### 3.5 更新文献状态

```http
PATCH /api/articles/{article_id}/status
Authorization: Bearer <token>   # 需要 admin/expert 角色
```

**请求体**：
```json
{
  "status": "approved"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | ✅ | pending / parsing / parsed / approved / rejected / error |

**成功响应** (200)：
```json
{
  "success": true
}
```

**测试命令**：
```bash
curl -X PATCH http://localhost:8000/api/articles/1/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"approved"}'
```

---

### 3.6 审核通过文献

```http
POST /api/articles/{article_id}/approve
Authorization: Bearer <token>   # 需要 admin/expert 角色
```

**成功响应** (200)：
```json
{
  "success": true
}
```

**测试命令**：
```bash
curl -X POST http://localhost:8000/api/articles/1/approve \
  -H "Authorization: Bearer $TOKEN"
```

---

### 3.7 删除文献

```http
DELETE /api/articles/{article_id}
Authorization: Bearer <token>   # 需要 admin/expert 角色
```

**成功响应** (200)：
```json
{
  "success": true
}
```

**测试命令**：
```bash
curl -X DELETE http://localhost:8000/api/articles/5 \
  -H "Authorization: Bearer $TOKEN"
```

---

### 3.8 添加段落 / 添加图表

```http
POST /api/articles/{article_id}/segments
POST /api/articles/{article_id}/figures
Authorization: Bearer <token>   # 需要 admin/expert 角色
```

**添加段落请求体**：
```json
{
  "segments": [
    {
      "content": "The primary endpoint was...",
      "segment_type": "primary_outcome",
      "page_number": 2,
      "sequence": 1
    }
  ]
}
```

**添加图表请求体**：
```json
{
  "figures": [
    {
      "figure_type": "baseline_table",
      "caption": "Table 1. Baseline Characteristics",
      "img_path": "/images/table1.png",
      "page_number": 1
    }
  ]
}
```

**成功响应** (200)：
```json
{
  "count": 1
}
```

---

## 4. 文档上传与解析

### 4.1 上传 PDF

```http
POST /api/upload
Content-Type: multipart/form-data
Authorization: Bearer <token>   # 需要 admin/expert 角色
```

**表单参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | file | ✅ | PDF 文件，最大 50MB |

**成功响应** (200)：
```json
{
  "task_uuid": "9a823fda-0c0e-4e42-ad98-7ff0bc1aa181",
  "task_id": 10,
  "filename": "example.pdf",
  "status": "received"
}
```

**状态流转**：
```
received → parsing → chunking → indexing → done
                             └→ partial (图谱失败)
                └→ failed (任一关键阶段失败)
```

**测试命令**：
```bash
curl -X POST http://localhost:8000/api/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/medical-paper.pdf"
```

---

### 4.2 查询上传状态

```http
GET /api/upload/{task_uuid}/status
Authorization: Bearer <token>
```

**成功响应** (200) — 处理中：
```json
{
  "task_uuid": "9a823fda-0c0e-4e42-ad98-7ff0bc1aa181",
  "status": "chunking",
  "filename": "example.pdf",
  "parsing_duration_ms": 65000,
  "faiss_chunks_added": 4,
  "lightrag_entities": null
}
```

**成功响应** (200) — 已完成：
```json
{
  "task_uuid": "9a823fda-0c0e-4e42-ad98-7ff0bc1aa181",
  "status": "done",
  "filename": "example.pdf",
  "parsing_duration_ms": 65000,
  "faiss_duration_ms": 7000,
  "faiss_chunks_added": 4,
  "lightrag_entities": 213,
  "lightrag_relations": 25,
  "lightrag_duration_ms": 28000
}
```

**关键状态字段说明**：
| 字段 | 说明 |
|------|------|
| parsing_duration_ms | MinerU 解析耗时（毫秒） |
| faiss_chunks_added | FAISS 新增向量数 |
| faiss_duration_ms | FAISS 编码耗时（毫秒） |
| lightrag_entities | 图谱实体数 |
| lightrag_relations | 图谱关系数 |
| lightrag_duration_ms | LightRAG 构建耗时（毫秒） |

**测试命令**：
```bash
# 实时轮询（每 2 秒）
while true; do
  curl -s "http://localhost:8000/api/upload/$TASK_UUID/status" \
    -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['status'])"
  sleep 2
done
```

---

### 4.3 取消上传任务

```http
POST /api/upload/{task_uuid}/cancel
Authorization: Bearer <token>   # 需要 admin/expert 角色
```

**成功响应** (200)：
```json
{
  "success": true,
  "message": "取消请求已发送，任务将在当前阶段完成后终止",
  "result": "cancelling"
}
```

**返回值说明**：
| result | 说明 |
|--------|------|
| cancelled | 任务还在队列中，已直接取消 |
| cancelling | 任务正在处理中，将在当前阶段完成后终止 |
| completed | 任务已结束，无法取消（返回 400） |
| not_found | 任务不存在（返回 404） |

**测试命令**：
```bash
curl -X POST "http://localhost:8000/api/upload/$TASK_UUID/cancel" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 4.4 重试失败任务

```http
POST /api/upload/{task_uuid}/retry
Authorization: Bearer <token>   # 需要 admin/expert 角色
```

**成功响应** (200)：
```json
{
  "status": "re-enqueued",
  "task_uuid": "9a823fda-0c0e-4e42-ad98-7ff0bc1aa181"
}
```

**测试命令**：
```bash
curl -X POST "http://localhost:8000/api/upload/$TASK_UUID/retry" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 4.5 上传历史

```http
GET /api/upload/history
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| limit | int | ❌ | 返回数量，默认 50 |
| status | string | ❌ | 按状态筛选 |

**成功响应** (200)：
```json
{
  "tasks": [
    {
      "task_uuid": "9a823fda-0c0e-4e42-ad98-7ff0bc1aa181",
      "filename": "example.pdf",
      "status": "done",
      "parsing_duration_ms": 65000,
      "faiss_chunks_added": 4,
      "created_at": "2026-05-31T17:28:12"
    }
  ],
  "total": 13
}
```

**测试命令**：
```bash
curl "http://localhost:8000/api/upload/history" -H "Authorization: Bearer $TOKEN"
curl "http://localhost:8000/api/upload/history?status=done&limit=5" -H "Authorization: Bearer $TOKEN"
```

---

## 5. 知识图谱

### 5.1 获取图谱数据

```http
GET /api/graph
```

**成功响应** (200)：
```json
{
  "nodes": [
    {
      "id": "propionic_acidemia",
      "label": "Propionic Acidemia",
      "group": "疾病",
      "weight": 3
    }
  ],
  "edges": [
    {
      "source": "propionic_acidemia",
      "target": "chronic_kidney_disease",
      "weight": 2
    }
  ],
  "stats": {
    "total_nodes": 213,
    "total_edges": 25
  }
}
```

| 节点字段 | 说明 |
|---------|------|
| id | 节点唯一标识 |
| label | 显示标签 |
| group | 类型：疾病 / 药物 / 治疗 / 检查 / 症状 / 解剖 / 指南 / 指标 / 其他 |
| weight | 权重（关联次数） |

**测试命令**：
```bash
curl http://localhost:8000/api/graph -H "Authorization: Bearer $TOKEN"
```

---

### 5.2 图谱统计

```http
GET /api/graph/stats
```

**成功响应** (200)：
```json
{
  "totalNodes": 213,
  "totalEdges": 25,
  "nodeTypes": {
    "其他": 167,
    "指标": 14,
    "疾病": 10,
    "治疗": 9,
    "检查": 5,
    "症状": 3,
    "指南": 3,
    "药物": 2
  }
}
```

**测试命令**：
```bash
curl http://localhost:8000/api/graph/stats -H "Authorization: Bearer $TOKEN"
```

---

### 5.3 节点搜索

```http
GET /api/graph/nodes/search?query=血
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | ✅ | 节点名称关键词（中文或英文均可） |

**成功响应** (200)：
```json
[
  {
    "id": "hypertension",
    "label": "Hypertension",
    "group": "疾病",
    "weight": 6
  },
  {
    "id": "blood_pressure",
    "label": "Blood Pressure",
    "group": "指标",
    "weight": 3
  }
]
```

**测试命令**：
```bash
curl "http://localhost:8000/api/graph/nodes/search?query=血" -H "Authorization: Bearer $TOKEN"
curl "http://localhost:8000/api/graph/nodes/search?query=COVID" -H "Authorization: Bearer $TOKEN"
```

---

## 6. Agent 智能问答

### 6.1 SSE 流式问答（推荐）

```http
GET /api/agent/stream?question=<url-encoded-question>
Authorization: Bearer <token>
Accept: text/event-stream
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| question | string | ✅ | 医疗问题（需 URL 编码） |

**SSE 事件类型**：

| 事件 type | 说明 | 示例数据 |
|-----------|------|---------|
| start | 推理开始 | `{"type":"start","message":"开始分析...","ts":"2026-05-31T19:11:51"}` |
| step | 工具调用 | `{"type":"step","step":1,"tool":"search_rag","elapsed":2.3,"preview":"..."}` |
| answer | 最终回答 | `{"type":"answer","answer":"...","sources":[...],"elapsed":39.3,"steps":5}` |
| error | 推理出错 | `{"type":"error","message":"推理出错: ..."}` |
| — | 流结束 | `data: [DONE]` |

**step 事件中的 tool 字段**：

| 工具名 | 功能 |
|--------|------|
| search_rag | FAISS + LightRAG 双路检索 |
| deep_retrieve | 多维度并发检索 |
| cross_check | 多文献一致性验证 |
| list_docs | 列出知识库所有文献 |
| get_evidence | 查询单文献覆盖范围 |
| extract_chart | 图表文本提取 |
| analyze_image | VLM 图表结构化分析 |
| estimate_grade | GRADE 证据评级 |
| build_consistency_matrix | 一致性矩阵 |
| self_reflect | 回溯重搜 |

**answer 事件结构**：
```json
{
  "type": "answer",
  "answer": "## 知识库文献概览\n\n...",
  "sources": [
    {
      "title": "seyfarth2008 [p.2]",
      "type": "文献",
      "image_url": null,
      "text_preview": "[文献] A Randomized Clinical Trial to..."
    }
  ],
  "elapsed": 39.3,
  "steps": 5
}
```

**测试命令**：
```bash
# 简单查询
curl -N "http://localhost:8000/api/agent/stream?question=What+medical+conditions+are+studied" \
  -H "Authorization: Bearer $TOKEN"

# 临床查询（中文需 URL 编码）
curl -N "http://localhost:8000/api/agent/stream?question=%E6%88%BF%E9%A2%A4%E6%8A%97%E5%87%9D%E6%96%B9%E6%A1%88" \
  -H "Authorization: Bearer $TOKEN"
```

**前端集成示例** (JavaScript)：
```javascript
async function streamAgent(question, onStep, onAnswer, onError) {
  const token = localStorage.getItem("medasr_token");
  const url = `/api/agent/stream?question=${encodeURIComponent(question)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        switch (data.type) {
          case "step": onStep(data); break;
          case "answer": onAnswer(data); break;
          case "error": onError(data.message); break;
        }
      }
    }
  }
}
```

---

### 6.2 简单问答（非流式）

```http
GET /api/ask?question=<url-encoded-question>&top_k=8
Authorization: Bearer <token>
```

**查询参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| question | string | ✅ | 医疗问题 |
| top_k | int | ❌ | 返回结果数，默认 8 |

**成功响应** (200)：
```json
{
  "answer": "根据知识库检索结果...",
  "sources": [
    {
      "title": "seyfarth2008 [p.2]",
      "type": "文献"
    }
  ],
  "model": "deepseek-chat"
}
```

**降级机制**：当 Agent LLM 不可用时，自动回退到 FAISS 直接检索，此时返回：
```json
{
  "answer": "## 检索结果 (FAISS 直接检索)\n\n> ⚠️ AI 推理服务暂时无法连接...",
  "model": "FAISS-fallback"
}
```

---

## 7. 对话会话

### 7.1 会话列表

```http
GET /api/chat/sessions
Authorization: Bearer <token>
```

**成功响应** (200)：
```json
[
  {
    "id": 1,
    "user_id": 1,
    "title": "房颤抗凝方案咨询",
    "message_count": 6,
    "created_at": "2026-05-31T10:00:00"
  }
]
```

---

### 7.2 创建会话

```http
POST /api/chat/sessions
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "title": "新对话",
  "scopeArticles": [1, 2],
  "scopeCategories": ["cardiology"]
}
```

**成功响应** (200)：
```json
{
  "id": 2
}
```

---

### 7.3 会话详情

```http
GET /api/chat/sessions/{session_id}
Authorization: Bearer <token>
```

---

### 7.4 发送消息（触发 Agent 推理）

```http
POST /api/chat/sessions/{session_id}/messages
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "role": "user",
  "content": "房颤高卒中风险患者的一线抗凝方案？",
  "contentType": "text",
  "attachments": [],
  "tokenCount": 0
}
```

**成功响应** (200)：
```json
{
  "id": 12,
  "answer": "对于非瓣膜性房颤且高卒中风险患者...",
  "ragTrace": [{"tool": "search_rag", "args": {"faiss_query": "..."}}],
  "citations": [{"articleId": 1, "articleTitle": "seyfarth2008", "content": "..."}],
  "sources": [{"title": "seyfarth2008 [p.2]", "type": "文献"}]
}
```

**测试命令**：
```bash
# 创建会话
SESSION=$(curl -s -X POST http://localhost:8000/api/chat/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"测试对话"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

# 发送消息
curl -X POST "http://localhost:8000/api/chat/sessions/$SESSION/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"user","content":"知识库中有哪些医学文献？"}'
```

---

### 7.5 删除会话 / 评价消息

```http
DELETE /api/chat/sessions/{session_id}          # 删除会话
POST   /api/chat/messages/{message_id}/rate      # 评价消息
Authorization: Bearer <token>
```

**评价请求体**：
```json
{
  "rating": 5,
  "feedback": "回答准确，引用完整"
}
```

---

## 8. 系统统计

### 8.1 系统统计

```http
GET /api/stats/system
```

**成功响应** (200)：
```json
{
  "totalArticles": 4,
  "parsedArticles": 4,
  "knowledgeBaseArticles": 4,
  "totalNodes": 213,
  "totalEdges": 25,
  "totalChatSessions": 0,
  "totalChatMessages": 0,
  "faissVectors": 46,
  "totalDocuments": 4,
  "recentActivity": [
    {
      "action": "login",
      "timeAgo": "2分钟前",
      "details": {"summary": "login - "}
    }
  ],
  "avgParseTime": 12.5
}
```

---

### 8.2 月度趋势

```http
GET /api/stats/trends
```

### 8.3 科室分布

```http
GET /api/stats/department-dist
```

---

## 9. 全文检索

### 9.1 关键词检索

```http
POST /api/search
Authorization: Bearer <token>
```

**请求体**：
```json
{
  "query": "cardiogenic shock Impella IABP",
  "top_k": 8
}
```

**成功响应** (200)：
```json
{
  "results": [
    {
      "text": "[文献] A Randomized Clinical Trial to...",
      "source": "seyfarth2008 [p.0]",
      "doc": "seyfarth2008",
      "page_idx": 0,
      "evidence_level": "RCT",
      "score": 0.85
    }
  ],
  "model": "faiss"
}
```

### 9.2 LightRAG 查询

```http
POST /api/query/lightrag
Authorization: Bearer <token>
```

---

## 10. 附录：错误码与通用响应

### 10.1 HTTP 状态码

| 状态码 | 含义 | 场景 |
|--------|------|------|
| 200 | 成功 | 正常响应 |
| 400 | 请求参数错误 | 密码不匹配、邮箱格式错误、仅支持 PDF |
| 401 | 未认证 | 无 token 或 token 无效（写操作） |
| 403 | 无权限 | 非 admin 用户执行管理操作 |
| 404 | 资源不存在 | 文献/会话/任务不存在 |
| 413 | 文件过大 | PDF 超过 50MB |
| 500 | 服务器内部错误 | 数据库异常、模型推理失败 |

### 10.2 通用错误响应格式

```json
{
  "detail": "错误描述信息"
}
```

### 10.3 全局认证测试

```bash
#!/bin/bash
BASE="http://localhost:8000/api"

# 测试用 token
TOKEN=$(curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

echo "=== 认证测试 ==="
echo -n "  无 token 读: "; curl -s -o /dev/null -w "%{http_code}\n" $BASE/articles
echo -n "  无效 token 读: "; curl -s -o /dev/null -w "%{http_code}\n" $BASE/articles -H "Authorization: Bearer bad_token"
echo -n "  有效 token 读: "; curl -s -o /dev/null -w "%{http_code}\n" $BASE/articles -H "Authorization: Bearer $TOKEN"
echo -n "  无 token 写: "; curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/articles -H "Content-Type: application/json" -d '{}'
echo -n "  无 token 删: "; curl -s -o /dev/null -w "%{http_code}\n" -X DELETE $BASE/articles/1

echo ""
echo "=== 核心接口测试 ==="
for ep in "/auth/me" "/articles" "/articles/stats" "/graph" "/graph/stats" "/stats/system" "/upload/history"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$ep" -H "Authorization: Bearer $TOKEN")
  echo "  $ep → $STATUS"
done

echo ""
echo "=== Agent 测试 ==="
curl -s -N "$BASE/agent/stream?question=Hello" -H "Authorization: Bearer $TOKEN" --max-time 60 | grep -o '"type":"[^"]*"' | sort | uniq -c

echo ""
echo "全接口测试完成。"
```

---

> **文档版本**：v1.0 | 2026-05-31 | **团队**：天机运算  
> **Base URL**：`http://localhost:8000/api`  
> **认证方式**：`Authorization: Bearer <token>`
