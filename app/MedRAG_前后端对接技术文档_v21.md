# MedRAG 前后端对接技术文档 v21

> 本文档面向后端开发人员，全面说明 MedRAG 医疗文献 RAG 知识库系统的前后端对接细节。阅读本文档后，后端工程师应能独立完成数据库搭建、API 实现和系统部署。

---

## 一、项目概述

### 1.1 系统简介

MedRAG 是一套面向医疗文献的 **Retrieval-Augmented Generation (RAG)** 知识库管理系统，核心功能包括：

| 功能模块 | 说明 |
|---------|------|
| **PDF 文献上传与解析** | 支持批量上传医疗 PDF，MinerU 解析引擎提取结构化内容 |
| **语义级文本切分** | 按医学章节逻辑（摘要/方法/结果/讨论等）自动切分 |
| **知识图谱构建** | 基于 LightRAG 自动构建实体节点和语义关系网络 |
| **多模态医疗问答** | 支持文字/影像/PDF 提问，Agent 推理过程可视化 |
| **文献溯源举证** | 每个回答附带来源文献引用，确保可追溯 |
| **MedBench 兼容** | 标准化数据格式，支持与 MedBench 评测体系对接 |

### 1.2 技术栈

| 层级 | 技术选型 | 版本 |
|------|---------|------|
| 前端框架 | React 19 + TypeScript | ^19.2.0 |
| 前端路由 | React Router 7 | ^7.6.1 |
| UI 组件 | Radix UI + Tailwind CSS 3 | ^3.4.19 |
| 状态管理 | TanStack Query (React Query) | ^5.90.16 |
| 前后端通信 | tRPC 11 + SuperJSON | ^11.8.1 |
| 后端框架 | Hono 4 (轻量级 Web 框架) | ^4.8.3 |
| ORM | Drizzle ORM (MySQL 驱动) | ^0.45.1 |
| 数据库 | MySQL 8.0 | 8.0.x |
| 认证 | Kimi OAuth 2.0 | - |
| 构建工具 | Vite 7 + esbuild | ^7.2.4 |

### 1.3 系统架构图

```
                    [浏览器]
                       |
         +-------------+-------------+
         |                           |
    [前端静态文件]              [tRPC API 请求]
    (dist/public/)              (/api/trpc/*)
         |                           |
    [Vite 构建]              [Hono 后端服务器]
    React + Tailwind             |
    客户端渲染              +----+----+----+
                            |    |    |    |
                         [Auth][Article][Knowledge][Chat][Stats]
                            |    |    |    |
                            +----+----+----+
                                 |
                         [Drizzle ORM]
                         (mysql2/promise)
                                 |
                            [MySQL 8.0]
```

---

## 二、目录结构

