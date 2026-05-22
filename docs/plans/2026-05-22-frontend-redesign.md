# MedASR 前端重设计 — Apple 风格 + 医疗 + 科技

Date: 2026-05-23
Status: APPROVED
Mode: Builder

## 概述

将现有 Gradio 单页 UI 替换为 4 页纯 HTML/CSS/JS 前端，FastAPI 后端零改动。设计方向：Apple 发布会风格（深色极简 + 精准排版 + 慢速滚动叙事）+ 医疗蓝点缀 + 科技微交互。

## 4 页架构

```
/                    → Landing (宣传首页)
/login               → 登录/注册
/admin               → PDF 上传 & 知识库管理
/chat                → Agent 问答 (Claude/ChatGPT 风格)
```

FastAPI 添加 4 个静态路由，API 端点不变。

## 设计系统

### 色彩

| Token | 色值 | 用途 |
|-------|------|------|
| --bg-primary | #0a0a0f | 主背景 (接近纯黑) |
| --bg-elevated | #14141f | 卡片/面板背景 |
| --bg-surface | #1a1a2e | Hover/激活态 |
| --accent | #3b82f6 | 主强调色 (医疗蓝) |
| --accent-glow | #60a5fa | 发光/高亮 |
| --medical-green | #10b981 | 成功/就绪状态 |
| --text-primary | #f1f5f9 | 主文字 |
| --text-secondary | #94a3b8 | 辅助文字 |
| --text-muted | #475569 | 弱化文字 |
| --border | #1e293b | 分割线 |

### 排版

| Token | 字体 | 用途 |
|-------|------|------|
| --font-display | 'Playfair Display', serif | 页面标题 |
| --font-heading | 'Inter', sans-serif | 小标题 (超400种样式, 选最锐利变体) |
| --font-body | 'Inter', sans-serif | 正文 |
| --font-mono | 'JetBrains Mono', monospace | 代码/数据 |

字号系统: 12/14/16/18/20/24/32/48/64px

### 图标

内嵌 SVG 图标系统，不用外部图标库。每个图标手工绘制为 24x24 viewBox，描边 1.5px，圆角端点。

核心图标: 搜索(放大镜)、上传(云+箭头)、文献(书页)、问答(聊天气泡)、用户头像(圆形+人形)、设置(齿轮)、首页(房子)、退出(门+箭头)、医疗十字、数据库(圆柱体)。

### 动效

- 页面加载: 元素从下方 30px 淡入 (opacity 0→1, translateY 30→0), 错落 80ms
- Hover: 卡片上浮 4px + 阴影扩大, 过渡 300ms ease-out
- 按钮: 渐变闪烁 on hover, 0.5s
- 滚动触发: IntersectionObserver, 元素进入视口时淡入
- 打字效果: 首页 hero 标题逐字出现 (50ms/字)

### 空间

- 最大内容宽度: 1200px (居中)
- 卡片内边距: 32px
- 卡片间隙: 24px
- 页面边距: 5vw
- 段落间距: 1.5em
- 卡片圆角: 16px

## 页面设计

### Page 1: Landing (`/`)

```
┌─────────────────────────────────────────────────────┐
│  NAV: [Logo  MedASR]          [登录] [开始使用]      │
├─────────────────────────────────────────────────────┤
│                                                     │
│          ┌─────────────────────────┐               │
│          │  医学知识               │               │
│          │   从未如此精准           │  ← 打字动效     │
│          │                         │               │
│          │  基于 Agentic RAG       │               │
│          │  4篇文献 · 863实体       │               │
│          │  证据等级 · 精准溯源     │               │
│          └─────────────────────────┘               │
│                                                     │
│          [开始探索]  [了解更多 ↓]                     │
│                                                     │
├─────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ 📄       │  │ 🧠       │  │ 🔗       │         │
│  │ 精准解析  │  │ 语义理解  │  │ 证据溯源  │         │
│  │ MinerU   │  │ PICO+NER  │  │ 来源+页码 │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│                                                     │
│  ┌─────────────────────────────────────────┐       │
│  │         "它改变了我们检索医学文献的方式"    │       │
│  │                        ——某三甲医院研究员 │       │
│  └─────────────────────────────────────────┘       │
│                                                     │
│  FOOTER: © 2026 MedASR · 比赛作品                    │
└─────────────────────────────────────────────────────┘
```

