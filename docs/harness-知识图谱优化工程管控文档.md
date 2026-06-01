# MedRAG Harness 工程管控文档 —— 知识图谱可视化优化专项

---

## 目录

1. [项目概述](#1-项目概述)
   - 1.1 使命宣言
   - 1.2 现状分析
   - 1.3 八维专家视角优化目标
2. [设计哲学](#2-设计哲学)
   - 2.1 实事求是 —— 从真实代码中发现问题
   - 2.2 矛盾论 —— 抓住主要矛盾与次要矛盾
   - 2.3 实践论 —— 迭代式的测试-优化循环
   - 2.4 集中优势兵力 —— 聚焦最高ROI的变更
3. [架构设计](#3-架构设计)
   - 3.1 系统全景架构
   - 3.2 G6GraphView 组件架构
   - 3.3 GraphPage 布局架构
   - 3.4 数据流全链路
   - 3.5 主题系统集成
4. [任务分解](#4-任务分解)
   - T1: 节点多类型配色系统
   - T2: 边关系类型系统
   - T3: HTML Tooltip 悬停提示系统
   - T4: GraphPage UI 增强
   - T5: 交互系统
   - T6: 健壮性加固
5. [TDD 测试计划](#5-tdd-测试计划)
6. [验证与审计](#6-验证与审计)
7. [风险管理](#7-风险管理)
8. [经验总结](#8-经验总结)

---

## 1. 项目概述

### 1.1 使命宣言

MedRAG 知识图谱可视化优化专项（以下简称"本专项"）的核心使命是：**将基于 AntV G6 v5 的医学知识图谱从"功能可用"提升到"业务可信"的级别**。具体而言，通过节点多类型配色系统、边关系类型系统、HTML Tooltip 悬停系统、交互增强系统以及健壮性加固，使医学专家能够在 5 秒内通过颜色区分实体类别、通过悬停预览实体详情、通过单击进入关联关系导航，最终实现医学知识图谱从"看得见"到"看得懂"的质变。

本专项服务于 MinerU 赛道三（医疗赛题）的展示需求。知识图谱是评委评估系统能力的核心载体，图形化呈现的质量直接决定了项目的专业感知度和可信度。

### 1.2 现状分析

在专项启动前，系统已具备以下基础能力：

**后端基础**：
- LightRAG KV Store 已存储 863 个医学实体节点和 771 条关系边（参见 `src/graph.py` 第 15-159 行 `GraphManager.build()` 方法）
- `_infer_group()` 方法（`src/graph.py` 第 77-136 行）能够根据实体名称的医学关键词（如 "disease"→疾病、"drug"→药物、"surgery"→治疗）将节点分为 9 大类：`disease`、`drug`、`symptom`、`treatment`、`check`、`anatomy`、`procedure`、`guideline`、`metric`、`other`
- 通过 FastAPI REST API `/api/graph` 端点暴露（`src/api_business.py` 第 373-379 行）
- 前端通过 `trpc.knowledge.getGraph.useQuery()` 消费数据（`app/src/pages/GraphPage.tsx` 第 53 行）

**前端基础**：
- `G6GraphView.tsx` 组件（325 行）使用 AntV G6 v5 的 `d3-force` 力导向布局渲染图谱
- `GraphPage.tsx` 组件（562 行）提供工具栏、图例面板、统计面板、节点详情面板
- TypeScript 类型定义 `GNode` 和 `GEdge` 已包含 `group` 和 `relationType` 字段（`G6GraphView.tsx` 第 51-52 行）

**已识别的 6 类核心缺陷**（基于真实代码审计）：

| 编号 | 缺陷类别 | 具体表现 | 代码证据 |
|------|---------|---------|---------|
| D1 | 节点配色缺乏类型区分 | 所有节点在初版中使用单一默认颜色，无法区分疾病、药物、症状等实体类别 | 初版无 `NC` 色板定义 |
| D2 | 边关系无类型着色 | 所有关系边使用统一的红色线条，无法区分"治疗"、"导致"、"相关"等语义差异 | 初版无 `EC` 色板定义 |
| D3 | 悬停信息不足 | 无 Tooltip 系统，用户需要单击节点才能在右侧面板查看详情，交互成本高 | 初版无 `showTooltip` / `hideTooltip` 函数 |
| D4 | 图谱无统计维度 | 无分布柱状图、无实体类型计数，用户无法快速了解图谱构成 | 初版 `GraphPage` 无 `nodeTypeStats` / `edgeTypeStats` |
| D5 | 交互可达性差 | 无键盘快捷键（F 重置视图、Esc 取消选中）、无搜索高亮反馈、无邻居节点高亮 | 初版无 `onKey` 监听和 `applyHL` 函数 |
| D6 | 健壮性不足 | 无 Abort Guard（销毁中的实例可能被回调操作）、无 Theme Observer 清理、无 Resize 防抖 | 初版无 `aborted` 标志位和 `MutationObserver` 断开逻辑 |

### 1.3 八维专家视角优化目标

从 8 个不同专家角色的视角审视专项目标：

#### 业务专家（领域医学专家）

**关注点**：能否在 5 秒内通过颜色区分目标实体类别？

**目标**：
- 13 类医学实体（disease/drug/symptom/treatment/check/exam/clinical_indicator/anatomy/procedure/gene/pathogen/guideline/metric）各有独立可辨识的颜色，符合医学领域的色彩心理认知（如 disease=红色代表警示、drug=蓝色代表治疗、treatment=绿色代表安全）
- 9 类关系（treats/causes/associated_with/contraindicated/diagnoses/prevents/symptom_of/interacts_with/related_to）各有语义明确的颜色编码
- 中文标签完整覆盖（疾病/药物/症状/治疗/检查/指标/解剖/手术/基因/病原体/指南）

**量化指标**：颜色辨识准确率 ≥ 95%（在标准色觉条件下，10 名测试者在 5 秒内正确辨认实体类型的比例）

#### 系统架构师

**关注点**：数据路径是否打通，架构是否可扩展？

**目标**：
- LightRAG KV Store → GraphManager → FastAPI → 前端 API Client → React → G6 的数据流全链路无断裂
- `_infer_group` 的分类逻辑可扩展（新增实体类型只需在关键词列表中追加）
- GraphManager 的 `snapshot()` / `get_delta()` 增量更新机制可支持后续的实时图谱更新
- 前端 `NC` 和 `EC` 色板与后端 `_infer_group` 分类名一一映射

**量化指标**：数据通路端到端延迟 ≤ 500ms（从 `/api/graph` 请求到 G6 `buildData()` 返回），新增实体类型只需修改 2 处代码（后端 `_infer_group` + 前端 `NC` 色板）

#### 全栈专家

**关注点**：前后端数据形状是否一致，错误处理是否完善？

**目标**：
- 后端返回的 `group` 字段与前端 `NC` 色板的 key 完全对齐（包括 `clinical_indicator`、`exam` 等复合类型）
- `snake_case` → `camelCase` 转换在 API Client 层（`app/src/lib/api.ts` 第 11-22 行 `toCamel()` 函数）统一处理
- 加载态（Loading）、错误态（Error + 重试按钮）、空态（引导文案）三种 UI 状态全覆盖
- 前端 API 适配层（`app/src/providers/trpc.tsx`）支持 Query Key 缓存失效

**量化指标**：3 种 UI 状态（loading/error/empty）100% 覆盖，前端控制台 0 个 `undefined` 属性访问错误

#### 性能专家

**关注点**：863 节点 + 771 边的渲染性能是否可接受？

**目标**：
- G6 初始化耗时 ≤ 1000ms（从 `new Graph()` 到 `g.render().then()` 回调触发）
- `d3-force` 布局的力模拟迭代次数控制在 200 次以内（当前配置 `forceSimulationIterations: 200`，`G6GraphView.tsx` 第 217 行）
- 搜索/筛选操作的 `applyHL()` 函数执行耗时 ≤ 50ms（通过只遍历显式节点/边列表来保证）
- Resize 事件通过 `window.addEventListener("resize", r)` 监听但无需防抖（`G6GraphView.tsx` 第 314-321 行，`g.setSize()` 是同步轻量操作）
- 导出 PNG 时 `g.toDataURL()` 为异步操作，不阻塞 UI 线程

**量化指标**：FCP（First Contentful Paint）≤ 1.5s，搜索过滤响应 ≤ 50ms，布局稳定时间 ≤ 3s

#### 前端专家

**关注点**：React 18+ 的最佳实践是否遵守？

**目标**：
- 使用单一 `useEffect` 架构管理 G6 图实例（`G6GraphView.tsx` 第 181-305 行），依赖数组为 `[nodes.length, edges.length, theme]`
- 通过 `aborted` 闭包变量（第 186 行）防止组件卸载后的回调操作
- `useCallback` 正确包裹 `showTooltip` / `hideTooltip`（第 149、176 行），避免不必要的重新创建
- `useRef` 管理 `containerRef`、`graphRef`、`tooltipRef` 三个引用，避免触发重渲染
- Search/Filter 的 `applyHL()` 通过独立 `useEffect`（第 308-311 行）响应，与图实例化主逻辑解耦

**量化指标**：React DevTools Profiler 中 G6GraphView 的渲染次数 ≤ 2 次/页，无 "Can't perform a React state update on an unmounted component" 警告

#### 美术大师（视觉设计专家）

**关注点**：彩色图谱的美学质量是否达到竞赛展示级别？

**目标**：
- 节点颜色在亮色/暗色两种主题下均有良好的对比度和辨识度（暗色主题下颜色提亮 10%-15%，参见 `NC` 色板中 `f/s`（亮色）与 `df/ds`（暗色）的差异设计）
- 节点大小根据 `weight`（关联关系数）按 `sqrt(weight/maxWeight) * 34 + 14` 公式映射到 14-48px 半径范围，视觉上区分核心节点与边缘节点
- Tooltip 卡片采用毛玻璃效果（`backdropFilter: blur`），圆角 8px，阴影为 Medical Blue-tinted 投影系统
- 图例面板和图谱画布使用统一的 Medical AI 色调（`var(--m-primary)` #2563EB / `var(--bg-base)` #F0F4F8 / `var(--bg-surface)` #FFFFFF）
- 节点选中态使用金色高亮（`#FFD700` stroke + glow shadow），符合"选中=价值/重要性"的视觉隐喻

**量化指标**：WCAG AA 对比度标准达标率 ≥ 90%（亮色主题下文字 #1e293b 对背景 #FFFFFF 对比度 13.5:1，暗色主题下文字 #e2e8f0 对背景 #080E1A 对比度 10.8:1）

#### 视觉交互专家（UX 交互设计师）

**关注点**：用户完成典型任务需要多少步点击？

**目标**：
- 目标 1 "找到所有疾病类实体"：点击图例面板中的"疾病"即可筛选，1 步完成
- 目标 2 "查看某药物的关联疾病"：点击药物节点 → 右侧面板自动展示所有关联关系及方向（→ 表示该药物治疗某疾病，← 表示某疾病由该药物诊断），2 步完成
- 目标 3 "定位并聚焦某高危节点"：在搜索框输入关键词 → 节点高亮 → 点击节点 → 点击"聚焦"按钮，3 步完成
- 目标 4 "将图谱导出分享"：点击导出 PNG 按钮，1 步完成
- 支持键盘快捷操作：F = 重置视图、Esc = 取消选中、滚轮 = 缩放、拖拽 = 平移、拖拽节点 = 调整位置

**量化指标**：4 个典型任务的平均操作步数 ≤ 2 步，首次使用用户无需查阅文档即可完成基础操作的比率 ≥ 70%

#### 产品经理

**关注点**：这个专项为竞赛评比带来多大加分？

**目标**：
- 图谱视觉效果达到医学 AI 产品的商业级呈现水平（对标 IBM Watson Health、Google DeepMind Health 的知识图谱可视化）
- 交互体验让评委在 30 秒内理解系统能力边界（支持哪些实体类型、关系类型、图谱规模）
- 代码架构为后续商业化部署提供可扩展基础（新增实体类型仅需修改色板，新增交互模式仅需在 `G6GraphView` 中添加行为配置）
- 暗色/亮色双主题自适应满足不同评审环境的需求（答辩室可能有强光或暗光环境）

**量化指标**：30 秒内可理解的知识图谱信息密度 ≥ 85%（通过用户测试：3 名不知情评委在 30 秒内能准确说出系统支持的实体类型数量、关系类型数量、图谱节点总数的百分比）

---

## 2. 设计哲学 —— 毛泽东思想方法论

### 2.1 实事求是（Seek Truth from Facts）

> "实事"就是客观存在着的一切事物，"是"就是客观事物的内部联系，"求"就是我们去研究。

本专项严格贯彻"实事求是"原则，所有优化决策均基于**真实的代码现状和真实的用户需求**，而非凭空想象：

**事实一**：后端 `GraphManager._infer_group()` 已对 863 个节点完成 9 大类自动分类，但前端完全没有利用这个分类信息进行差异化渲染。证据：`src/graph.py` 第 77-136 行的 `_infer_group()` 方法使用了 120 行关键词匹配逻辑，返回 `disease`、`drug`、`symptom`、`treatment`、`check`、`anatomy`、`guideline`、`metric`、`other` 共 9 个基础类别；但前端在专项启动前仅使用单一默认颜色渲染所有节点。

**事实二**：后端返回的 relation 数据中已隐含 `relationType` 字段（通过 `_parse_relations()` 从 KV Store 中读取），但前端边渲染完全没有利用这个字段。证据：`src/graph.py` 第 60-74 行的 `_parse_relations()` 方法从 `kv_store_relation_chunks.json` 解析出 `source`、`target`、`weight` 三个字段，其中 key 格式为 `实体A<SEP>关系类型+实体B`，但从前端 `G6GraphView.buildData()` 的边构造逻辑看，原始实现中 `relationType` 被硬编码为 `"related_to"`。

**事实三**：AntV G6 v5 的 `node:pointerenter` 和 `node:pointerleave` 事件已原生支持（参考 G6 v5 官方文档），但专项启动前未绑定任何 Tooltip 显示逻辑。证据：初版 `G6GraphView.tsx` 中仅绑定了 `node:click` 事件，未注册 pointer 系列事件。

**事实四**：用户在实际操作中反复询问"这个点代表什么"——说明仅靠标签文字无法满足快速识别需求，需要在悬停时提供类型、描述、权重等补充信息。

基于以上四个事实，专项得出了明确的优化方向：利用已有的后端分类数据，在前端实现差异化视觉呈现。

### 2.2 矛盾论（On Contradiction）

> 在复杂的事物的发展过程中，有许多的矛盾存在，其中必有一种是主要的矛盾，由于它的存在和发展规定或影响着其他矛盾的存在和发展。

**主要矛盾**：节点配色缺乏类型区分 vs. 业务需要快速识别实体类别

这是压倒一切的主要矛盾。在专项启动前，所有的 863 个医学实体节点在视觉上完全一样——评委无法一眼看出哪些是疾病、哪些是药物、哪些是症状。这直接导致了图谱"看不懂"的根本问题。

**证据**：在 `G6GraphView.tsx` 的原始实现中，`buildData()` 函数（第 61-106 行）为所有节点统一调用 `nc(n.group || "other")` 来获取颜色，但由于 `NC` 色板尚未建立，所有节点返回相同的默认颜色。这是整个知识图谱优化专项的 **P0 致命缺陷**——如果评委无法区分节点类型，整个图谱功能形同虚设。

**次要矛盾（按优先级排序）**：

1. **边关系无类型着色** —— 所有关系边颜色相同，无法区分"治疗"、"导致"、"相关"等语义差异。P1 高优先级。
2. **悬停信息不足** —— 用户必须单击节点才能看到详情，交互成本过高。P1 高优先级。
3. **图谱缺少统计维度** —— 没有实体类型分布、没有关系类型计数。P2 中优先级。
4. **交互可达性差** —— 无搜索高亮反馈、无键盘快捷键。P2 中优先级。
5. **健壮性不足** —— 组件卸载时可能的内存泄漏和未捕获异常。P3 保障性优先级。

**矛盾解决的策略**：按 P0 → P1 → P2 → P3 的顺序逐级歼灭，每完成一个级别即提交 git commit，确保每个提交都是完整可工作的增量状态。这与 Mao 的"伤其十指不如断其一指"原则完全一致。

### 2.3 实践论（On Practice）

> 实践、认识、再实践、再认识，这种形式，循环往复以至无穷，而实践和认识之每一循环的内容，都比较地进到了高一级的程度。

本专项采用"设计-实现-验证-迭代"的四阶段循环：

**第一循环（节点配色）**：
- 设计阶段：定义 13 类实体颜色映射表 `NC`，包含 `f`（亮色填充）、`s`（亮色描边）、`df`（暗色填充）、`ds`（暗色描边）四个子字段
- 实现阶段：在 `buildData()` 中为每个节点动态注入 `style.fill` 和 `style.stroke`，基于 `n.group` 查表
- 验证阶段：在暗色/亮色双主题下检查所有 9 个基本类别的颜色辨识度，发现 `other` 类（灰色）在暗色背景下辨识度不足，将暗色灰度从 `#64748B` 调整到 `#94A3B8`
- 迭代阶段：根据 `_infer_group` 的实际分类结果扩展色板，从 9 类扩展到 13 类（将 `check` 拆分为 `check` 和 `exam`，新增 `gene`、`pathogen`、`clinical_indicator`、`procedure`）

**第二循环（边关系着色）**：
- 设计阶段：定义 9 类关系颜色映射表 `EC`，透明度统一为 50%-65%
- 实现阶段：在 `buildData()` 的边遍历中调用 `ec(e.relationType || "", dark)` 动态注入描边颜色
- 验证阶段：发现 `related_to` 作为默认关系类型的灰色与背景对比度不够，调整为 `rgba(100,116,139,0.40)`（亮色）和 `rgba(148,163,184,0.40)`（暗色）
- 迭代阶段：根据实际数据中出现的最高频关系类型（treats、causes、associated_with）验证颜色语义的直觉正确性

**第三循环（Tooltip 系统）**：
- 设计阶段：使用原生 DOM 创建 `position:fixed` 的 Tooltip 元素，而非 CSS-in-JS 方案，以完全控制 z-index 堆叠层级
- 实现阶段：绑定 `node:pointerenter` → 创建 HTML 内容 → `node:pointermove` → 实时跟随 → `node:pointerleave` → 隐藏
- 验证阶段：发现 Tooltip 在视口边缘会超出屏幕，添加了 `Math.min`/`Math.max` 的边界钳制逻辑（第 171-172 行）
- 迭代阶段：为 Tooltip 添加了类型徽章（圆形色块 + 中文标签）、权重显示和描述截断（最多 120 字符）

### 2.4 集中优势兵力（Concentrate Superior Forces）

> 集中优势兵力，各个歼灭敌人。

本专项的资源分配策略严格遵循"二八法则"——将 80% 的工程精力集中在 20% 的最高影响力变更上：

**第一梯队（最高 ROI — T1 节点配色）**：
- 投入：预计 4 小时
- 影响面：863 个节点 × 13 种颜色类型 × 2 种主题 = 影响整个图谱的 100% 视觉呈现
- 投入产出比：每 1 小时工作影响 216 个节点的视觉呈现

**第二梯队（高 ROI — T2 边着色 + T3 Tooltip）**：
- 投入：预计 4 小时（边着色） + 3 小时（Tooltip）
- 影响面：771 条边 + 每次悬停交互
- 投入产出比：直接解决"看不懂关系"和"不知道节点含义"两个用户痛点

**第三梯队（中 ROI — T4 GraphPage 增强 + T5 交互系统）**：
- 投入：预计 6 小时
- 影响面：图例面板、统计面板、节点详情面板、搜索、键盘交互
- 投入产出比：解决"不知道有多少类型"和"操作不方便"的体验问题

**第四梯队（保障性 — T6 健壮性加固）**：
- 投入：预计 3 小时
- 影响面：组件生命周期管理、错误边界、内存泄漏防护
- 投入产出比：保障前三梯队的工作成果不会因边缘场景而失效

---

## 3. 架构设计

### 3.1 系统全景架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         前端层（React 19 + TypeScript + Vite 7）           │
│                                                                          │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────────┐ │
│  │   ErrorBoundary │   │   ThemeProvider  │   │   TRPCProvider          │ │
│  │   (全局错误兜底)  │   │   (data-theme)   │   │   (React Query 缓存)     │ │
│  └────────┬────────┘   └────────┬────────┘   └───────────┬─────────────┘ │
│           │                     │                        │               │
│  ┌────────┴─────────────────────┴────────────────────────┴───────────┐   │
│  │                         GraphPage.tsx (562 行)                      │   │
│  │                                                                     │   │
│  │  trpc.knowledge.getGraph.useQuery()                                │   │
│  │       │                                                             │   │
│  │       ├── rawNodes (863 节点, group → 13 类型)                      │   │
│  │       ├── rawEdges (771 边, relationType → 9 类型)                  │   │
│  │       ├── nodeTypeStats / edgeTypeStats (实时统计)                  │   │
│  │       ├── search / filter (状态管理)                                │   │
│  │       └── selNode / connectedEdges / neighborNodes (选择态)         │   │
│  │                                                                     │   │
│  │  子组件: G6GraphView (325 行)                                       │   │
│  │  ├── NC 色板 (13 类型 × 4 颜色子字段)                                │   │
│  │  ├── EC 色板 (9 关系类型 × 2 主题)                                   │   │
│  │  ├── buildData() (节点/边数据 → G6 格式)                              │   │
│  │  ├── applyHL() (搜索/筛选 → 状态更新)                                │   │
│  │  └── Tooltip 管理器 (DOM-based, fixed 定位)                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ GET /api/graph
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      API 层（FastAPI + Uvicorn）                          │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │  /api/graph        → graph_data()      → gm.build()             │     │
│  │  /api/graph/stats  → graph_stats()     → Counter(group)          │     │
│  │  /api/graph/nodes/ → graph_search()    → filter(label)           │     │
│  └─────────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    数据层（GraphManager + LightRAG KV Store）             │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  GraphManager (src/graph.py, 191 行)                              │    │
│  │                                                                   │    │
│  │  build()                                                          │    │
│  │    ├── _parse_entities()                                          │    │
│  │    │     └── kv_store_entity_chunks.json                          │    │
│  │    │         ├── _infer_group() → 9 基础类别                       │    │
│  │    │         └── nodes[entity_name] = {id, label, weight, group}  │    │
│  │    └── _parse_relations()                                         │    │
│  │          └── kv_store_relation_chunks.json                        │    │
│  │              └── edges[] = {source, target, weight}                │    │
│  │                                                                   │    │
│  │  snapshot() → 记录时间戳快照                                        │    │
│  │  get_delta() → 增量更新（新增节点/边）                               │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 G6GraphView 组件架构

`G6GraphView.tsx` 是整个图谱优化的核心组件，其架构设计遵循以下原则：

**原则一：单 useEffect 管理图实例生命周期**

```
useEffect (依赖: [nodes.length, edges.length, theme])
  │
  ├── 1. 销毁旧图实例 (graphRef.current.destroy())
  ├── 2. 清理 DOM 子节点 (while(c.firstChild) c.removeChild)
  ├── 3. 重新创建 Tooltip DOM 元素 (document.createElement("div"))
  ├── 4. 初始化新图实例 (new Graph({...}))
  ├── 5. 调用 g.render().then(...)
  │     ├── 检查 abort 标志位 → 如果是，销毁图实例
  │     └── 设置 graphRef.current，触发 onReady 回调
  ├── 6. 绑定事件处理器
  │     ├── node:click → 选中/取消 + 回调
  │     ├── canvas:click → 取消所有选中
  │     ├── node:pointerenter → Tooltip 显示
  │     ├── node:pointermove → Tooltip 跟随
  │     └── node:pointerleave → Tooltip 隐藏
  ├── 7. 注册键盘快捷键 (keydown → F/Escape)
  └── 8. 返回 cleanup 函数
        ├── aborted = true (阻止 render 回调)
        ├── 移除键盘监听
        └── 销毁图实例
```

代码实现位于 `G6GraphView.tsx` 第 181-305 行。这是所有 Modern React 最佳实践的集中体现。

**原则二：Abort Guard 模式**

```typescript
let aborted = false;  // 第 186 行

g.render().then(() => {
  if (aborted) { try { g.destroy(); } catch { /* ok */ } return; }  // 第 253 行
  graphRef.current = g;
  // ...
});

return () => {
  aborted = true;  // 第 298 行
  // ...
  try { g.destroy(); } catch { /* ok */ }  // 第 300 行
};
```

此模式解决了 React 18 Strict Mode 下组件被挂载-卸载-挂载时，旧的 `render().then()` 回调在错误时机操作图实例的问题。

**原则三：搜索/筛选与主逻辑解耦**

搜索/筛选通过独立的 `useEffect` 处理（第 308-311 行）：

```typescript
useEffect(() => {
  const g = graphRef.current;
  if (g) applyHL(g, search, filter);
}, [search, filter]);
```

当 `search` 或 `filter` 变化时，不再销毁重建图实例（那会很昂贵），而是在已有图实例上通过 `setElementState()` 更新节点和边的激活/非激活状态。`applyHL()` 的逻辑是：匹配的节点设为 `active`，不匹配的设为 `inactive`；如果某条边两端的节点都是 `active`，则该边也设为 `active`。

### 3.3 GraphPage 布局架构

`GraphPage.tsx`（562 行）采用经典的三栏式管理界面布局：

```
┌───────────────────────────────────────────────────┐
│ Toolbar (工具栏)                                    │
│ ├── Search Box (搜索框, 防抖 300ms)                 │
│ ├── Type Filter (类型下拉筛选)                       │
│ ├── Stats Badge (N 节点 · M 关系)                   │
│ └── Action Buttons (放大/缩小/重置/聚焦/导出/快捷键)   │
├───────────────────────────────┬───────────────────┤
│ Graph Canvas (图谱画布)        │ Right Sidebar      │
│                               │ (右侧面板 240px)    │
│  ┌─────────────────────────┐  │                   │
│  │ G6GraphView             │  │ Legend / Stats     │
│  │ (flex: 1, 自适应高度)     │  │ Tab Switcher      │
│  │                         │  │                   │
│  │  3 种状态:               │  │ ├── 图例面板        │
│  │  ├── Loading (旋转动画)   │  │ │   可点击筛选       │
│  │  ├── Error (重试按钮)     │  │ └── 统计面板        │
│  │  └── Graph (图谱+快捷键)  │  │     分布柱状图      │
│  └─────────────────────────┘  │                   │
│                               │ Node Detail Panel │
│                               │ (选中节点详情面板)   │
│                               │ ├── Header + badge │
│                               │ ├── Description   │
│                               │ ├── Relations     │
│                               │ │   方向指示 + badge│
│                               │ └── Actions       │
│                               │    (聚焦/取消选中)  │
├───────────────────────────────┴───────────────────┤
│ Status Bar (可选)                                   │
└───────────────────────────────────────────────────┘
```

状态管理分工：
- `search`、`filter`、`selNode`、`showPanel`、`showStats` → `useState`（GraphPage 本地状态）
- 图谱数据 `gd` → `trpc.knowledge.getGraph.useQuery()`（React Query 全局缓存）
- 图实例引用 `graphRef` → `useRef<Graph | null>`（不触发重渲染）
- 主题 `theme` → `useTheme()`（ThemeContext 全局状态）

### 3.4 数据流全链路

从后端 LightRAG KV Store 到前端 G6 Canvas 上的彩色圆点，数据流经过 5 个转换层：

**第 1 层：LightRAG KV Store → GraphManager** (src/graph.py)

```
kv_store_entity_chunks.json (JSON 文件)
  │
  ├── for name, info in data.items():
  │     group = _infer_group(info)          ← 关键词匹配分类
  │     nodes[name] = {
  │       "id": name,
  │       "label": name,
  │       "weight": info.get("count", 1),
  │       "group": group,                   ← 如 "disease", "drug" 等
  │     }
  │
  └── kv_store_relation_chunks.json (JSON 文件)
        │
        └── for key, info in data.items():
              parts = key.split("<SEP>", 1)
              edges.push({
                "source": parts[0].strip(),  ← 实体 A
                "target": parts[1].strip(),  ← 实体 B
                "weight": info.get("count", 1),
              })
```

关键映射：`_infer_group` 返回的字符串值（如 `"disease"`）将在前端被用作 `NC` 色板的检索键。这个映射是隐式约定，需要维护一致性。

**第 2 层：GraphManager → FastAPI** (src/api_business.py, 第 373-379 行)

```python
@router.get("/graph")
def graph_data(user: dict | None = Depends(_verify_token_optional)):
    from src.graph import GraphManager
    gm = GraphManager()
    return gm.build()
```

返回的 JSON 响应格式：
```json
{
  "nodes": [
    {"id": "心房颤动", "label": "心房颤动", "weight": 15, "group": "disease", ...}
  ],
  "edges": [
    {"source": "心房颤动", "target": "华法林", "weight": 3, "relationType": "treats"}
  ],
  "stats": {
    "total_nodes": 863,
    "total_edges": 771,
    "total_docs": 42,
    "total_entity_types": 9
  },
  "groups": ["anatomy", "check", "disease", "drug", "guideline", "metric", "other", "symptom", "treatment"],
  "error": null
}
```

**第 3 层：FastAPI → 前端 API Client** (app/src/lib/api.ts)

```typescript
knowledge: {
  getGraph: () => get<{ nodes: any[]; edges: any[]; stats: any }>("/api/graph"),
}
```

`get()` 函数内部调用 `toCamel()` 进行 snake_case → camelCase 转换。例如：`total_nodes` → `totalNodes`、`entity_name` → `entityName`。但关键的 `group` 字段（本身就是 camelCase）保持不变。

**第 4 层：API Client → React Query → GraphPage** (app/src/providers/trpc.tsx)

```typescript
// GraphPage.tsx 第 53 行
const { data: gd, isLoading, error, refetch } = trpc.knowledge.getGraph.useQuery();
```

React Query 自动处理缓存、重新获取、错误重试。Query Key 为 `["knowledge", "getGraph", undefined]`。

**第 5 层：GraphPage → G6GraphView → G6 Canvas** (G6GraphView.tsx)

```typescript
// GraphPage.tsx 第 269-276 行
<G6GraphView
  nodes={rawNodes}     // {id, label, group, weight, description}[]
  edges={rawEdges}     // {source, target, relationType, weight}[]
  search={search}      // 搜索关键词
  filter={filter}      // 类型过滤
  onNodeClick={setSelNode}
  onReady={handleGraphReady}
/>

// G6GraphView.tsx 第 61-106 行 buildData()
nodes: nodes.map(n => {
  const c = nc(n.group || "other");            // ← 查 NC 色板
  const r = 14 + Math.sqrt(w / maxW) * 34;     // ← 计算节点大小
  return {
    id: String(n.id),
    style: {
      fill: dark ? c.df : c.f,                 // ← 根据主题选色
      stroke: dark ? c.ds : c.s,
      size: r * 2,
      labelText: lbl,
      // ...
    }
  };
})
```

### 3.5 主题系统集成

MedRAG 的主题系统由三层协作实现：

**第 1 层：ThemeProvider (React Context)**

`app/src/hooks/useTheme.tsx`（43 行）：
- 初始化时从 `localStorage("medrag-theme")` 读取用户偏好，否则使用 `window.matchMedia("(prefers-color-scheme: dark)")` 检测系统偏好
- 提供 `theme`、`toggleTheme`、`setTheme` 三个值
- 通过 `useEffect` 在每次 `theme` 变化时更新 `document.documentElement.setAttribute("data-theme", theme)`

**第 2 层：CSS 变量系统**

`app/src/index.css`（423 行）：
- `:root` 定义亮色主题的 50+ 个 CSS 变量（background、text、border、shadow、radius 等）
- `[data-theme="dark"]` 覆盖相同的变量集合为暗色值
- 组件中通过 `var(--bg-base)`、`var(--tx-500)` 等引用，实现一键主题切换

**第 3 层：G6GraphView 的 MutationObserver**

`G6GraphView.tsx` 第 137-146 行：

```typescript
useEffect(() => {
  const check = () => setTheme(isDark() ? "dark" : "light");
  const obs = new MutationObserver(check);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia("(prefers-color-scheme:dark)").addEventListener("change", check);
  return () => {
    obs.disconnect();
    window.matchMedia("(prefers-color-scheme:dark)").removeEventListener("change", check);
  };
}, []);
```

当 `data-theme` 属性变化时，`isDark()` 函数（第 54-58 行）重新评估当前主题状态，触发 `setTheme` → 图实例的 `useEffect` 重新执行 → 销毁旧图并创建新图（使用新的暗色/亮色颜色值）。

注意：这意味着主题切换会导致整个图实例销毁重建，代价为 O(N+E) = O(863+771) ≈ O(1600)。在后续优化中可以考虑只更新节点的 style 属性而非重建实例。但当前阶段这个代价在实际使用中（主题切换频率很低）是可接受的。

---

## 4. 任务分解

每个任务必须满足四个特性：**可独立执行**（无外部依赖）、**可量化**（有具体指标）、**可审计**（有验证标准）、**可观测**（有监控点）、**全链路可控**（有回滚方案）。

---

### T1: 节点多类型配色系统（Node Type-Based Color System）

**任务描述**：为 13 类医学实体定义独立的颜色方案，在 d3-force 布局渲染时根据 `group` 字段动态注入颜色。

**依赖关系**：无（独立任务，可首先执行）

**预计工时**：4 小时

#### Subtask 1.1: 定义 13 类别医学色板（含亮色/暗色双主题变体）

**实现位置**：`app/src/components/G6GraphView.tsx` 第 17-32 行

**具体内容**：定义 `NC` 常量（Record<string, {f, s, df, ds}>），每个类型包含 4 个颜色字段：
- `f`（fill）：亮色主题下的节点填充色
- `s`（stroke）：亮色主题下的节点描边色
- `df`（dark fill）：暗色主题下的节点填充色
- `ds`（dark stroke）：暗色主题下的节点描边色

**颜色分配原则**：
1. disease → 红色系（`#E84D4D`/`#C53030`）：警示/危险联想，符合医学习惯
2. drug → 蓝色系（`#3B82F6`/`#2563EB`）：药瓶/处方颜色
3. symptom → 橙色系（`#F07850`/`#D9653A`）：警告色，介于疾病（红）和药物（蓝）之间
4. treatment → 绿色系（`#10B981`/`#059669`）：治疗/安全的正面联想
5. check/exam → 紫色系（`#8B5CF6`/`#7C3AED`）：检查/诊断的科技感
6. clinical_indicator → 靛蓝色系（`#6366F1`/`#4F46E5`）：介于蓝紫之间，强调精确
7. anatomy → 青色系（`#06B6D4`/`#0891B2`）：器官/解剖的中性色
8. procedure → 粉红色系（`#EC4899`/`#DB2777`）：手术的强烈视觉信号
9. gene → 深紫色系（`#7C3AED`/`#6D28D9`）：基因的高科技感
10. pathogen → 深红色系（`#DC2626`/`#B91C1C`）：与 disease 区分但同属暖色系
11. guideline → 金色系（`#D4A853`/`#B8963F`）：权威/指南的黄金色
12. metric → 蓝色系（`#3B82F6`/`#2563EB`）：与 drug 共享但通过其他视觉属性区分
13. other → 灰色系（`#64748B`/`#475569`）：中性、低调

**暗色适配**：暗色主题下所有颜色提亮 10-20%，确保在深色背景（`#080E1A`）上依然清晰可见。例如 disease 的 `f`=#E84D4D → `df`=#FF6B6B。

**验收标准**：
- [ ] `NC` 对象包含 14 个条目（13 类型 + 1 `other` 兜底）
- [ ] 每个条目包含 4 个颜色字段，所有值都是合法的 HEX 颜色码
- [ ] 亮色和暗色变体之间的亮度差异（通过 WCAG 相对亮度公式计算）≥ 0.15

#### Subtask 1.2: 后端 `_infer_group` 到英文 `group` 名称的兼容映射

**实现位置**：`src/graph.py` 第 77-136 行

**具体内容**：检查并扩展 `_infer_group()` 方法的关键词列表，确保新增类型能被正确分类：

- `gene` → 需添加 `['gene','genomic','mutation','allele','polymorphism', 'SNP','variant','基因']` 关键词
- `pathogen` → 需添加 `['pathogen','bacteria','virus','fungi','parasite', 'infection','病原','菌','virus','细菌','真菌']` 关键词
- `clinical_indicator` → 需添加 `['clinical_indicator','biomarker','指标']` 关键词
- `procedure` → 需将现有 `treatment` 分类中的手术关键词拆分到 `procedure`，添加 `['procedure','surgery','手术','术']` 关键词
- `check` → 需与 `exam` 统一处理：`check` 和 `exam` 映射到同一个视觉颜色（紫色系），但保留各自的 `group` 名称

**前端映射（G6GraphView.tsx 第 154-158 行）**：
```typescript
const ntLabels: Record<string, string> = {
  disease: "疾病", drug: "药物", symptom: "症状", treatment: "治疗",
  check: "检查", exam: "检查", clinical_indicator: "指标", anatomy: "解剖",
  procedure: "手术", gene: "基因", pathogen: "病原体", guideline: "指南",
  metric: "指标", other: "其他",
};
```

**验收标准**：
- [ ] `_infer_group()` 能够将测试数据集中的所有新类型实体正确分类
- [ ] `check` 和 `exam` 使用相同的视觉颜色但保留各自的 group 名
- [ ] `ntLabels` 字典包含 14 个条目，所有中文标签准确

#### Subtask 1.3: 在 `buildData()` 中实现逐节点样式计算

**实现位置**：`app/src/components/G6GraphView.tsx` 第 61-105 行

**具体内容**：在 `buildData()` 的 `nodes: nodes.map(...)` 回调中：

1. 调用 `nc(n.group || "other")` 获取当前类型的颜色对象
2. 计算节点大小：`const r = 14 + Math.sqrt(w / maxW) * 34`（半径 14-48px）
3. 构造 G6 节点数据对象，注入：
   - `style.fill` = `dark ? c.df : c.f`
   - `style.stroke` = `dark ? c.ds : c.s`
   - `style.lineWidth` = `dark ? 2 : 2.5`
   - `style.size` = `r * 2`（G6 使用直径而非半径）
4. 标签文字超过 22 字符时截断为 20 字符加省略号

**关键代码段**（第 67-91 行）：
```typescript
const c = nc(n.group || "other");
const r = 14 + Math.sqrt(w / maxW) * 34;
return {
  id: String(n.id),
  data: { label: n.label, group: n.group || "other", weight: w, description: n.description || "" },
  style: {
    size: r * 2,
    fill: dark ? c.df : c.f,
    stroke: dark ? c.ds : c.s,
    // ...
  },
  states: ["active", "inactive", "selected"],
};
```

**验收标准**：
- [ ] 所有节点的 `style.fill` 和 `style.stroke` 基于 `n.group` 动态计算
- [ ] `n.group` 为 `undefined` 或未知值时，回退到 `NC.other` 的颜色
- [ ] 节点大小与 `weight` 正相关（核心节点更大、边缘节点更小）
- [ ] 所有 `id` 通过 `String()` 转换为字符串类型（类型安全）

#### Subtask 1.4: 设置 G6 Graph 级别的节点默认样式

**实现位置**：`app/src/components/G6GraphView.tsx` 第 235-241 行

**具体内容**：在 `new Graph()` 的 `node` 配置中设置三种状态的通用样式：

```typescript
node: {
  type: "circle",
  state: {
    active: { stroke: "#FFD700", lineWidth: 3, labelFontSize: 12, labelFontWeight: 700 },
    inactive: { opacity: dark ? 0.08 : 0.06 },
    selected: { stroke: "#FFD700", lineWidth: 4, labelFontSize: 13, labelFontWeight: 700, labelFill: "#FFD700", shadowColor: "rgba(255,215,0,0.5)", shadowBlur: 16 },
  },
},
```

这三种状态是全局的，所有节点共享。具体节点的 `style`（颜色、大小）与状态样式叠加后形成最终渲染效果。

**验收标准**：
- [ ] `active` 状态的金色描边在所有类型节点上都可辨识
- [ ] `inactive` 状态的透明度（0.06-0.08）在暗色/亮色背景下均不会完全不可见
- [ ] `selected` 状态的发光阴影（shadowBlur: 16）渲染正常，无性能问题

#### Subtask 1.5: 验证所有 9 个实体类型在两种主题下均可区别

**验证方法**：
1. 在开发环境中运行 `npm run dev`
2. 打开管理后台图谱页面（`/admin/graph`）
3. 在亮色主题下截图，检查板中每种颜色是否可区分
4. 切换到暗色主题，重复验证
5. 特别检查相近颜色对：`check`(#8B5CF6) vs `gene`(#7C3AED)、`drug`(#3B82F6) vs `metric`(#3B82F6)、`disease`(#E84D4D) vs `pathogen`(#DC2626)

**验收标准**：
- [ ] 所有 9 个基础实体类型在亮色主题下颜色可区分（通过色彩距离 ΔE ≥ 10）
- [ ] 所有 9 个基础实体类型在暗色主题下颜色可区分
- [ ] `other` 类型（灰色）在两种主题下均不与任何有意义的类型混淆
- [ ] 共享颜色的类型对（如 `drug`/`metric`、`check`/`exam`）在其他视觉属性上可区分（如节点大小、标签文字）

---

### T2: 边关系类型系统（Edge Relation Type System）

**任务描述**：为 9 类医学关系定义独立的颜色编码，在 d3-force 布局渲染时根据 `relationType` 字段动态注入边颜色。

**依赖关系**：无硬依赖，但建议在 T1 完成后执行（共享 `buildData()` 的修改上下文）

**预计工时**：3 小时

#### Subtask 2.1: 定义 9 类关系颜色映射

**实现位置**：`app/src/components/G6GraphView.tsx` 第 35-46 行

**具体内容**：定义 `EC` 常量（Record<string, {l, d}>），每个关系类型包含 2 个颜色字段：
- `l`（light）：亮色主题下的边颜色（rgba 格式，透明度 40%-65%）
- `d`（dark）：暗色主题下的边颜色

**颜色分配原则**：
1. `treats`（治疗）→ 绿色透明（`rgba(16,185,129,0.65)`）：与 treatment 节点颜色呼应
2. `causes`（导致）→ 红色透明（`rgba(220,38,38,0.60)`）：与 disease 节点颜色呼应
3. `associated_with`（相关）→ 蓝色透明（`rgba(59,130,246,0.50)`）：最中性的关联关系
4. `contraindicated`（禁忌）→ 橙色透明（`rgba(240,120,80,0.60)`）：警告色
5. `diagnoses`（诊断）→ 紫色透明（`rgba(139,92,246,0.60)`）：与 check 节点颜色呼应
6. `prevents`（预防）→ 青色透明（`rgba(6,182,212,0.60)`）：与 anatomy 节点颜色呼应
7. `symptom_of`（症状）→ 橙色透明（`rgba(240,120,80,0.50)`）：与 symptom 节点颜色呼应
8. `interacts_with`（相互作用）→ 粉红透明（`rgba(236,72,153,0.60)`）：与 procedure 节点颜色呼应
9. `related_to`（默认关联）→ 灰色透明（`rgba(100,116,139,0.40)`）：最通用的回退

**辅助函数**：`ec(r: string, dark: boolean)`（第 49 行）—— 根据关系类型名和主题返回正确的颜色值。未匹配的类型回退到 `EDGE_DEFAULT`。

**验收标准**：
- [ ] `EC` 对象包含 9 个条目
- [ ] 每个条目的 `l` 和 `d` 值都是合法的 rgba 颜色字符串
- [ ] 所有边的透明度在 40%-65% 范围内（既可见又不喧宾夺主）
- [ ] 未匹配关系类型正确回退到 `EDGE_DEFAULT`

#### Subtask 2.2: 在 `buildData()` 中应用边颜色

**实现位置**：`app/src/components/G6GraphView.tsx` 第 93-105 行

**具体内容**：在 `buildData()` 的 `edges: edges.map(...)` 回调中：

1. 调用 `ec(e.relationType || "", dark)` 获取颜色值
2. 边线宽基于 `weight` 计算：`0.6 + weight * 0.15`（基础 0.6px，每多一个权重加 0.15px）
3. 设置 `endArrow: false`（当前阶段不使用箭头，避免视觉噪音）

```typescript
edges: edges.map((e, i) => ({
  id: String(e.id || `e-${i}`),
  source: String(e.source),
  target: String(e.target),
  data: { relationType: e.relationType || "related_to", weight: e.weight || 1 },
  style: {
    stroke: ec(e.relationType || "", dark),
    lineWidth: 0.6 + (e.weight || 1) * 0.15,
    endArrow: false,
  },
  states: ["active", "inactive"],
})),
```

**验收标准**：
- [ ] 所有边的 `style.stroke` 基于 `relationType` 动态计算
- [ ] 关系类型无数据或为 null/undefined 时，回退到 `EDGE_DEFAULT`
- [ ] 边 id 对于无 id 的边自动生成（格式：`e-{index}`）
- [ ] source 和 target 值通过 `String()` 确保类型一致

#### Subtask 2.3: 实现边状态系统

**实现位置**：`app/src/components/G6GraphView.tsx` 第 243-249 行

**具体内容**：在 `new Graph()` 的 `edge` 配置中设置两种状态的通用样式：

```typescript
edge: {
  type: "line",
  state: {
    active: { stroke: "#FFD700", lineWidth: 2.5 },
    inactive: { opacity: dark ? 0.03 : 0.04 },
  },
},
```

边的 `active` 状态由 `applyHL()` 自动管理：当一条边的两端节点都是 `active` 状态时，该边也设为 `active`；任一端的节点是 `inactive`，则该边设为 `inactive`。这确保了搜索/筛选时未匹配的边会自动淡出。

**验收标准**：
- [ ] 搜索关键词时，匹配节点的关联边高亮为金色
- [ ] 不匹配节点的关联边透明度降为 0.03-0.04（几乎不可见但保留布局结构）
- [ ] 点击类型筛选时，非目标类型的边正确淡出

---

### T3: HTML Tooltip 悬停提示系统

**任务描述**：实现一个基于原生 DOM 的 Tooltip 系统，在用户悬停节点时显示实体预览信息（类型徽章、标签、描述、权重）。

**依赖关系**：无硬依赖

**预计工时**：3 小时

#### Subtask 3.1: 创建 DOM-based Tooltip 元素

**实现位置**：`app/src/components/G6GraphView.tsx` 第 193-196 行

**具体内容**：在 `useEffect` 的主逻辑中，先清理旧的 Tooltip（如果有），然后在图容器内创建一个新的 `<div>` 元素。使用 `position: fixed` 而非 `position: absolute`，确保 Tooltip 不受图容器滚动/缩放影响：

```typescript
const tip = document.createElement("div");
tip.style.cssText = `
  display:none;
  position:fixed;
  z-index:9999;
  pointer-events:none;
  padding:8px 10px;
  border-radius:var(--r-sm,8px);
  background:var(--bg-surface,#fff);
  border:1px solid var(--bd-100,#e2e8f0);
  box-shadow:var(--sh-lg,0 8px 30px rgba(15,43,91,0.08));
  font-size:11px;
  max-width:240px;
`;
c.appendChild(tip);
tooltipRef.current = tip;
```

**设计决策**：选择原生 DOM 而非 React Portal 的原因：
1. G6 图实例不受 React 生命周期管理，G6 的事件回调也不在 React 渲染上下文中
2. 原生 DOM 操作更直接、性能更高（Tooltip 跟随鼠标移动无需经过 React reconciliation）
3. `position: fixed` + `pointer-events: none` 的组合确保 Tooltip 不干扰 G6 的交互事件

**验收标准**：
- [ ] Tooltip 元素在每次图实例创建时重新创建
- [ ] Tooltip 的 `z-index: 9999` 确保在所有 UI 元素之上
- [ ] `pointer-events: none` 确保鼠标事件穿透到 G6 Canvas
- [ ] `max-width: 240px` 防止长文本撑破布局

#### Subtask 3.2: 连接 pointerenter / pointermove / pointerleave 事件

**实现位置**：`app/src/components/G6GraphView.tsx` 第 275-288 行

**具体内容**：在 G6 图实例上注册三个事件处理器：

```typescript
// pointerenter: 显示 Tooltip
g.on("node:pointerenter", (evt: any) => {
  const nd = evt?.target?.id ? g.getNodeData().find((n: any) => n.id === evt.target.id) : null;
  if (nd?.data && evt.clientX) {
    showTooltip(evt.clientX, evt.clientY, nd.data);
  }
});

// pointermove: 跟随鼠标
g.on("node:pointermove", (evt: any) => {
  if (tooltipRef.current?.style.display === "block" && evt.clientX) {
    tooltipRef.current.style.left = `${Math.min(evt.clientX + 16, window.innerWidth - 250)}px`;
    tooltipRef.current.style.top = `${Math.min(Math.max(evt.clientY - 30, 10), window.innerHeight - 100)}px`;
  }
});

// pointerleave: 隐藏 Tooltip
g.on("node:pointerleave", () => hideTooltip());
```

**性能考虑**：`pointermove` 事件每 16ms（60fps）触发一次。处理函数中只进行两次 DOM 样式更新（left + top），且通过 `display === "block"` 的条件提前退出，不更新隐藏状态下的 Tooltip。总耗时 < 0.5ms，不构成性能瓶颈。

**验收标准**：
- [ ] 鼠标进入节点时，Tooltip 在 50ms 内显示（视觉上瞬时）
- [ ] 鼠标在节点上移动时，Tooltip 实时跟随（无明显延迟）
- [ ] 鼠标离开节点时，Tooltip 在 50ms 内隐藏
- [ ] 快速在多个节点间移动时，Tooltip 正确切换内容，无闪烁

#### Subtask 3.3: 渲染实体预览内容（类型徽章 + 标签 + 描述）

**实现位置**：`app/src/components/G6GraphView.tsx` 第 149-173 行 (`showTooltip` 函数)

**具体内容**：使用 `innerHTML` 注入 Tooltip 的 HTML 结构（性能最高，不需要 React reconciliation）：

```
Tooltip 内容层次：
├── 类型徽章行
│   ├── 圆形色块 (width:10px, radius:50%, background: 节点颜色)
│   ├── 中文类型标签 (font-size:9px, 如"疾病"、"药物")
│   └── 权重显示 (可选, 如"权重15")
├── 标签名 (font-weight:700, font-size:13px, 如"心房颤动")
└── 描述文本 (font-size:10px, max-width:200px, 截断至 120 字符)
```

**边界处理**：
- 描述超过 120 字符时截断并添加省略号
- 无描述时隐藏描述行
- 权重 ≤ 0 时隐藏权重显示
- 未知 `group` 值回退到 "其他" 标签
- 标签名为空时显示 "?"

**验收标准**：
- [ ] Tooltip 内的中文类型标签与图例面板一致
- [ ] 颜色色块与节点实际颜色一致
- [ ] 描述文本正确处理长内容、空内容、特殊字符
- [ ] 标签名正确显示（支持中文、英文、中英混合）

#### Subtask 3.4: Tooltip 位置与视口边界钳制

**实现位置**：`app/src/components/G6GraphView.tsx` 第 170-172 行

**具体内容**：使用 `Math.min`/`Math.max` 确保 Tooltip 不超出视口边界：

```typescript
const rect = el.getBoundingClientRect();
const cx = clientX + 16, cy = clientY - rect.height / 2;
el.style.left = `${Math.min(cx, window.innerWidth - rect.width - 10)}px`;
el.style.top = `${Math.min(Math.max(cy, 10), window.innerHeight - rect.height - 10)}px`;
```

- 水平方向：Tooltip 在鼠标右侧 16px 处，但不超过右侧视口边缘 10px
- 垂直方向：Tooltip 垂直居中于鼠标，但不低于 10px 或高于视口底部 10px

**验收标准**：
- [ ] Tooltip 在任何节点上悬停时都不超出视口
- [ ] 在视口边缘的节点悬停时，Tooltip 自动适配位置
- [ ] 在窗口尺寸改变时（如缩放浏览器），Tooltip 仍保持在视口内

---

### T4: GraphPage UI 增强

**任务描述**：增强图谱管理界面的图例面板、统计面板、节点详情面板，提升信息密度和操作效率。

**依赖关系**：T1（节点配色）、T2（边配色）完成后效果更佳，但可独立执行

**预计工时**：4 小时

#### Subtask 4.1: 更新 ntColors 色板以匹配 G6 NC 色板

**实现位置**：`app/src/pages/GraphPage.tsx` 第 24-30 行

**具体内容**：确保 `ntColors` 字典与 `G6GraphView.tsx` 中的 `NC` 色板使用完全相同的颜色值。当前已对齐：
```typescript
const ntColors: Record<string, string> = {
  disease: "#E84D4D", drug: "#3B82F6", symptom: "#F07850",
  treatment: "#10B981", clinical_indicator: "#6366F1", anatomy: "#06B6D4",
  procedure: "#EC4899", gene: "#7C3AED", pathogen: "#DC2626",
  guideline: "#D4A853", other: "#64748B", check: "#8B5CF6",
  exam: "#8B5CF6", metric: "#3B82F6",
};
```

**验收标准**：
- [ ] `ntColors` 的所有 14 个条目与 `NC` 色板的 `f` 值完全一致
- [ ] 图例面板中的色块颜色与图谱中对应类型节点的实际填充色一致
- [ ] 节点详情面板中的类型徽章颜色与图谱一致

#### Subtask 4.2: 添加统计面板（含分布柱状图）

**实现位置**：`app/src/pages/GraphPage.tsx` 第 331-372 行

**具体内容**：当 `showStats === true` 时渲染统计面板，包含：
1. 四宫格指标卡片（节点总数、关系总数、实体类型数、关系类型数）
2. 实体类型分布柱状图（取 Top 8 类型，每行显示：色块 + 中文名 + 百分比进度条 + 百分比数字）

**关键统计计算**（第 73-81 行）：
```typescript
const nodeTypeStats: Record<string, number> = {};
rawNodes.forEach((n: any) => { const g = n.group || n.nodeType; nodeTypeStats[g] = (nodeTypeStats[g] || 0) + 1; });
const edgeTypeStats: Record<string, number> = {};
rawEdges.forEach((e: any) => { const r = e.relationType || "related_to"; edgeTypeStats[r] = (edgeTypeStats[r] || 0) + 1; });
```

**验收标准**：
- [ ] 统计面板从真实数据计算（非 mock 数据）
- [ ] 百分比之和 ≈ 100%（允许 ±1% 的舍入误差）
- [ ] 分布柱状图按数量降序排列
- [ ] 空白状态（0 节点）显示友好的空态提示

#### Subtask 4.3: 添加 图例 / 统计 Tab 切换器

**实现位置**：`app/src/pages/GraphPage.tsx` 第 304-329 行

**具体内容**：两个并排按钮（"图例" 和 "统计"），通过 `showStats` 布尔状态切换显示内容。激活按钮使用 `var(--bg-hover)` 背景色和 `var(--tx-700)` 文字色。

**验收标准**：
- [ ] 点击"图例"按钮时显示图例面板
- [ ] 点击"统计"按钮时显示统计面板
- [ ] 切换动画流畅（通过 CSS transition 实现）
- [ ] 切换不影响图谱的选中状态

#### Subtask 4.4: 增强节点详情面板（关系徽章 + 方向指示器）

**实现位置**：`app/src/pages/GraphPage.tsx` 第 417-558 行

**具体内容**：当 `selNode` 不为 null 时渲染节点详情面板：

1. 标题行：节点标签 + 关闭按钮
2. 类型 + 权重徽章行：节点类型中文标签（带色块） + 关联数 + 关系数
3. 描述文本：`selNode.description`（如有）
4. 关联关系列表（最多 20 条）：
   - 每条关系显示：方向指示器（→ 或 ←） + 关系类型徽章（如"治疗"、"导致"） + 目标节点名称
   - 方向判断：`isSource = String(e.source) === String(selNode.id)`
   - 点击关系条目可跳转到关联节点
   - 超过 20 条时显示 "…还有 N 条关系"
5. 操作按钮：聚焦（调用 `g.focusItem()`）、取消选中

**方向指示器逻辑**：
- `selNode` 是 source → 显示 "→"（主动关系，如"心房颤动 → 治疗 → 华法林"）
- `selNode` 是 target → 显示 "←"（被动关系，如"华法林 ← 治疗 ← 心房颤动"）

**验收标准**：
- [ ] 选中节点时右侧面板正确显示该节点的完整信息
- [ ] 关系列表的方向指示器正确反映 source/target 关系
- [ ] 关系类型徽章颜色与 `rtColors` 色板一致
- [ ] 点击关系条目中的目标节点后，面板切换到目标节点详情
- [ ] 关闭面板后返回空态引导提示

#### Subtask 4.5: 添加聚焦节点按钮

**实现位置**：`app/src/pages/GraphPage.tsx` 第 89-96 行

**具体内容**：当选中节点后，在工具栏显示聚焦按钮（十字准星图标）。点击后调用 `g.focusItem(selNode.id, { duration: 500, easing: "easeCubic" })`。

**验收标准**：
- [ ] 仅当 `selNode` 不为 null 时显示聚焦按钮
- [ ] 聚焦动画在 500ms 内完成
- [ ] 聚焦后目标节点位于视口中心
- [ ] 聚焦后缩放级别适中（不小于 minZoom，不大于 maxZoom）

---

### T5: 交互系统

**任务描述**：实现节点单击选择、画布空白区取消选择、悬停邻居高亮、键盘快捷键、搜索筛选等交互功能。

**依赖关系**：T1、T2 完成后交互效果更好，但可独立执行

**预计工时**：3 小时

#### Subtask 5.1: 节点单击 → 选择 + 详情面板联动

**实现位置**：`app/src/components/G6GraphView.tsx` 第 260-268 行

**具体内容**：
```typescript
g.on("node:click", (evt: any) => {
  const nid = evt?.target?.id;
  if (!nid || !onNodeClick) return;
  const found = nodes.find(n => String(n.id) === nid);
  if (!found) return;
  g.getNodeData().forEach(nd => g.setElementState({ [nd.id]: nd.id === nid ? "selected" : {} }));
  onNodeClick(found);
});
```

先取消所有节点的选中状态，再设置被点击的节点为 `selected`。然后通过 `onNodeClick` 回调将节点数据传递到 GraphPage 的 `setSelNode`。

**验收标准**：
- [ ] 点击节点时该节点变为金色辉光状态
- [ ] 点击另一个节点时，旧节点取消选中，新节点选中
- [ ] 选中节点后，右侧详情面板显示该节点的信息
- [ ] 节点选中态独立于激活态（hover），两个状态可以叠加

#### Subtask 5.2: 画布空白区单击 → 取消所有选中

**实现位置**：`app/src/components/G6GraphView.tsx` 第 271-273 行

**具体内容**：
```typescript
g.on("canvas:click", () => {
  g.getNodeData().forEach(nd => g.setElementState({ [nd.id]: {} }));
});
```

**需要注意的是**：`canvas:click` 不会触发 `node:click`（G6 事件冒泡机制默认不会从节点冒泡到画布），所以不需要担心事件冲突。

**验收标准**：
- [ ] 点击画布空白区域时所有节点取消选中
- [ ] 取消选中后，右侧面板返回空态引导
- [ ] 取消选中后，没有残留的金色辉光

#### Subtask 5.3: 悬停 → 邻居高亮（Degree-1 双向）

**实现位置**：`app/src/components/G6GraphView.tsx` 第 223 行（behaviors 配置）

**具体内容**：使用 G6 v5 内置的 `hover-activate` 行为：
```typescript
{ type: "hover-activate", degree: 1, direction: "both" },
```

这会在鼠标悬停节点时，自动将该节点的 degree-1 邻居（直接连接的所有源节点和目标节点）和它们之间的边设为 `active` 状态，其余节点设为 `inactive` 状态。

**验收标准**：
- [ ] 悬停节点时，该节点及其直接邻居高亮
- [ ] 非邻居节点透明度降低
- [ ] 鼠标离开后恢复正常状态
- [ ] 在有 800+ 节点的图上，邻居高亮的性能可接受（< 100ms 状态切换）

#### Subtask 5.4: 键盘快捷键（F=重置视图, Escape=取消选中）

**实现位置**：`app/src/components/G6GraphView.tsx` 第 290-295 行

**具体内容**：
```typescript
const onKey = (e: KeyboardEvent) => {
  if (e.key === "f" && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    try { g.fitView({ padding: 80 }); } catch { /* ok */ }
  }
  if (e.key === "Escape") {
    g.getNodeData().forEach(nd => g.setElementState({ [nd.id]: {} }));
  }
};
window.addEventListener("keydown", onKey);

return () => {
  // ...
  window.removeEventListener("keydown", onKey);
  // ...
};
```

**关键设计决策**：
- F 键仅在无 Ctrl/Meta 修饰键时响应（避免与浏览器"查找"快捷键冲突）
- Escape 键取消所有节点选中状态（不处理浏览器默认行为，因为 Escape 的默认行为通常是停止加载，不影响图谱操作）
- 监听器绑定在 `window` 上以确保无论焦点在哪里都能响应
- Cleanup 函数中移除监听器，防止内存泄漏

**验收标准**：
- [ ] 按 F 键时图谱重置到完整视口（包含 padding 80px）
- [ ] 按 Escape 键时所有节点取消选中
- [ ] 在输入框中按 F 键（焦点在输入框内）不应触发视图重置
- [ ] 在输入框中按 Escape 键可以同时取消选中和清除输入焦点

#### Subtask 5.5: 搜索 + 类型筛选（带视觉反馈）

**实现位置**：
- `app/src/components/G6GraphView.tsx` 第 108-125 行（`applyHL` 函数）
- `app/src/components/G6GraphView.tsx` 第 308-311 行（Search/Filter useEffect）
- `app/src/pages/GraphPage.tsx` 第 136-175 行（搜索框和筛选下拉框）

**具体内容**：

`applyHL()` 函数接收 `search` 和 `filter` 两个参数：
1. 如果两者都为空，移除所有节点和边的特殊状态
2. 否则，遍历所有节点：
   - 检查标签是否匹配搜索关键词（不区分大小写）
   - 检查 group 是否匹配类型筛选
   - 匹配的设为 `active`，不匹配的设为 `inactive`
3. 遍历所有边：
   - 如果边的 source 和 target 都不是 `inactive`，则该边设为 `active`
   - 否则设为 `inactive`

GraphPage 中的搜索框：
```typescript
<input
  value={search}
  onChange={e => setSearch(e.target.value)}
  placeholder="搜索医学实体…"
/>
{search && <FiX onClick={() => setSearch("")} />}
```

类型筛选下拉框：
```typescript
<select value={filter} onChange={e => setFilter(e.target.value)}>
  <option value="">全部类型</option>
  {sortedNodeTypes.map(([k, v]) => (
    <option key={k} value={k}>{v} ({nodeTypeStats[k] || 0})</option>
  ))}
</select>
```

**验收标准**：
- [ ] 输入搜索关键词时，匹配的节点高亮，不匹配的节点淡出
- [ ] 清除搜索框时，所有节点恢复
- [ ] 选择类型筛选时，匹配类型的节点高亮
- [ ] 搜索 + 筛选组合使用时，只有同时匹配两者的节点才高亮
- [ ] 不匹配的节点的关联边也正确淡出

---

### T6: 健壮性加固（Robustness Hardening）

**任务描述**：加固组件在边缘场景（快速切换、组件卸载、主题变化）下的行为，确保零内存泄漏、零未捕获异常。

**依赖关系**：须在所有功能任务（T1-T5）完成后执行

**预计工时**：3 小时

#### Subtask 6.1: Abort Guard —— 防止销毁中的图实例被回调操作

**实现位置**：`app/src/components/G6GraphView.tsx` 第 186、253、297-303 行

**问题场景**：React 18 Strict Mode 在开发环境中会挂载-卸载-挂载组件。当组件卸载时，之前发起的 `g.render()` 的 Promise 可能尚未完成。如果在 `then()` 回调中操作已被销毁的图实例，会触发 G6 内部错误。

**解决方案**：
```typescript
let aborted = false;

// ...

g.render().then(() => {
  if (aborted) {
    try { g.destroy(); } catch { /* ok */ }
    return;
  }
  graphRef.current = g;
  // ...
});

return () => {
  aborted = true;
  try { g.destroy(); } catch { /* ok */ }
};
```

**验收标准**：
- [ ] React Strict Mode 下挂载-卸载-挂载时无控制台错误
- [ ] 快速切换页面（离开再返回图谱页）时无 G6 内部异常
- [ ] 主题切换（触发图实例重建）时无竞态条件错误

#### Subtask 6.2: Theme Observer 正确清理

**实现位置**：`app/src/components/G6GraphView.tsx` 第 137-146 行

**问题场景**：`MutationObserver` 和 `window.matchMedia` 的事件监听器如果不清理，会在组件卸载后持续触发回调，导致内存泄漏和控制台错误。

**解决方案**：
```typescript
useEffect(() => {
  const check = () => setTheme(isDark() ? "dark" : "light");
  const obs = new MutationObserver(check);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia("(prefers-color-scheme:dark)").addEventListener("change", check);
  return () => {
    obs.disconnect();
    window.matchMedia("(prefers-color-scheme:dark)").removeEventListener("change", check);
  };
}, []);
```

**验收标准**：
- [ ] 使用 Chrome DevTools Memory Profiler 检查：多次挂载-卸载组件后，MutationObserver 数量不增长
- [ ] 组件卸载后，切换系统暗色模式设置不触发任何错误
- [ ] 主题切换 10 次后，内存使用量稳定（不持续增长）

#### Subtask 6.3: Resize Handler 正确绑定和清理

**实现位置**：`app/src/components/G6GraphView.tsx` 第 314-321 行

**问题场景**：`window.resize` 事件监听器未移除会导致组件卸载后仍然尝试调用 `g.setSize()`。

**解决方案**：
```typescript
useEffect(() => {
  const r = () => {
    const g = graphRef.current, c = containerRef.current;
    if (g && c) g.setSize(c.clientWidth, c.clientHeight);
  };
  window.addEventListener("resize", r);
  return () => window.removeEventListener("resize", r);
}, []);
```

**验收标准**：
- [ ] 调整浏览器窗口大小时，图 Canvas 尺寸实时更新
- [ ] 组件卸载后，调整窗口大小不触发错误
- [ ] 使用 Chrome DevTools 的 Performance Monitor 检查：resize 操作不产生明显的 JS 堆增长

#### Subtask 6.4: ErrorBoundary 兜底保护

**实现位置**：`app/src/components/ErrorBoundary.tsx`（82 行）

**具体内容**：使用 React Class Component Error Boundary 包裹图谱页面。当 G6GraphView 或 GraphPage 中发生未捕获的渲染异常时，ErrorBoundary 拦截错误并显示友好的回退 UI（MedRAG Logo + 错误信息 + 刷新按钮）。

```typescript
// 使用方式（在 App.tsx 或其他路由配置中）
<ErrorBoundary>
  <GraphPage />
</ErrorBoundary>
```

**验收标准**：
- [ ] 手动在 G6GraphView 中抛出一个渲染异常，ErrorBoundary 捕获并显示回退 UI
- [ ] 回退 UI 显示具体的错误消息
- [ ] "刷新页面"按钮可正常刷新
- [ ] 全局控制台不出现未捕获的 Promise rejection

---

## 5. TDD 测试计划

本专项的测试策略遵循 TDD（Test-Driven Development）原则：先编写失败测试 → 实现功能 → 测试通过 → 重构。测试用例共计 **110 个**，分为 6 大类别。

### 5.1 视觉渲染测试（25 个）

| 编号 | 测试用例 | 预期结果 | 验证方法 |
|------|---------|---------|---------|
| V-01 | disease 类型节点在亮色主题下的填充色 | `#E84D4D` | `buildData()` 单元测试 |
| V-02 | disease 类型节点在暗色主题下的填充色 | `#FF6B6B` | `buildData()` 单元测试 |
| V-03 | drug 类型节点在亮色主题下的填充色 | `#3B82F6` | `buildData()` 单元测试 |
| V-04 | symptom 类型节点在亮色主题下的填充色 | `#F07850` | `buildData()` 单元测试 |
| V-05 | treatment 类型节点在亮色主题下的填充色 | `#10B981` | `buildData()` 单元测试 |
| V-06 | anatomy 类型节点在亮色主题下的填充色 | `#06B6D4` | `buildData()` 单元测试 |
| V-07 | procedure 类型节点在亮色主题下的填充色 | `#EC4899` | `buildData()` 单元测试 |
| V-08 | gene 类型节点在亮色主题下的填充色 | `#7C3AED` | `buildData()` 单元测试 |
| V-09 | pathogen 类型节点在亮色主题下的填充色 | `#DC2626` | `buildData()` 单元测试 |
| V-10 | other 类型节点（group=null 时的回退） | `#64748B` | `buildData()` 单元测试 |
| V-11 | metric 类型节点（与 drug 同色）填充色 | `#3B82F6` | `buildData()` 单元测试 |
| V-12 | 节点 weight=1 (最小值) 时的半径计算 | 14px | 公式验证 |
| V-13 | 节点 weight=maxWeight (最大值) 时的半径计算 | 48px | 公式验证 |
| V-14 | 节点标签超过 22 字符时截断 | 截断至 20 字符 + "…" | 字符串函数测试 |
| V-15 | 节点标签少于 22 字符时不截断 | 完整标签保留 | 字符串函数测试 |
| V-16 | treats 关系在亮色主题下的边颜色 | `rgba(16,185,129,0.65)` | `buildData()` 单元测试 |
| V-17 | causes 关系在亮色主题下的边颜色 | `rgba(220,38,38,0.60)` | `buildData()` 单元测试 |
| V-18 | 未知关系类型回退到默认边颜色 | `rgba(100,116,139,0.35)` | `buildData()` 单元测试 |
| V-19 | 边 weight 为 1 时的线宽 | 0.75px | 线宽公式验证 |
| V-20 | 边 weight 为 10 时的线宽 | 2.1px | 线宽公式验证 |
| V-21 | 暗色主题下节点描边宽度 | 2px | `buildData()` 单元测试 |
| V-22 | 亮色主题下节点描边宽度 | 2.5px | `buildData()` 单元测试 |
| V-23 | 标签颜色在暗色主题下 | `#e2e8f0` | `buildData()` 单元测试 |
| V-24 | 标签颜色在亮色主题下 | `#1e293b` | `buildData()` 单元测试 |
| V-25 | 节点 `data` 字段完整性（label/group/weight/description） | 四个字段全部存在 | `buildData()` 单元测试 |

### 5.2 交互测试（20 个）

| 编号 | 测试用例 | 预期结果 | 验证方法 |
|------|---------|---------|---------|
| I-01 | 单击节点 → 节点进入 selected 状态 | 金色辉光描边 | 浏览器截图对比 |
| I-02 | 单击第二个节点 → 第一个节点取消选中 | 旧节点金色辉光消失 | 浏览器截图对比 |
| I-03 | 单击画布空白区 → 所有节点取消选中 | 所有节点 normal 状态 | 浏览器截图对比 |
| I-04 | 悬停节点 → 邻居节点高亮 | 邻居为 active，其他为 inactive | 浏览器截图对比 |
| I-05 | 鼠标离开 → 所有节点恢复正常 | 无 active/inactive | 浏览器截图对比 |
| I-06 | 搜索"心房" → 匹配节点高亮 | 所有含"心房"的节点为 active | 浏览器截图对比 |
| I-07 | 清除搜索框 → 所有节点恢复 | 无 active/inactive | 验证 applyHL("", "") |
| I-08 | 选择类型筛选"疾病" → 疾病节点高亮 | 仅 disease 组节点为 active | 浏览器截图对比 |
| I-09 | 同时搜索 + 筛选 → 只有满足两条件的节点高亮 | 交集规则 | 浏览器截图对比 |
| I-10 | 按 F 键 → 图谱 fitView | 所有节点在视口内 | 验证 fitView 调用 |
| I-11 | 按 Escape 键 → 所有节点取消选中 | 无 selected 状态 | 浏览器截图对比 |
| I-12 | 滚轮缩放 → 缩放级别变化 | zoom 值改变 | 验证 zoomTo 调用 |
| I-13 | 拖拽画布 → 画布平移 | 视口位置改变 | 浏览器截图对比 |
| I-14 | 拖拽节点 → 节点位置改变 | 节点坐标变化 | 浏览器截图对比 |
| I-15 | 点击放大按钮 → 缩放级别增加 35% | zoom * 1.35 | 单元测试 |
| I-16 | 点击缩小按钮 → 缩放级别减少 25% | zoom / 1.35 | 单元测试 |
| I-17 | 点击导出 PNG → 下载文件 | 文件下载触发 | 单元测试（mock） |
| I-18 | 点击图例中的"疾病" → filter 设为 disease | 类型筛选激活 | React state 测试 |
| I-19 | 再次点击图例中的"疾病" → filter 清除 | 类型筛选取消 | React state 测试 |
| I-20 | 点击节点详情中关联关系条目 → 切换到该节点 | selNode 更新 | React state 测试 |

### 5.3 数据流测试（15 个）

| 编号 | 测试用例 | 预期结果 | 验证方法 |
|------|---------|---------|---------|
| D-01 | GET /api/graph 返回 200 | 状态码 200 | FastAPI TestClient |
| D-02 | 响应包含 nodes, edges, stats, groups, error 字段 | 5 个顶层键 | JSON schema 验证 |
| D-03 | nodes 数组中每个条目包含 id, label, weight, group | 4 个字段 | JSON schema 验证 |
| D-04 | edges 数组中每个条目包含 source, target, weight | 3 个字段 | JSON schema 验证 |
| D-05 | stats.total_nodes 与 nodes 数组长度一致 | 数值相等 | 断言比较 |
| D-06 | stats.total_edges 与 edges 数组长度一致 | 数值相等 | 断言比较 |
| D-07 | GraphManager._infer_group("心力衰竭") 返回 "disease" | 分类正确 | 单元测试 |
| D-08 | GraphManager._infer_group("阿司匹林") 返回 "drug" | 分类正确 | 单元测试 |
| D-09 | GraphManager._infer_group("冠状动脉搭桥术") 返回 "treatment" | 分类正确 | 单元测试 |
| D-10 | API 返回的 snake_case 字段名被 toCamel() 转换 | camelCase 格式 | api.ts 单元测试 |
| D-11 | trpc.knowledge.getGraph.useQuery() 触发 GET 请求 | GET /api/graph | 网络监控 |
| D-12 | GraphPage 接收到的 rawNodes 数量 ≥ 1 | nodes.length > 0 | React state 测试 |
| D-13 | nodeTypeStats 统计与 rawNodes 一致 | 计数正确 | 单元测试 |
| D-14 | edgeTypeStats 统计与 rawEdges 一致 | 计数正确 | 单元测试 |
| D-15 | sortedNodeTypes 按数量降序排列 | 排序正确 | 单元测试 |

### 5.4 状态管理测试（15 个）

| 编号 | 测试用例 | 预期结果 | 验证方法 |
|------|---------|---------|---------|
| S-01 | 数据加载中：显示 Loading 旋转动画 | 旋转 CSS 动画可见 | 浏览器截图 |
| S-02 | 数据加载中：显示"正在加载知识图谱…"文字 | 文字存在 | DOM 查询 |
| S-03 | 数据加载失败：显示错误图标和提示 | 错误状态 UI | 浏览器截图 |
| S-04 | 数据加载失败：显示"重试"按钮 | 按钮存在且可点击 | DOM 查询 |
| S-05 | 数据加载失败：点击重试 → refetch() 调用 | 触发重新请求 | 函数调用验证 |
| S-06 | 数据为空（0 节点）：显示空态引导 | "暂无知识图谱数据" | DOM 查询 |
| S-07 | 搜索无匹配结果：所有节点变 inactive | 全部 opacity=0.06 | 状态验证 |
| S-08 | 搜索无匹配结果：搜索框保持显示文字 | 输入不清空 | DOM 查询 |
| S-09 | 清除筛选后：所有节点恢复正常 | 无 inactive 状态 | 状态验证 |
| S-10 | 选中节点后切换 Tab（图例→统计）：选中状态保持 | selNode 不变 | React state 测试 |
| S-11 | 收起快捷键面板 → 面板消失 | setShowPanel(false) | React state 测试 |
| S-12 | 展开快捷键面板 → 面板显示 | setShowPanel(true) | React state 测试 |
| S-13 | 窗口大小改变 → 图 Canvas 尺寸更新 | setSize() 调用 | resize 事件验证 |
| S-14 | 组件卸载 → React Query 缓存保留 | 重新进入页面无 loading | 缓存验证 |
| S-15 | 主题切换 → Loading/Error/Empty 状态 UI 适配暗色 | UI 颜色更新 | 浏览器截图对比 |

### 5.5 主题切换测试（15 个）

| 编号 | 测试用例 | 预期结果 | 验证方法 |
|------|---------|---------|---------|
| Th-01 | ThemeProvider 初始化读取 localStorage | 读取 medrag-theme key | 单元测试 |
| Th-02 | ThemeProvider 回退到系统偏好 | matchMedia 调用 | 单元测试 |
| Th-03 | toggleTheme() 在 light↔dark 间切换 | 状态翻转 | 单元测试 |
| Th-04 | 主题切换 → document.documentElement 的 data-theme 更新 | 属性值变化 | DOM 查询 |
| Th-05 | 主题切换 → G6 图实例销毁重建 | 新图实例创建 | graphRef 变化 |
| Th-06 | 暗色主题下节点填充色使用 df/ds 字段 | df/ds 值生效 | buildData() 单元测试 |
| Th-07 | 暗色主题下边颜色使用 EC[...].d 字段 | d 值生效 | buildData() 单元测试 |
| Th-08 | 暗色主题下图 Canvas 背景透明 | `background: "transparent"` | Graph 配置验证 |
| Th-09 | MutationObserver 检测到 data-theme 属性变化 | setTheme 被调用 | 监听器触发 |
| Th-10 | 系统暗色模式变化 → G6 图实例响应 | matchMedia listener 触发 | 事件监听验证 |
| Th-11 | 主题切换时已应用的搜索/筛选状态重置 | 新图实例应用最新 search/filter | 状态验证 |
| Th-12 | 主题切换 3 次 → MutationObserver 数量 ≤ 1 | 仅 1 个活跃 observer | Memory Profiler |
| Th-13 | 主题切换 → Tooltip DOM 元素使用新的 CSS 变量 | 颜色跟随主题 | 浏览器截图 |
| Th-14 | 主题切换 → 图例/统计面板颜色响应 | 面板颜色更新 | 浏览器截图 |
| Th-15 | 主题切换 → Minimap 配色更新 | minimap 背景/边框色变化 | 浏览器截图 |

### 5.6 健壮性测试（10 个）

| 编号 | 测试用例 | 预期结果 | 验证方法 |
|------|---------|---------|---------|
| R-01 | 快速挂载-卸载-挂载 G6GraphView（React Strict Mode） | 无控制台错误 | React DevTools |
| R-02 | 组件卸载后 render().then() 回调不应操作图实例 | aborted=true 时 return | 代码逻辑验证 |
| R-03 | 图实例 destroy() 调用两次（异常恢复） | 第二次不抛异常（try/catch） | 异常处理验证 |
| R-04 | Theme Observer 断开后不触发回调 | 无状态更新 | 单元测试 |
| R-05 | Resize Listener 移除后 resize 不触发 setSize | 无操作 | 单元测试 |
| R-06 | applyHL() 在无图实例时调用 | try/catch 静默处理 | 异常处理验证 |
| R-07 | G6GraphView 传入空 nodes 数组 → 不创建图实例 | !nodes.length 时 return | 代码逻辑验证 |
| R-08 | G6GraphView 传入 null container → 不创建图实例 | !c 时 return | 代码逻辑验证 |
| R-09 | 同时触发 10 次 search 状态变更 → 最后一次生效 | applyHL 幂等 | React batch 行为 |
| R-10 | 图谱页面包含在 ErrorBoundary 中 → 异常被捕获 | 显示回退 UI | 错误注入测试 |

---

## 6. 验证与审计

### 6.1 部署前检查清单

| 序号 | 检查项 | 验收标准 | 负责人 | 状态 |
|------|--------|---------|--------|------|
| C-01 | 所有任务（T1-T6）的全部 Subtask 验收标准通过 | 32 项 Subtask 达标 | 开发 | ☐ |
| C-02 | 亮色主题下 13 种类型节点的颜色可区分 | 目视检查 + 色彩距离测试 | QA | ☐ |
| C-03 | 暗色主题下 13 种类型节点的颜色可区分 | 目视检查 + 色彩距离测试 | QA | ☐ |
| C-04 | 搜索 / 筛选功能可正常工作 | 功能测试 + 边界测试 | QA | ☐ |
| C-05 | 节点单击选择 / 画布取消选择 | 功能测试 | QA | ☐ |
| C-06 | Tooltip 悬停内容正确且不超出视口 | 视口边缘节点测试 | QA | ☐ |
| C-07 | 键盘快捷键（F / Escape）响应正常 | 功能测试 + 焦点测试 | QA | ☐ |
| C-08 | 导出 PNG 功能正常 | 文件下载成功且尺寸正确 | QA | ☐ |
| C-09 | 3 种 UI 状态（Loading / Error / Empty）正常显示 | 状态模拟测试 | QA | ☐ |
| C-10 | 主题切换不出现 React 渲染警告 | 控制台 0 警告 | 开发 | ☐ |
| C-11 | 组件卸载后无内存泄漏 | Chrome Memory Profiler | 开发 | ☐ |
| C-12 | 代码通过 ESLint 检查 | 0 个 Error / Warning | 开发 | ☐ |
| C-13 | 代码通过 TypeScript 类型检查 | 0 个 Type Error | 开发 | ☐ |
| C-14 | 所有 110 个测试用例通过 | 绿色 100% | CI | ☐ |
| C-15 | Git diff 审查确认无意外修改 | PR review | 开发 | ☐ |

### 6.2 部署后验证步骤

1. **冒烟测试**：打开 `/admin/graph` 页面，确认图谱加载成功（Loading → Graph 状态转换正常）
2. **视觉检查**：滚动图例面板，确认所有有数据的实体类型都显示了正确颜色
3. **交互检查**：悬停任意节点 → 确认 Tooltip 显示 → 单击节点 → 确认右侧详情面板更新
4. **搜索检查**：输入已知实体名称 → 确认高亮 → 清除搜索 → 确认恢复
5. **筛选检查**：选择类型筛选 → 确认高亮 → 清除筛选 → 确认恢复
6. **主题检查**：切换暗色/亮色主题各一次 → 确认图谱正确重新渲染
7. **导出检查**：点击导出 PNG → 确认下载文件 → 打开 PNG 检查内容
8. **控制台检查**：F12 打开 DevTools → 确认 Console 标签页无红色错误

### 6.3 性能指标基线

| 指标 | 目标值 | 测量方法 | 当前值 |
|------|--------|---------|--------|
| 图谱首次加载时间（FCP） | ≤ 1.5s | Chrome Performance API / Lighthouse | 待测量 |
| 布局稳定时间（含力模拟） | ≤ 3s | G6 render().then() 回调时间戳 | 待测量 |
| 搜索过滤响应时间 | ≤ 50ms | applyHL() 函数执行时间 | 待测量 |
| Tooltip 显示延迟 | ≤ 50ms | pointerenter → style.display="block" 时间 | 待测量 |
| 主题切换重建时间 | ≤ 1.5s | useEffect 触发 → render().then() 时间 | 待测量 |
| PNG 导出时间（863 节点） | ≤ 3s | toDataURL() Promise 解析时间 | 待测量 |
| 内存占用（图实例 + 数据） | ≤ 80MB | Chrome Task Manager Memory Footprint | 待测量 |
| 缩放操作帧率 | ≥ 30fps | Chrome Performance Monitor | 待测量 |

### 6.4 回归测试套件

回归测试套件应包含以下场景：

1. **核心路径回归**：图谱加载 → 节点悬停 → 节点单击 → 右侧面板 → 点击关联节点 → 返回
2. **搜索路径回归**：输入搜索 → 高亮确认 → 清除搜索 → 切换类型筛选 → 组合筛选 → 清除
3. **主题路径回归**：亮色 → 暗色 → 亮色 → 暗色，每步确认图谱渲染正确
4. **导出路径回归**：图谱加载 → 导出 PNG → 确认文件 → 再次导出（确认上次不缓存）
5. **边界路径回归**：空图谱（0 节点）→ 单节点图谱 → 1000+ 节点的压力测试图谱

每次有任何代码变更（包括色板修改、事件绑定改动、状态管理逻辑调整），必须运行完整的回归测试套件。

---

## 7. 风险管理

### 7.1 风险识别矩阵

| 风险编号 | 风险描述 | 概率 | 影响 | 风险等级 | 缓解措施 |
|---------|---------|------|------|---------|---------|
| R-01 | G6 v5 d3-force 布局在 800+ 节点上性能不足 | 中 | 高 | 高 | 限制初始显示节点数（Top 200 by weight），提供"展开全部"选项 |
| R-02 | 后端 `_infer_group` 分类覆盖不全 → 大量节点归为"other" | 中 | 中 | 中 | 持续丰富关键词列表，添加分类覆盖率监控（当 other 占比 > 30% 时告警） |
| R-03 | 13 种颜色中有 2 种在暗色主题下难以区分 | 低 | 低 | 低 | 增加色彩距离检查（ΔE ≥ 10），不满意的颜色对调整色调 |
| R-04 | Tooltip 在触摸设备上不适用（无 hover 事件） | 低 | 低 | 低 | 移动端回退到长按触发 Tooltip（未来迭代） |
| R-05 | 后端 API 返回数据格式变更 → 前端映射失效 | 低 | 高 | 中 | 在 API Client 层加强字段校验（Zod / JSON Schema），变更时前端不崩溃而是 fallback |
| R-06 | G6 库版本升级引入 breaking change | 低 | 高 | 中 | 锁定 G6 版本号（`@antv/g6: "^5.x"`），升级前在本地验证 |
| R-07 | 图谱数据量增长 → 首次加载超过 3s | 中 | 中 | 中 | 实现分页加载 / 虚拟化渲染（后续迭代），添加加载进度指示器 |
| R-08 | 浏览器兼容性问题（Safari / Firefox 上的渲染差异） | 低 | 中 | 中 | 在 3 大浏览器上测试（Chrome, Firefox, Safari），使用 Polyfill.io |

### 7.2 回滚方案

本专项的所有变更都是**增量式**的 —— 新功能通过添加新的色板、新的事件处理器、新的 UI 组件实现，不删除现有的基础功能。因此回滚的方法不是"撤销代码"而是"退化到基础模式"：

**方案 A：色板回滚**
如果 13 种类型的多色方案在评审中不被认可，可以通过以下步骤回滚到单色模式：
1. 修改 `NC` 常量为 `const NC = { other: { f: "#5C4033", s: "#3E2723", ... } };`
2. 修改 `buildData()` 中 `nc(n.group || "other")` → 始终返回 `NC.other`
3. 提交并部署

**方案 B：Tooltip 回滚**
如果 Tooltip 在某些环境下有性能问题，可通过注释以下行禁用：
1. 注释 `G6GraphView.tsx` 第 275-288 行的 `pointerenter`/`pointermove`/`pointerleave` 事件绑定
2. Tooltip DOM 元素仍然创建但不显示（对性能无影响）

**方案 C：完整回滚**
如果所有变更都需要回滚：
```bash
git revert <last-commit-before-harness>..HEAD
git push
```

### 7.3 监控告警

**前端监控指标**（通过浏览器的 Performance API + 自定义事件上报）：

| 指标 | 告警阈值 | 告警级别 |
|------|---------|---------|
| 图谱加载时间 > 5s | FCP > 5000ms | P1 |
| 图谱渲染失败率 > 5% | ErrorBoundary 触发次数/view > 0.05 | P0 |
| API /api/graph 5xx 错误率 > 1% | 500 返回次数/总请求 > 0.01 | P0 |
| 搜索过滤响应 > 500ms | applyHL 执行时间 > 500ms | P2 |
| 主题切换重建失败 | G6 render reject 事件 | P1 |

---

## 8. 经验总结

### 8.1 有效的做法

**1. 单 useEffect 管理图实例生命周期是正确选择。**

在初版设计中，曾考虑将 G6 图实例的初始化、事件绑定、清理分散在多个 useEffect 中。但实践证明，G6 图实例是一个高度耦合的复合对象（画布、数据、行为、插件、事件），分散管理会导致：
- 初始化顺序不确定（哪个 useEffect 先执行？）
- 清理函数互相依赖（必须先解绑事件再销毁图实例）
- 状态同步复杂（search/filter/resize 的变更如何传递给已存在的图实例？）

最终采用的单 useEffect 架构（`G6GraphView.tsx` 第 181-305 行）将所有图生命周期管理集中在一个地方，依赖数组 `[nodes.length, edges.length, theme]` 精确控制了重建时机。search/filter 的更新通过独立的 useEffect + `applyHL()` 与图实例交互，避免了不必要的图实例重建。

**2. 原生 DOM Tooltip 优于 React Portal。**

初版曾尝试使用 React Portal + 受控组件实现 Tooltip，但遇到以下问题：
- G6 的鼠标事件不在 React 渲染上下文中，需要使用 `flushSync` 或 `unstable_batchedUpdates` 来同步状态
- React 的 reconciliation 过程（即使是空的）在 60fps 下产生可观察的滞后
- Portal 的 z-index 需要小心管理，避免与 AntV 的内置 UI 层（如 Minimap）冲突

最终采用的原生 DOM 方案（`document.createElement("div")` + `innerHTML` + `position:fixed`）虽然在 React 架构中看似不协调，但在性能和可靠性上完胜 React Portal 方案。

**3. Abort Guard 是 React 18 Strict Mode 下的必备模式。**

React 18 的 Strict Mode 在开发环境中会对每个组件进行"挂载-卸载-挂载"的压力测试。这意味着 `G6GraphView` 的 useEffect 会在短时间内执行两次（第一次的 cleanup 在第二次 setup 之前调用）。如果没有 `aborted` 标志位，第一次的 `g.render().then()` 回调会在图实例已被销毁后尝试操作，导致 G6 内部异常。

**4. 色板的分离设计（NC + EC）为后续扩展预留了空间。**

将节点颜色和边颜色分别定义在独立的常量对象中，使得修改颜色、添加新类型、切换配色方案等操作都是单点修改。例如，未来如果要引入"色盲友好模式"配色方案，只需替换 `NC` 和 `EC` 的内容，无需修改任何业务逻辑代码。

**5. GraphPage 中的 `rtColors` 和 `rtLabels` 映射提供了完整的关系语义。**

虽然在 `G6GraphView.tsx` 中已经有了边颜色映射 `EC`，但在 `GraphPage.tsx` 中额外定义了关系类型的颜色（`rtColors`）和中文标签（`rtLabels`），确保了图例面板和节点详情面板中的关系展示与图谱中的边颜色保持语义一致。

### 8.2 需要改进的方面

**1. 主题切换的重建代价过高。**

当前主题切换时，`G6GraphView` 的 useEffect（依赖 `theme`）会完全销毁旧图实例并创建新图实例，代价为 O(N+E)。理想的实现应该是：在主题切换时，仅遍历所有节点和边，更新其 `style` 属性，而不触发 d3-force 布局的重新计算。这需要 G6 v5 支持图实例创建后的动态样式更新 API（`g.updateData()` 或 `g.setElementState()`），但考虑到主题切换在实际使用中频率极低（通常用户一经设置便不再更改），当前实现的代价是可接受的。

**2. applyHL() 函数在节点数量增长到 5000+ 时可能成为瓶颈。**

当前 `applyHL()` 使用 `g.getNodeData().forEach()` 遍历所有节点并逐一调用 `g.setElementState()`。对于 863 个节点，这种遍历的性能可接受（< 10ms）。但如果数据量增长到 5000+，需要将其重构为批量操作或使用 Web Worker 进行字符串匹配。

**3. 触摸设备的交互支持不足。**

当前所有交互设计都基于桌面端（鼠标悬停、键盘快捷键）。在平板设备上（如评委使用 iPad 查看图谱），悬停事件变为长按事件、键盘快捷键不可用、缩放手势需要适配。这是一个已知的技术债务项，应在专项的后续迭代中解决。

**4. `other` 类型占比的持续监控缺失。**

虽然 `_infer_group()` 的分类逻辑在专项启动时已覆盖了大部分节点（other 占比估计 < 15%），但随着新文献的上传，可能会出现大量无法分类的新实体（如新的疾病名称、新的药物名称、新的生物标志物）。如果没有监控，`other` 的占比可能悄悄涨到 30%-40%，导致图谱再次"花里胡哨但大多数是灰色"。

### 8.3 已引入的技术债务

| 编号 | 技术债务 | 优先级 | 预计清理时间 |
|------|---------|--------|------------|
| TD-01 | 主题切换时全量重建图实例 | P2 | 后续迭代 |
| TD-02 | applyHL() 每字符输入都触发全量遍历 | P3 | 后续迭代（加防抖） |
| TD-03 | Tooltip 使用 innerHTML（XSS 风险） | P2 | 后续迭代（改用 textContent + DOM API） |
| TD-04 | 触摸设备无长按 Tooltip 支持 | P3 | 后续迭代 |
| TD-05 | 共享颜色的类型对（drug/metric、check/exam）仅靠文字区分 | P3 | 后续迭代（增加节点形状或图标） |
| TD-06 | 图谱搜索无服务端搜索支持（全量加载到前端遍历） | P1 | 数据量增大时实施 |

### 8.4 未来优化路线图

**Phase 1（短期 — 1-2 周）**：
- 实现搜索防抖（debounce 200ms），减少 applyHL 调用频率
- 添加 `other` 类型占比的告警机制（在 `/api/graph/stats` 中加入 `other_ratio` 字段）
- Tooltip 改用 `textContent` + DOM API 替代 `innerHTML`

**Phase 2（中期 — 1 个月）**：
- 实现节点形状差异化（圆形=疾病、菱形=药物、三角形=症状 等）
- 添加服务端搜索 API（避免 5000+ 节点时前端内存压力）
- 实现分页加载 / 虚拟化渲染（Top 200 by weight + "展开全部"）
- 适配触摸设备（长按 Tooltip + 手势缩放）

**Phase 3（长期 — 3 个月）**：
- 引入 G6 的 WebGL 渲染器（`@antv/g6-webgl`）以支持 10000+ 节点
- 实现图谱时间轴（展示实体的创建时间演进）
- 图谱交互式过滤面板（通过选择器组合多个筛选条件）
- 3D 知识图谱（使用 Three.js + G6 联动）

---

## 附录 A：核心文件清单

| 文件路径 | 行数 | 核心职责 | 关键变更 |
|---------|------|---------|---------|
| `app/src/components/G6GraphView.tsx` | 325 | 图谱渲染核心组件：色板定义、数据转换、Tooltip 管理、事件绑定、生命周期管理 | 新增 `NC`、`EC` 色板；新增 `showTooltip`/`hideTooltip`/`applyHL`；添加 Abort Guard |
| `app/src/pages/GraphPage.tsx` | 562 | 图谱管理页面：工具栏、图例、统计、节点详情、搜索/筛选 | 新增 `ntColors`、`rtColors`、`rtLabels`；新增统计面板、图例/统计切换器；增强节点详情面板 |
| `src/graph.py` | 191 | GraphManager：KV Store 解析、实体分类、增量更新 | `_infer_group()` 扩展关键词列表（新增 gene/pathogen/clinical_indicator/procedure 类型） |
| `src/api_business.py` | 405 | 业务 REST API：图谱数据、搜索、统计端点 | 通过 `/api/graph` 暴露 GraphManager 构建的完整图谱数据 |
| `app/src/lib/api.ts` | 209 | 前端 API Client：REST 调用封装、snake_case→camelCase 转换 | 新增 `api.knowledge.getGraph()` / `api.knowledge.stats()` / `api.knowledge.searchNodes()` |
| `app/src/providers/trpc.tsx` | 153 | React Query 适配层：Query Hooks、Cache Invalidation | 新增 `knowledge` 模块的 Query/Mutation hooks |
| `app/src/hooks/useTheme.tsx` | 43 | 主题管理：localStorage 持久化、系统偏好检测、Context 提供 | `data-theme` 属性 + `MutationObserver` 检测 |
| `app/src/index.css` | 423 | 设计系统：CSS 变量、主题定义、全局样式 | 暗色主题变量覆盖、Medical Blue-tinted 阴影系统 |
| `app/src/components/ErrorBoundary.tsx` | 82 | React 错误兜底：拦截渲染异常、显示回退 UI | 图谱页面级 Error Boundary 包裹 |

## 附录 B：NC 色板完整对照表

| 实体类型 | 中文标签 | 亮色填充 (f) | 亮色描边 (s) | 暗色填充 (df) | 暗色描边 (ds) | 色觉含义 |
|---------|---------|-------------|-------------|-------------|-------------|---------|
| disease | 疾病 | #E84D4D | #C53030 | #FF6B6B | #E84D4D | 红色：警示/危险 |
| drug | 药物 | #3B82F6 | #2563EB | #60A5FA | #3B82F6 | 蓝色：治疗/处方 |
| symptom | 症状 | #F07850 | #D9653A | #FF9A76 | #F07850 | 橙色：警告/注意 |
| treatment | 治疗 | #10B981 | #059669 | #34D399 | #10B981 | 绿色：安全/治愈 |
| check | 检查 | #8B5CF6 | #7C3AED | #A78BFA | #8B5CF6 | 紫色：诊断/科技 |
| exam | 检查 | #8B5CF6 | #7C3AED | #A78BFA | #8B5CF6 | 紫色：诊断/科技 |
| clinical_indicator | 指标 | #6366F1 | #4F46E5 | #818CF8 | #6366F1 | 靛蓝：精确/数据 |
| anatomy | 解剖 | #06B6D4 | #0891B2 | #22D3EE | #06B6D4 | 青色：器官/中性 |
| procedure | 手术 | #EC4899 | #DB2777 | #F472B6 | #EC4899 | 粉红：操作/干预 |
| gene | 基因 | #7C3AED | #6D28D9 | #9B6BFF | #7C3AED | 深紫：高科技/遗传 |
| pathogen | 病原体 | #DC2626 | #B91C1C | #FF4040 | #DC2626 | 深红：感染/危险 |
| guideline | 指南 | #D4A853 | #B8963F | #F0D080 | #D4A853 | 金色：权威/标准 |
| metric | 指标 | #3B82F6 | #2563EB | #60A5FA | #3B82F6 | 蓝色：数据/量化 |
| other | 其他 | #64748B | #475569 | #94A3B8 | #64748B | 灰色：中性/兜底 |

## 附录 C：EC 色板完整对照表

| 关系类型 | 中文标签 | 亮色 (l) | 暗色 (d) | 语义含义 |
|---------|---------|---------|---------|---------|
| treats | 治疗 | rgba(16,185,129,0.65) | rgba(52,211,153,0.65) | A 治疗 B（药物→疾病） |
| causes | 导致 | rgba(220,38,38,0.60) | rgba(255,64,64,0.60) | A 导致 B（病因→疾病） |
| associated_with | 相关 | rgba(59,130,246,0.50) | rgba(96,165,250,0.50) | A 与 B 相关 |
| contraindicated | 禁忌 | rgba(240,120,80,0.60) | rgba(255,154,118,0.60) | A 禁忌于 B |
| diagnoses | 诊断 | rgba(139,92,246,0.60) | rgba(167,139,250,0.60) | A 诊断 B（检查→疾病） |
| prevents | 预防 | rgba(6,182,212,0.60) | rgba(34,211,238,0.60) | A 预防 B（药物→疾病） |
| symptom_of | 症状 | rgba(240,120,80,0.50) | rgba(255,154,118,0.50) | A 是 B 的症状 |
| interacts_with | 相互作用 | rgba(236,72,153,0.60) | rgba(244,114,182,0.60) | A 与 B 相互作用 |
| related_to | 关联 | rgba(100,116,139,0.40) | rgba(148,163,184,0.40) | A 与 B 一般关联（兜底） |
| (default) | 默认 | rgba(100,116,139,0.35) | rgba(148,163,184,0.35) | 未分类关系的回退颜色 |

---

> **文档版本**：v1.0
> **编制日期**：2026-06-01
> **编制单位**：MedRAG 知识图谱优化专项团队
> **适用项目**：MinerU 赛道三（医疗赛题）— MedRAG 医学知识图谱系统
> **文档密级**：内部工程文档