```
/
| api/                          # 后端代码目录
|   boot.ts                     # 应用入口：创建 Hono 实例，注册路由，启动服务器
|   router.ts                   # tRPC 路由汇总：聚合所有子路由
|   middleware.ts               # tRPC 中间件：认证检查、权限控制
|   context.ts                  # tRPC 上下文：请求上下文构建（含用户信息）
|   |
|   articles-router.ts          # 文献管理路由：CRUD、状态更新、片段管理
|   auth-router.ts              # 认证路由：获取当前用户、登出
|   chat-router.ts              # 对话路由：会话管理、消息收发
|   knowledge-router.ts         # 知识图谱路由：节点/边的 CRUD、图谱查询
|   notes-router.ts             # 笔记路由：笔记的 CRUD
|   stats-router.ts             # 统计路由：系统级统计数据
|   |
|   queries/
|   |   connection.ts           # 数据库连接池配置（MySQL）
|   |   users.ts                # 用户查询：按 unionId 查找、upsert
|   |
|   lib/
|   |   env.ts                  # 环境变量读取与校验
|   |   cookies.ts              # Cookie 工具：session cookie 配置
|   |   http.ts                 # HTTP 工具函数
|   |
|   kimi/
|       auth.ts                 # Kimi OAuth 认证：token 交换、用户信息获取
|       platform.ts             # Kimi 平台 API：用户资料获取
|       session.ts              # Session 管理：JWT 签名与验证
|       types.ts                # Kimi 相关类型定义
|
| db/                           # 数据库目录
|   schema.ts                   # Drizzle ORM Schema 定义（10张表）
|   relations.ts                # 表关系定义（relations）
|   drizzle.config.ts           # Drizzle 配置文件
|
| src/                          # 前端代码目录
|   main.tsx                    # 前端入口：React DOM 渲染
|   App.tsx                     # 根组件：路由定义
|   App.css                     # 全局样式 + CSS 变量
|   index.css                   # Tailwind 导入 + 基础样式
|   types.ts                    # 前端类型定义（Note, GraphNode, GraphEdge）
|   store.ts                    # 本地存储工具（localStorage）
|   config.ts                   # 应用配置（文本、颜色、默认值）
|   const.ts                    # 常量定义（路由路径等）
|   |
|   pages/                      # 页面组件
|   |   Welcome.tsx             # 首页/落地页（公开访问）
|   |   Login.tsx               # 登录页（OAuth + 本地模拟）
|   |   Register.tsx            # 注册页
|   |   AdminLayout.tsx         # 后台管理布局（侧边栏 + 路由守卫）
|   |   Dashboard.tsx           # 数据仪表盘（概览页）
|   |   ParsingPage.tsx         # 文献解析页（上传 + 解析状态）
|   |   LibraryPage.tsx         # 文献库页（列表 + 详情 + 审核）
|   |   GraphPage.tsx           # 知识图谱页（力导向图可视化）
|   |   ChatPage.tsx            # 管理端对话页（引用 AdminChatPage）
|   |   AdminChatPage.tsx       # 管理端对话实现
|   |   UserChatPage.tsx        # 用户端对话页（独立界面）
|   |   NotFound.tsx            # 404 页面
|   |
|   providers/
|   |   trpc.tsx                # tRPC 客户端配置 + QueryClient
|   |   toast.tsx               # Toast 通知组件
|   |
|   hooks/
|   |   useAuth.ts              # 认证 Hook：获取用户、登出、重定向
|   |   useNotes.ts             # 笔记 Hook：CRUD 操作
|   |   useTheme.tsx            # 主题 Hook：深色/浅色模式
|   |   use-mobile.ts           # 移动端检测 Hook
|   |
|   components/
|   |   Sidebar.tsx             # 侧边栏组件
|   |   AuthLayout.tsx          # 认证布局
|   |   GraphView.tsx           # 图谱可视化组件
|   |   ...                     # 其他业务组件 + UI 组件库
|   |
|   utils/
|       linkParser.ts           # Wiki 链接解析工具
```

---

## 三、数据库设计

### 3.1 连接配置

数据库使用 **MySQL 8.0**，通过 `mysql2/promise` 连接池管理。

**环境变量**（.env 文件）：

```env
DB_HOST=127.0.0.1        # MySQL 主机地址
DB_PORT=3306             # MySQL 端口
DB_USER=root             # 数据库用户名
DB_PASSWORD=123456       # 数据库密码
DB_NAME=medrag           # 数据库名称
```

**连接池配置**（`api/queries/connection.ts`）：

```typescript
const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "123456",
  database: process.env.DB_NAME || "medrag",
  connectionLimit: 10,        // 连接池大小
  queueLimit: 0,              // 无限队列
  waitForConnections: true,   // 等待可用连接
  enableKeepAlive: true,      // TCP KeepAlive
});
```

### 3.2 表结构

共 **10 张表**，使用 Drizzle ORM 的 MySQL 语法定义。

#### 3.2.1 users（用户表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial (PK) | 自增主键 |
| union_id | varchar(255) | Kimi OAuth unionId，唯一标识 |
| name | varchar(255) | 用户昵称 |
| email | varchar(255) | 邮箱 |
| avatar | text | 头像 URL |
| role | enum('user','expert','admin') | 用户角色，默认 expert |
| medical_role | varchar(100) | 医疗职称 |
| institution | varchar(255) | 所属机构 |
| department | varchar(100) | 科室 |
| years_of_experience | int | 从业年限 |
| phone | varchar(50) | 电话 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |
| last_sign_in_at | timestamp | 最后登录时间 |

#### 3.2.2 articles（文献表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial (PK) | 自增主键 |
| user_id | int (FK) | 上传用户 ID |
| title | varchar(500) | 文献标题 |
| file_name | varchar(255) | 原始文件名 |
| file_size | int | 文件大小（字节） |
| file_url | text | 文件存储 URL |
| article_type | varchar(100) | 文献类型 |
| status | enum('pending','parsing','parsed','reviewing','approved','rejected','error') | 解析状态 |
| parsed_content | text | 解析后的文本内容 |
| text_segments_count | int | 文本段落数 |
| figures_count | int | 图表数 |
| tables_count | int | 表格数 |
| authors | json | 作者列表 |
| publish_date | varchar(50) | 发表日期 |
| journal | varchar(255) | 期刊名称 |
| doi | varchar(255) | DOI |
| keywords | json | 关键词列表 |
| department | varchar(100) | 所属科室 |
| is_in_knowledge_base | int(0/1) | 是否已入库 |
| knowledge_nodes_count | int | 关联知识节点数 |
| uploaded_at | timestamp | 上传时间 |
| parsed_at | timestamp | 解析完成时间 |
| approved_at | timestamp | 审核通过时间 |