### Page 2: Login (`/login`)

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│            ┌──────────────────────┐                 │
│            │                      │                 │
│            │     👤 头像占位        │                 │
│            │                      │                 │
│            │   欢迎回来             │                 │
│            │                      │                 │
│            │   ┌──────────────┐   │                 │
│            │   │ 用户名/邮箱    │   │                 │
│            │   └──────────────┘   │                 │
│            │   ┌──────────────┐   │                 │
│            │   │ 密码          │   │                 │
│            │   └──────────────┘   │                 │
│            │                      │                 │
│            │   [═══ 登 录 ═══]    │                 │
│            │   没有账号？注册       │                 │
│            │                      │                 │
│            └──────────────────────┘                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

登录成功后根据角色分流:
- `role=admin` → `/admin`
- `role=user` → `/chat`

### Page 3: Admin (`/admin`)

```
┌─────────────────────────────────────────────────────┐
│  SIDEBAR          │  MAIN                           │
│  ┌──────────┐     │                                 │
│  │ 👤 头像    │     │  ┌─────────────────────────┐  │
│  │ 张主任     │     │  │ 📤 上传PDF文献            │  │
│  │ 管理员     │     │  │ 拖拽文件到此处              │  │
│  │          │     │  │ 或点击选择文件               │  │
│  │ 📊 仪表盘  │     │  └─────────────────────────┘  │
│  │ 📄 文献库  │     │                                 │
│  │ ⚙️ 设置    │     │  知识库状态                      │
│  │ 🚪 退出    │     │  ┌───┐ ┌───┐ ┌───┐ ┌───┐    │
│  └──────────┘     │  │ 4 │ │185│ │863│ │771│    │
│                   │  │文献│ │片段│ │实体│ │关系│    │
│                   │  └───┘ └───┘ └───┘ └───┘    │
│                   │                                 │
│                   │  最近上传                         │
│                   │  ┌──────────────────────────┐   │
│                   │  │ Stanford B型共识  ✓ 已索引  │   │
│                   │  │ 子宫内膜异位症共识  ✓ 已索引  │   │
│                   │  └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Page 4: Chat (`/chat`)

```
┌─────────────────────────────────────────────────────┐
│  HEADER: [👤] 研究员 王医生           [新建对话] [...] │
├──────────────────────┬──────────────────────────────┤
│  对话列表              │  对话区                       │
│  ┌────────────────┐   │                              │
│  │ 🔍 TBAD诊断标准  │   │  👤 用户: Stanford B型主动     │
│  │ 🔍 药物治疗方案  │   │  脉夹层如何分型和分期？         │
│  └────────────────┘   │                              │
│  + 新对话             │  🤖 Agent:                     │
│                      │  │ 🧠 理解问题                 │
│                      │  │ 🔍 search_rag → 找到8条     │
│                      │  │ 🔬 cross_check → 1处矛盾    │
│                      │  │ ✨ 综合回答                  │
│                      │                              │
│                      │  ## Stanford B型分型与分期      │
│                      │  ### [高] ESC 2024 分型法      │
│                      │  ...                          │
│                      │  📎 [Stanford共识 p.5]         │
│                      │                              │
│                      │  ┌──────────────────────┐    │
│                      │  │ 输入新问题...      [→] │    │
│                      │  └──────────────────────┘    │
└──────────────────────┴──────────────────────────────┘
```

## API 对接

前端通过 `fetch()` 调用现有 FastAPI 端点，无需新建:

| 前端操作 | API 调用 |
|---------|---------|
| Admin 上传 PDF | `POST /api/upload` (multipart) |
| 查询知识库状态 | `GET /api/status` |
| 用户提问 | `POST /api/query` |
| Agent 多步推理 | `POST /api/agent` |
| 批量导入 | `POST /api/batch-import` |
| 知识库重建 | `GET /api/reload` |

## 实施文件

```text
static/
  css/
    main.css          # 全局样式 + 设计系统变量
    landing.css       # 首页专属样式
    login.css          # 登录页
    admin.css          # 管理后台
    chat.css           # 问答界面
  js/
    api.js             # fetch() 封装
    landing.js         # 首页动效 (打字机, 滚动触发)
    login.js           # 登录逻辑
    admin.js           # 上传 + 状态刷新
    chat.js            # 对话 + Agent 推理流
  img/
    logo.svg           # Logo
    icons/             # 24 个 SVG 图标
