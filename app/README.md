# MedRAG v19 医疗文献高质量 RAG 知识库系统

## 一、系统简介
基于 MinerU + LightRAG 的医疗文献 RAG 知识库系统，覆盖 PDF 解析、语义切分、知识图谱构建、多模态问答三大核心任务。

## 二、技术栈
- **前端**: React 19 + TypeScript + Vite + Tailwind CSS + tRPC Client
- **后端**: Hono + tRPC 11 + Drizzle ORM + SQLite (better-sqlite3)
- **认证**: Kimi OAuth 2.0 / 本地模拟登录
- **数据库**: SQLite (文件型，无需额外安装)

## 三、环境要求
- Node.js 18+ (推荐 20 LTS)
- npm 9+

## 四、安装步骤

### 步骤1：解压
```bash
unzip MedRAG_v19_fullstack.zip
cd app
```

### 步骤2：安装依赖
```bash
npm install
```

### 步骤3：初始化数据库
```bash
npm run db:push
```
> 这会自动创建 SQLite 数据库文件并同步表结构

### 步骤4：启动开发服务器
```bash
npm run dev
```
> 浏览器自动打开 http://localhost:3000

### 步骤5：构建生产版本（可选）
```bash
npm run build
npm start
```

## 五、默认账号
- **医疗专家**: 登录页选择"医疗专家"角色 → 进入管理后台
- **普通用户**: 登录页选择"普通用户"角色 → 进入问答界面

## 六、项目结构
```
app/
├── src/                    # 前端源码
│   ├── pages/             # 13个页面组件
│   ├── components/        # UI组件（含星空背景）
│   ├── providers/         # tRPC客户端 + Toast
│   ├── hooks/             # 认证 + 主题
│   ├── App.tsx            # 路由配置
│   └── main.tsx           # 应用入口
├── api/                    # 后端源码
│   ├── boot.ts            # Hono服务器
│   ├── router.ts          # tRPC路由
│   ├── auth-router.ts     # 认证
│   ├── articles-router.ts # 文献管理
│   ├── knowledge-router.ts# 知识图谱
│   ├── chat-router.ts     # 聊天问答
│   ├── stats-router.ts    # 统计
│   └── kimi/              # Kimi OAuth
├── db/
│   ├── schema.ts          # 数据库表结构
│   └── seed.ts            # 种子数据
├── contracts/             # 前后端共享类型
├── package.json           # 依赖配置
└── vite.config.ts         # Vite配置
```

## 七、API端点
所有API通过 `/api/trpc/*` 访问，tRPC自动处理类型安全。

### 主要路由
| 路由 | 说明 |
|------|------|
| `/` | 首页（星空背景） |
| `/#/login` | 登录页 |
| `/#/register` | 注册页 |
| `/#/admin` | 管理后台（概览） |
| `/#/admin/parsing` | PDF解析管理 |
| `/#/admin/library` | 文献库 |
| `/#/admin/graph` | 知识图谱 |
| `/#/admin/chat` | 医疗问答（Admin） |
| `/#/chat` | 医疗问答（用户） |

## 八、常见问题

### Q: 为什么静态文件打不开？
A: 这是全栈应用，需要后端API提供数据。必须按上述步骤运行 `npm run dev` 或 `npm start`。

### Q: 数据库文件在哪？
A: SQLite 数据库文件在项目根目录 `data/medrag.db`，自动创建。

### Q: 如何修改端口？
A: 默认3000端口。如需修改，编辑 `vite.config.ts` 和 `api/boot.ts` 中的端口配置。