#### 3.2.3 text_segments（文本段落表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial (PK) | 自增主键 |
| article_id | int (FK) | 所属文献 ID |
| sequence | int | 段落顺序 |
| content | text | 段落内容 |
| segment_type | enum('abstract','introduction','methods','results_primary','results_secondary','subgroup_analysis','sensitivity_analysis','discussion','conclusion','references','other') | 段落类型 |
| section_title | varchar(255) | 章节标题 |
| page_number | int | 页码 |
| confidence | float | 解析置信度 |
| word_count | int | 字数 |
| evidence_level | varchar(50) | 证据等级 |
| created_at | timestamp | 创建时间 |

#### 3.2.4 extracted_figures（提取图表表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial (PK) | 自增主键 |
| article_id | int (FK) | 所属文献 ID |
| figure_type | enum('table','figure','chart','image') | 图表类型 |
| sequence | int | 顺序号 |
| caption | text | 标题 |
| description | text | 描述 |
| page_number | int | 页码 |
| confidence | float | 置信度 |
| created_at | timestamp | 创建时间 |

#### 3.2.5 knowledge_nodes（知识节点表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial (PK) | 自增主键 |
| label | varchar(255) | 节点标签（实体名称） |
| node_type | enum('disease','drug','symptom','treatment','clinical_indicator','anatomy','procedure','gene','pathogen','other') | 节点类型 |
| description | text | 描述 |
| source_article_ids | json | 来源文献 ID 列表 |
| source_segment_ids | json | 来源段落 ID 列表 |
| icd10_code | varchar(50) | ICD-10 编码 |
| mesh_term | varchar(255) | MeSH 术语 |
| confidence | float | 置信度 |
| occurrence_count | int | 出现次数 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

#### 3.2.6 knowledge_edges（知识关系表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial (PK) | 自增主键 |
| source_node_id | int (FK) | 源节点 ID |
| target_node_id | int (FK) | 目标节点 ID |
| relation_type | enum('treats','causes','associated_with','contraindicated','diagnoses','prevents','symptom_of','interacts_with','related_to') | 关系类型 |
| strength | float | 关系强度 |
| source_article_ids | json | 来源文献 ID 列表 |
| evidence_count | int | 证据数量 |
| description | text | 描述 |
| created_at | timestamp | 创建时间 |

#### 3.2.7 chat_sessions（对话会话表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial (PK) | 自增主键 |
| user_id | int (FK) | 用户 ID |
| title | varchar(255) | 会话标题 |
| scope_articles | json | 限定文献 ID 列表 |
| scope_categories | json | 限定分类列表 |
| message_count | int | 消息数量 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

#### 3.2.8 chat_messages（对话消息表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial (PK) | 自增主键 |
| session_id | int (FK) | 所属会话 ID |
| role | enum('user','assistant','system') | 消息角色 |
| content | text | 消息内容 |
| content_type | enum('text','image','pdf','voice','mixed') | 内容类型 |
| attachments | json | 附件列表 |
| rag_trace | json | RAG 检索轨迹 |
| citations | json | 引用文献列表 |
| rating | int | 评分（1-5） |
| feedback | text | 反馈文字 |
| token_count | int | Token 数量 |
| created_at | timestamp | 创建时间 |

#### 3.2.9 operation_logs（操作日志表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial (PK) | 自增主键 |
| user_id | int | 操作用户 ID |
| user_name | varchar(255) | 用户名 |
| action | varchar(100) | 操作类型 |
| target_type | varchar(100) | 目标类型 |
| target_id | int | 目标 ID |
| details | json | 详情 |
| ip_address | varchar(100) | IP 地址 |
| created_at | timestamp | 创建时间 |

#### 3.2.10 notes（笔记表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial (PK) | 自增主键 |
| user_id | int (FK) | 用户 ID |
| title | varchar(500) | 标题 |
| content | text | 内容（Markdown） |
| tags | json | 标签列表 |
| source | varchar(255) | 来源 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

### 3.3 初始化数据库

```bash
# 创建数据库
mysql -u root -p -e "CREATE DATABASE medrag CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 推送表结构（使用 Drizzle ORM）
cd /项目目录
npm run db:push
```

---

## 四、API 接口文档