templates/
  index.html           # Landing
  login.html           # 登录注册
  admin.html           # 管理后台
  chat.html            # Agent 问答
```

## 技术约束

- 无外部 CSS 框架 (不用 Bootstrap/Tailwind)
- 无外部 JS 库 (不用 jQuery/React)
- 字体通过 Google Fonts @import
- SVG 图标全部内嵌，零外部依赖
- CSS 变量实现暗色主题，未来可加亮色模式
- 所有动画用 CSS transition/animation，不依赖 JS 动画库

## What Makes This Unforgettable

1. **Hero 打字机效果** — 首页标题逐字浮现，每个字 50ms 错落
2. **深色玻璃卡片** — backdrop-filter: blur(20px) + 半透明背景 + 细边框
3. **Agent 推理可视化** — 对话中实时展示 Agent 工具调用链 (search_rag → cross_check → answer)
4. **证据等级标签** — 每条引用带彩色标签: 绿色=RCT, 蓝色=Meta, 灰色=专家共识
5. **状态呼吸灯** — 知识库状态使用 pulsing dot 动画，健康=绿色, 构建中=橙色, 异常=红色

## Review Decisions (Eng Review 2026-05-23)

- D1: 添加 FastAPI Mock 登录端点 (POST /api/login, /api/register)
- D2: 添加 FastAPI StaticFiles 挂载 + 4 条 HTML 路由
- D3: 添加 SSE 流式端点 (GET /api/agent/stream) 实现实时推理展示
- C1: CSS 合并为3文件: main.css + pages.css + animations.css
- T1: 添加 tests/test_frontend.py (路由 + Mock登录 + SSE)

## NOT in scope

| 项目 | 原因 |
|------|------|
| 真实用户数据库 | 比赛 Demo，Mock 登录足够 |
| React/Next.js 重写 | 纯 HTML/CSS/JS 已满足比赛需求 |
| 亮色主题 | CSS 变量已预留，赛后实现 |
| WebSocket 双向通信 | SSE 单向流已满足推理展示需求 |
| CORS 配置 | 前后端同一端口，无跨域问题 |

## What already exists

| 能力 | 位置 | 复用 |
|------|------|------|
| 全部 RAG API | api.py (POST /api/query, /api/agent, etc.) | 前端通过 fetch() 调用，零改动 |
| Pipeline 双引擎 | src/pipeline.py | 不改动 |
| Agent 6 tools | src/agent.py | 不改动 |
| 设计系统 Skill | .agents/skills/frontend-design/SKILL.md | 指导前端开发 |

## Implementation Tasks

- [ ] **T1 (P1, human: ~1h / CC: ~15min)** — api.py — 添加: (1)Mock登录 (2)静态文件服务 (3)SSE流式端点 (4)4条HTML路由
  - Files: `api.py`, `static/`, `templates/`
  - Verify: `pytest tests/test_frontend.py`

- [ ] **T2 (P1, human: ~2h / CC: ~30min)** — 前端4页面开发
  - Files: `templates/*.html`, `static/css/`, `static/js/`, `static/img/`
  - Verify: 浏览器访问 `/`, `/login`, `/admin`, `/chat`

- [ ] **T3 (P2, human: ~30min / CC: ~10min)** — SSE流式前端对接
  - Files: `static/js/chat.js`
  - Verify: Agent 推理步骤实时出现在对话界面

- [ ] **T4 (P2, human: ~15min / CC: ~5min)** — 前端回归测试
  - Files: `tests/test_frontend.py`
  - Verify: `pytest tests/test_frontend.py` 4/4 pass

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 5 issues, 0 critical gaps |

**REVIEW DECISIONS (all resolved):**
- D1: 添加 Mock 登录端点
- D2: FastAPI StaticFiles + HTML 路由
- D3: SSE 流式 Agent 推理
- C1: CSS 合并为 3 文件
- T1: 4 个 HTTP 回归测试

**CRITICAL GAPS: 0**

**UNRESOLVED: 0**

**VERDICT: ENG REVIEW CLEARED — ready to implement.**