所有 API 通过 **tRPC** 提供，前端通过 `trpc.xxx.yyy.useQuery()` / `useMutation()` 调用。

### 4.1 认证模块 (auth)

#### 4.1.1 auth.me — 获取当前用户信息

```typescript
// 前端调用
const { data: user, isLoading } = trpc.auth.me.useQuery();

// 返回类型
interface User {
  id: number;
  unionId: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  role: "user" | "expert" | "admin";
  medicalRole: string | null;
  institution: string | null;
  department: string | null;
  yearsOfExperience: number | null;
  phone: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  lastSignInAt: Date | null;
}

// 后端实现
// 从 session cookie 中解析 JWT token，查询 users 表返回用户信息
// 如果未登录返回 null（不会报错）
```

#### 4.1.2 auth.logout — 用户登出

```typescript
// 前端调用
const logoutMutation = trpc.auth.logout.useMutation();
logoutMutation.mutate();

// 后端实现
// 清除 session cookie，返回 { success: true }
```

#### 4.1.3 OAuth 回调 (/api/oauth/callback)

**这不是 tRPC 接口，是 Hono HTTP 路由。**

```
GET /api/oauth/callback?code={auth_code}&state={redirect_path}
```

流程：
1. 用户点击"Kimi OAuth 登录"按钮
2. 前端跳转至 Kimi 授权页：`https://auth.kimi.com/oauth/authorize?client_id=xxx&redirect_uri=xxx&response_type=code`
3. 用户授权后，Kimi 重定向回 `/api/oauth/callback?code=xxx&state=xxx`
4. 后端用 code 换取 access_token
5. 用 access_token 获取用户信息
6. 在 users 表中 upsert 用户记录
7. 生成 JWT session token，写入 cookie
8. 重定向到首页

### 4.2 文献模块 (articles)

#### 4.2.1 articles.list — 文献列表查询

```typescript
// 前端调用
const { data } = trpc.articles.list.useQuery({
  status: "pending",      // 可选：按状态筛选
  search: "关键词",       // 可选：标题模糊搜索
  articleType: "clinical_trial", // 可选：按类型筛选
  department: "Cardiology",      // 可选：按科室筛选
});

// 返回类型：Article[]（文献数组，按 uploadedAt 倒序）
```

**后端需实现**：支持多条件组合查询，status 匹配枚举值，search 用 LIKE 模糊匹配标题。

#### 4.2.2 articles.get — 获取单篇文献详情

```typescript
// 前端调用
const { data } = trpc.articles.get.useQuery({ id: 1 });

// 返回类型：{ article, segments, figures }
// article: Article
// segments: TextSegment[]
// figures: ExtractedFigure[]
```

**后端需实现**：联表查询 articles + text_segments + extracted_figures。

#### 4.2.3 articles.create — 创建文献记录

```typescript
// 前端调用
const mutation = trpc.articles.create.useMutation();
mutation.mutate({
  title: "文献标题",
  fileName: "xxx.pdf",
  fileSize: 1024000,
  articleType: "clinical_trial",
  department: "Cardiology",
  authors: ["张三", "李四"],
  journal: "NEJM",
  publishDate: "2024-08",
  doi: "10.1056/xxx",
  keywords: ["atrial fibrillation", "anticoagulant"],
});

// 返回类型：{ id: number }
```

#### 4.2.4 articles.updateStatus — 更新文献状态

```typescript
// 前端调用
const mutation = trpc.articles.updateStatus.useMutation();
mutation.mutate({ id: 1, status: "approved" });

// status 可选值：pending, parsing, parsed, reviewing, approved, rejected, error
```

#### 4.2.5 articles.delete — 删除文献

```typescript
// 前端调用
const mutation = trpc.articles.delete.useMutation();
mutation.mutate({ id: 1 });

// 后端需级联删除：先删 text_segments 和 extracted_figures，再删 article
```

#### 4.2.6 articles.addSegments — 添加文本段落

```typescript
// 前端调用（解析引擎调用）
const mutation = trpc.articles.addSegments.useMutation();
mutation.mutate({
  articleId: 1,
  segments: [
    {
      sequence: 1,
      content: "段落内容...",
      segmentType: "abstract",
      sectionTitle: "摘要",
      pageNumber: 1,
      confidence: 0.95,
      wordCount: 200,
      evidenceLevel: "Ia",
    }
  ]
});
```

#### 4.2.7 articles.addFigures — 添加提取图表

```typescript
// 前端调用（解析引擎调用）
const mutation = trpc.articles.addFigures.useMutation();
mutation.mutate({
  articleId: 1,
  figures: [
    {
      sequence: 1,
      figureType: "table",
      caption: "表1：基线特征",
      description: "...",
      pageNumber: 3,
      confidence: 0.92,
    }
  ]
});
```

#### 4.2.8 articles.approve — 审核通过

```typescript
// 前端调用
const mutation = trpc.articles.approve.useMutation();
mutation.mutate({ id: 1 });

// 后端将 status 设为 "approved"，is_in_knowledge_base 设为 1
```

#### 4.2.9 articles.stats — 文献统计

```typescript
// 前端调用
const { data } = trpc.articles.stats.useQuery();

// 返回类型：{ total, pending, parsed, approved, inKb }
```

### 4.3 知识图谱模块 (knowledge)

#### 4.3.1 knowledge.listNodes — 节点列表

```typescript
const { data } = trpc.knowledge.listNodes.useQuery({
  nodeType: "disease",   // 可选：按类型筛选
  search: "房颤",        // 可选：标签模糊搜索
});
```

#### 4.3.2 knowledge.getNode — 获取节点详情

```typescript
const { data } = trpc.knowledge.getNode.useQuery({ id: 1 });
// 返回：{ node, edges: [...incoming, ...outgoing] }
```

#### 4.3.3 knowledge.createNode — 创建节点

```typescript
const mutation = trpc.knowledge.createNode.useMutation();
mutation.mutate({
  label: "Atrial Fibrillation",
  nodeType: "disease",
  description: "Irregular heart rhythm",
  sourceArticleIds: [1, 2],
  icd10Code: "I48",
  meshTerm: "D001281",
  confidence: 0.95,
});
```

#### 4.3.4 knowledge.createEdge — 创建关系

```typescript
const mutation = trpc.knowledge.createEdge.useMutation();
mutation.mutate({
  sourceNodeId: 1,
  targetNodeId: 2,
  relationType: "treats",
  strength: 0.85,
  description: "Warfarin treats AF",
  sourceArticleIds: [1],
});
```

#### 4.3.5 knowledge.getGraph — 获取完整图谱

```typescript
const { data } = trpc.knowledge.getGraph.useQuery();
// 返回：{ nodes: KnowledgeNode[], edges: KnowledgeEdge[] }
```

#### 4.3.6 knowledge.stats — 图谱统计

```typescript
const { data } = trpc.knowledge.stats.useQuery();
// 返回：{ totalNodes, totalEdges, nodeTypes: { disease: 8, drug: 5, ... } }
```

#### 4.3.7 knowledge.search — 搜索节点

```typescript
const { data } = trpc.knowledge.search.useQuery({ query: "房颤" });
// 返回：KnowledgeNode[]（标签模糊匹配，限20条）
```

### 4.4 对话模块 (chat)

#### 4.4.1 chat.listSessions — 会话列表

```typescript
const { data } = trpc.chat.listSessions.useQuery();
// 返回当前用户的所有会话，按 updatedAt 倒序
```

#### 4.4.2 chat.createSession — 创建会话

```typescript
const mutation = trpc.chat.createSession.useMutation();
mutation.mutate({
  title: "房颤治疗方案咨询",
  scopeArticles: [1, 2, 3],        // 可选：限定文献范围
  scopeCategories: ["Cardiology"],  // 可选：限定科室
});
```

#### 4.4.3 chat.getSession — 获取会话及消息

```typescript
const { data } = trpc.chat.getSession.useQuery({ id: 1 });
// 返回：{ session, messages: ChatMessage[] }
```

#### 4.4.4 chat.addMessage — 发送消息

```typescript
const mutation = trpc.chat.addMessage.useMutation();
mutation.mutate({
  sessionId: 1,
  role: "user",
  content: "房颤患者的一线抗凝方案是什么？",
  contentType: "text",
  attachments: [],
  ragTrace: null,
  citations: null,
  tokenCount: 15,
});
```

#### 4.4.5 chat.deleteSession — 删除会话

```typescript
const mutation = trpc.chat.deleteSession.useMutation();
mutation.mutate({ id: 1 });
// 级联删除该会话的所有消息
```

#### 4.4.6 chat.rateMessage — 评价消息

```typescript
const mutation = trpc.chat.rateMessage.useMutation();
mutation.mutate({ id: 1, rating: 5, feedback: "回答很专业" });
```

### 4.5 笔记模块 (notes)

#### 4.5.1 notes.list — 笔记列表

```typescript
const { data } = trpc.notes.list.useQuery();
// 返回当前用户的所有笔记，按 updatedAt 倒序
// 如果用户没有笔记，自动创建 10 条默认笔记
```

#### 4.5.2 notes.get — 获取单条笔记

```typescript
const { data } = trpc.notes.get.useQuery({ id: 1 });
```

#### 4.5.3 notes.create — 创建笔记

```typescript
const mutation = trpc.notes.create.useMutation();
mutation.mutate({
  title: "笔记标题",
  content: "笔记内容（支持 Markdown）",
  tags: ["标签1", "标签2"],
  source: "来源",
});
```

#### 4.5.4 notes.update — 更新笔记

```typescript
const mutation = trpc.notes.update.useMutation();
mutation.mutate({
  id: 1,
  title: "新标题",
  content: "新内容",
  tags: ["新标签"],
});
```

#### 4.5.5 notes.delete — 删除笔记

```typescript
const mutation = trpc.notes.delete.useMutation();
mutation.mutate({ id: 1 });
```

#### 4.5.6 notes.deleteMany — 批量删除

```typescript
const mutation = trpc.notes.deleteMany.useMutation();
mutation.mutate({ ids: [1, 2, 3] });
```

### 4.6 统计模块 (stats)

#### 4.6.1 stats.system — 系统统计

```typescript
const { data } = trpc.stats.system.useQuery();
// 返回：{
//   totalArticles,        // 文献总数
//   parsedArticles,       // 已解析文献数
//   knowledgeBaseArticles,// 已入库文献数
//   totalNodes,           // 知识节点总数
//   totalEdges,           // 知识关系总数
//   totalChatSessions,    // 对话会话总数
//   totalChatMessages,    // 对话消息总数
//   avgParseTime,         // 平均解析耗时（秒）
// }
```

#### 4.6.2 stats.trends — 月度趋势

```typescript
const { data } = trpc.stats.trends.useQuery();
// 返回最近6个月的文献处理趋势（模拟数据）
```

#### 4.6.3 stats.departmentDist — 科室分布

```typescript
const { data } = trpc.stats.departmentDist.useQuery();
// 返回各科室文献数量分布（模拟数据）
```

---

## 五、前端页面与 API 对应关系

### 5.1 路由定义

```typescript
// App.tsx 路由表
<Routes>
  <Route path="/login" element={<Login />} />           {/* 登录页 */}
  <Route path="/register" element={<Register />} />     {/* 注册页 */}
  <Route path="/" element={<Welcome />} />              {/* 首页/落地页 */}
  
  {/* 后台管理（需登录） */}
  <Route path="/admin" element={<AdminLayout />}>
    <Route index element={<Dashboard />} />              {/* /admin */}
    <Route path="parsing" element={<ParsingPage />} />  {/* /admin/parsing */}
    <Route path="library" element={<LibraryPage />} />  {/* /admin/library */}
    <Route path="graph" element={<GraphPage />} />      {/* /admin/graph */}
    <Route path="chat" element={<ChatPage />} />        {/* /admin/chat */}
  </Route>
  
  <Route path="/chat" element={<UserChatPage />} />     {/* 用户端对话 */}
  <Route path="*" element={<NotFound />} />             {/* 404 */}
</Routes>
```

### 5.2 页面与 API 对照表

| 页面 | 路由 | 调用的 API | 说明 |
|------|------|-----------|------|
| Welcome | `/` | `stats.system` | 展示系统统计数据 |
| Login | `/login` | OAuth 授权跳转 | Kimi OAuth 登录 |
| Dashboard | `/admin` | `stats.system`, `articles.list({status:"pending"})`, `knowledge.stats` | 数据仪表盘 |
| Parsing | `/admin/parsing` | `articles.list`, `articles.create`, `articles.updateStatus` | 文献上传解析 |
| Library | `/admin/library` | `articles.list`, `articles.get`, `articles.approve`, `articles.delete`, `articles.updateStatus` | 文献管理审核 |
| Graph | `/admin/graph` | `knowledge.getGraph`, `knowledge.stats`, `knowledge.search` | 知识图谱可视化 |
| AdminChat | `/admin/chat` | `chat.listSessions`, `articles.list({status:"approved"})`, `chat.createSession`, `chat.addMessage` | 管理端问答 |
| UserChat | `/chat` | 同 AdminChat + `auth.me` | 用户端问答 |

---

## 六、认证流程详解

### 6.1 Kimi OAuth 2.0 登录流程

```
[用户] --点击登录--> [前端 Login.tsx]
                         |
                         v
              构造 OAuth URL：
              https://auth.kimi.com/oauth/authorize
              ?client_id={APP_ID}
              &redirect_uri={origin}/api/oauth/callback
              &response_type=code
              &scope=profile
              &state={redirect_path}
                         |
                         v
              [浏览器跳转] --> [Kimi 授权页]
                                   |
                                   v
              [用户授权] --> [Kimi 重定向]
              重定向到 /api/oauth/callback?code=xxx&state=xxx
                                   |
                                   v
              [后端 api/kimi/auth.ts]
              1. 用 code 换取 access_token
                 POST https://auth.kimi.com/api/oauth/token
                 { grant_type, code, client_id, client_secret, redirect_uri }
              
              2. 用 access_token 获取用户信息
                 GET https://open.kimi.com/api/user/profile
                 Header: Authorization: Bearer {access_token}
              
              3. 在 users 表 upsert 用户记录
                 INSERT ... ON DUPLICATE KEY UPDATE ...
              
              4. 生成 JWT session token
                 使用 jose 库签名，有效期 1 年
              
              5. 写入 HttpOnly cookie
                 cookie name: "kimi_sid"
              
              6. 重定向到首页 /
```

### 6.2 Session 验证

每个 tRPC 请求自动携带 cookie，后端中间件检查：

```typescript
// middleware.ts
const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
```

### 6.3 前端路由守卫

```typescript
// AdminLayout.tsx
function RouteGuard({ children }) {
  useEffect(() => {
    const user = localStorage.getItem("medrag_user");
    if (!user) navigate("/login");
  }, []);
  return children;
}
```

**注意**：当前前端使用 localStorage 存储用户信息进行路由守卫，后端使用 cookie-based session。生产环境应统一使用 cookie session。

---

## 七、环境变量配置

### 7.1 后端环境变量（.env）

```env
# ── Backend ─────────────────────────────────────────────────────
APP_ID=19da5128-d392-8ac8-8000-00004aa4c8cc     # Kimi 应用 ID
APP_SECRET=dev-secret-key-for-jwt-signing         # JWT 签名密钥

# ── Database (MySQL) ───────────────────────────────────────────
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=123456
DB_NAME=medrag

# ── Frontend (暴露给浏览器) ────────────────────────────────────
VITE_KIMI_AUTH_URL=https://auth.kimi.com          # Kimi 认证地址
VITE_APP_ID=19da5128-d392-8ac8-8000-00004aa4c8cc  # Kimi 应用 ID

# ── Backend (Auth) ─────────────────────────────────────────────
KIMI_AUTH_URL=https://auth.kimi.com               # Kimi 认证地址
KIMI_OPEN_URL=https://open.kimi.com               # Kimi Open API 地址

# ── Admin Role ──────────────────────────────────────────────────
OWNER_UNION_ID=                                   # 管理员 unionId
```

### 7.2 前端环境变量

前端通过 `import.meta.env.VITE_xxx` 读取以 `VITE_` 开头的环境变量。

---

## 八、部署指南

### 8.1 环境要求

- Node.js 20+
- MySQL 8.0+
- npm 10+

### 8.2 安装步骤

```bash
# 1. 解压项目
cd MedRAG_v21_source

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入数据库密码和 Kimi OAuth 配置

# 4. 创建数据库并推送表结构
mysql -u root -p -e "CREATE DATABASE medrag CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
npm run db:push

# 5. 构建项目
npm run build

# 6. 启动服务
PORT=3000 npm start
```

### 8.3 开发模式

```bash
# 前端 + 后端同时启动（Vite Dev Server）
npm run dev

# 前端访问：http://localhost:3000
# API 地址：http://localhost:3000/api/trpc
```

### 8.4 数据库迁移

```bash
# 生成迁移文件
npm run db:generate

# 执行迁移
npm run db:migrate

# 直接推送（开发环境推荐）
npm run db:push
```

---

## 九、关键注意事项

### 9.1 JSON 字段处理

MySQL 的 JSON 字段在前端和后端之间的序列化/反序列化：

```typescript
// 后端存储：authors 和 keywords 是 JSON 类型
// 前端接收：Drizzle ORM 自动将 JSON 解析为 JavaScript 数组/对象

// 示例：authors 字段
// 数据库: '["Zhang W", "Li M"]'
// 前端接收: ["Zhang W", "Li M"]（自动解析）
```

### 9.2 布尔值处理

MySQL 没有原生布尔类型，使用 `int` 0/1：

```typescript
// is_in_knowledge_base 字段
// 数据库: 0 或 1
// 前端判断: article.isInKnowledgeBase === 1
```

### 9.3 插入 ID 获取

MySQL 的自增 ID 通过 `ResultSetHeader.insertId` 获取：

```typescript
import { ResultSetHeader } from "mysql2/promise";

const result = await db.insert(articles).values({...});
const id = (result as unknown as [ResultSetHeader, unknown[]])[0].insertId;
```

项目已封装 `getInsertId()` 辅助函数在 `api/queries/connection.ts` 中。

### 9.4 时区处理

所有 `timestamp` 字段默认使用 `CURRENT_TIMESTAMP`，存储 UTC 时间。前端显示时建议转换为本地时区。

### 9.5 前端 API 错误处理

tRPC 客户端已配置全局错误处理：

- **网络错误**：自动重试 3 次，静默失败
- **认证错误 (401)**：不重试，前端可捕获后跳转登录页
- **其他错误**：控制台输出，不阻塞页面渲染

---

## 十、文件清单

### 10.1 后端文件（api/）

| 文件 | 行数 | 说明 |
|------|------|------|
| boot.ts | ~50 | Hono 应用入口，注册路由，启动服务器 |
| router.ts | ~20 | tRPC 路由聚合 |
| middleware.ts | ~45 | 认证中间件、权限中间件 |
| context.ts | ~22 | 请求上下文构建 |
| articles-router.ts | ~240 | 文献 CRUD、状态管理 |
| auth-router.ts | ~23 | 认证路由 |
| chat-router.ts | ~121 | 对话会话和消息 |
| knowledge-router.ts | ~144 | 知识图谱节点和边 |
| notes-router.ts | ~1070 | 笔记 CRUD |
| stats-router.ts | ~69 | 系统统计 |
| queries/connection.ts | ~28 | MySQL 连接池 |
| queries/users.ts | ~37 | 用户查询 |
| lib/env.ts | ~24 | 环境变量 |
| lib/cookies.ts | ~20 | Cookie 工具 |
| kimi/auth.ts | ~131 | Kimi OAuth 认证 |
| kimi/platform.ts | ~30 | Kimi 平台 API |
| kimi/session.ts | ~40 | JWT Session |
| kimi/types.ts | ~15 | Kimi 类型 |

### 10.2 前端文件（src/）

| 文件 | 行数 | 说明 |
|------|------|------|
| App.tsx | ~62 | 路由定义 |
| pages/Welcome.tsx | ~234 | 首页落地页 |
| pages/Login.tsx | ~160 | 登录页 |
| pages/Register.tsx | ~200 | 注册页 |
| pages/AdminLayout.tsx | ~190 | 后台布局 |
| pages/Dashboard.tsx | ~173 | 数据仪表盘 |
| pages/ParsingPage.tsx | ~400 | 文献解析 |
| pages/LibraryPage.tsx | ~350 | 文献库 |
| pages/GraphPage.tsx | ~215 | 知识图谱 |
| pages/AdminChatPage.tsx | ~324 | 管理端对话 |
| pages/UserChatPage.tsx | ~465 | 用户端对话 |
| pages/NotFound.tsx | ~20 | 404 页 |
| providers/trpc.tsx | ~85 | tRPC 客户端配置 |
| providers/toast.tsx | ~50 | Toast 通知 |
| hooks/useAuth.ts | ~58 | 认证 Hook |
| db/schema.ts | ~240 | 数据库 Schema |

---

## 十一、扩展开发指南

### 11.1 添加新 API

1. 在 `api/` 目录下创建新路由文件，如 `reports-router.ts`
2. 在 `api/router.ts` 中注册新路由
3. 在 `db/schema.ts` 中添加新表（如需）
4. 运行 `npm run db:push` 推送表结构
5. 前端通过 `trpc.newModule.method.useQuery()` 调用

### 11.2 添加新页面

1. 在 `src/pages/` 下创建新页面组件
2. 在 `src/App.tsx` 中添加路由
3. 如需侧边栏入口，在 `AdminLayout.tsx` 的 menu 数组中添加

### 11.3 添加新表

1. 在 `db/schema.ts` 中使用 `mysqlTable()` 定义新表
2. 在 `db/relations.ts` 中定义表关系（可选）
3. 导出类型：`export type NewTable = typeof newTables.$inferSelect;`
4. 运行 `npm run db:push`

---

## 十二、联系方式

如有对接问题，请检查：

1. MySQL 是否正常运行且数据库已创建
2. 环境变量是否正确配置
3. Drizzle 表结构是否已推送
4. 后端服务是否已启动（PORT 默认 3000）

---

**文档版本**：v21
**更新日期**：2025-05-29
**数据库**：MySQL 8.0
**后端框架**：Hono 4 + tRPC 11 + Drizzle ORM
**前端框架**：React 19 + Tailwind CSS 3
