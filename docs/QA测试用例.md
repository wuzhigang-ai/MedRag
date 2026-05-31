# MedRAG 全功能 QA 测试用例

> **版本**：v1.0 | **日期**：2026-05-31 | **团队**：天机运算  
> **总用例数**：110 | **覆盖维度**：认证/上传/CRUD/图谱/问答/数据/边界/异常/性能

---

## TC-001 ~ TC-015：认证安全

| # | 测试标题 | 预置条件 | 测试步骤 | 预期结果 | 维度 |
|---|---------|---------|---------|---------|------|
| TC-001 | 有效凭据登录 | admin/admin123 用户存在于 DB | POST /api/auth/login → {"username":"admin","password":"admin123"} | 200, 返回 token + user 对象, token 非空 | 功能 |
| TC-002 | 错误密码登录 | admin 用户存在 | POST /api/auth/login → {"username":"admin","password":"wrong"} | 401, "用户名或密码错误" | 安全 |
| TC-003 | 不存在的用户登录 | 用户 "nonexistent" 不存在 | POST /api/auth/login → {"username":"nonexistent","password":"x"} | 401 | 安全 |
| TC-004 | 空用户名登录 | 无 | POST /api/auth/login → {"username":"","password":"x"} | 401 | 边界 |
| TC-005 | 注册成功 | 用户名 "newuser" 不存在 | POST /api/auth/register → {username, password, confirmPassword匹配, email} | 200, 返回 user 对象 | 功能 |
| TC-006 | 密码不匹配注册 | 无 | POST /api/auth/register → passwords 不匹配 | 400 | 边界 |
| TC-007 | 重复用户名注册 | admin 已存在 | POST /api/auth/register → username="admin" | 400, "用户名已存在" | 边界 |
| TC-008 | 无效邮箱注册 | 无 | POST /api/auth/register → email="not-email" | 400, "邮箱格式不正确" | 边界 |
| TC-009 | 无 token 访问管理 API | 未登录 | GET /api/articles (不带 Authorization header) | 401 | 安全 |
| TC-010 | 错误 token 访问 | 无 | GET /api/articles → Authorization: Bearer invalid_token | 401 | 安全 |
| TC-011 | 普通用户访问管理 API | 普通用户已登录 | DELETE /api/articles/1 (user role="user") | 403 | 权限 |
| TC-012 | admin 用户访问管理 API | admin 已登录 | GET /api/articles | 200, 返回文章列表 | 权限 |
| TC-013 | auth/me 返回真实用户 | 已登录 | GET /api/auth/me → 带有效 token | 200, user.id > 0, user.username 非空 | 功能 |
| TC-014 | auth/me 未登录 | 未登录 | GET /api/auth/me (无 header) | 200, user=null | 边界 |
| TC-015 | 登出后 token失效 | 已登录 | POST /api/auth/logout → 再用旧 token 调 /api/articles | 401 | 功能 |

---

## TC-016 ~ TC-035：上传流水线

| # | 测试标题 | 预置条件 | 测试步骤 | 预期结果 | 维度 |
|---|---------|---------|---------|---------|------|
| TC-016 | PDF 上传成功 | 后端运行, 有 PDF 文件 | POST /api/upload → 上传有效 PDF | 200, 返回 task_uuid + task_id + status="received" | 功能 |
| TC-017 | 非 PDF 文件上传 | 无 | POST /api/upload → 上传 .txt 文件 | 400, "仅支持PDF文件" | 边界 |
| TC-018 | 空文件上传 | 无 | POST /api/upload → 上传 0 字节文件 | 400 | 边界 |
| TC-019 | 超大文件上传 | 无 | POST /api/upload → 上传 200MB 文件 | 413 或 400 | 边界 |
| TC-020 | 状态 received→parsing 自动转换 | 任务入队 | 检查 DB upload_tasks | 状态自动从 received 变为 parsing | 状态机 |
| TC-021 | 状态 parsing→chunking 自动转换 | 解析完成 | 检查 DB | 状态自动变为 chunking, parsing_duration_ms 已记录 | 状态机 |
| TC-022 | 状态 chunking→indexing 自动转换 | FAISS 完成 | 检查 DB | 状态变为 indexing, faiss_chunks_added > 0 | 状态机 |
| TC-023 | 状态 indexing→done 自动转换 | LightRAG 完成 | 检查 DB | 状态变为 done, lightrag_entities > 0 | 状态机 |
| TC-024 | 状态 indexing→partial (LighRAG 失败) | LightRAG 不可用 | 检查 DB | 状态为 partial, lightrag_error 非空, 非 failed | 状态机 |
| TC-025 | partial 不被覆盖为 failed | partial 状态存在 | 检查 DB | 最终状态仍为 partial | 状态机 |
| TC-026 | 解析超时保护 | 超大 PDF | 等待 PARSE_TIMEOUT 后 | 任务标记 failed, 错误信息含 "超时" | 异常 |
| TC-027 | FAISS 超时保护 | 异常慢的编码 | 等待 CHUNK_TIMEOUT 后 | 任务标记 failed | 异常 |
| TC-028 | 轮询 status API 正常 | 任务处理中 | GET /api/upload/{uuid}/status | 200, 返回当前 status + 进度字段 | 功能 |
| TC-029 | 轮询不存在的任务 | 无 | GET /api/upload/{nonexistent}/status | 404 | 边界 |
| TC-030 | 取消排队中的任务 | 任务 enqueue 但未处理 | POST /api/upload/{uuid}/cancel | 200, "已取消", 任务 status=failed | 功能 |
| TC-031 | 取消处理中的任务 | 任务在 parsing 阶段 | POST /api/upload/{uuid}/cancel | 200, "取消中", 完成后任务 failed | 功能 |
| TC-032 | 取消已完成的任务 | 任务 done | POST /api/upload/{uuid}/cancel | 400, "已结束" | 边界 |
| TC-033 | 重试失败的任务 | 任务 failed | POST /api/upload/{uuid}/retry | 200, 重新入队 | 功能 |
| TC-034 | 重试已完成的任务 | 任务 done | POST /api/upload/{uuid}/retry | 400 | 边界 |
| TC-035 | 上传历史列表 | 有历史任务 | GET /api/upload/history | 200, tasks 数组, total > 0 | 功能 |

---

## TC-036 ~ TC-050：文献 CRUD

| # | 测试标题 | 预置条件 | 测试步骤 | 预期结果 | 维度 |
|---|---------|---------|---------|---------|------|
| TC-036 | 文献列表全部 | DB 有文章 | GET /api/articles | 200, 返回数组, length > 0 | 功能 |
| TC-037 | 文献列表按状态筛选 | DB 有已入库文章 | GET /api/articles?status=approved | 200, 仅返回 approved 文章 | 功能 |
| TC-038 | 文献列表按类型筛选 | 有指南类型文献 | GET /api/articles?articleType=guideline | 200, 仅返回 guideline | 功能 |
| TC-039 | 文献列表搜索 | 有 title 含 "糖尿病" 的文章 | GET /api/articles?search=糖尿病 | 200, 返回匹配项 | 功能 |
| TC-040 | 文献列表空搜索结果 | 无 | GET /api/articles?search=zzz不存在zzz | 200, 空数组 | 边界 |
| TC-041 | 单篇文献详情 | 文章 id=1 存在 | GET /api/articles/1 | 200, 含 title/journal/doi/authors | 功能 |
| TC-042 | 不存在的文献详情 | 文章 id=999 不存在 | GET /api/articles/999 | 404 | 边界 |
| TC-043 | 创建文献 | 管理权限 | POST /api/articles → 完整数据 | 200, 返回 id > 0 | 功能 |
| TC-044 | 更新文献状态 | 管理权限 | PATCH /api/articles/1/status → approved | 200 | 功能 |
| TC-045 | 审核通过文献 | 管理权限 | POST /api/articles/1/approve | 200 | 功能 |
| TC-046 | 删除文献 | 管理权限 | DELETE /api/articles/1 | 200 | 功能 |
| TC-047 | 添加段落 | 管理权限 | POST /api/articles/1/segments → 段落数据 | 200, count > 0 | 功能 |
| TC-048 | 添加图表 | 管理权限 | POST /api/articles/1/figures → 图表数据 | 200, count > 0 | 功能 |
| TC-049 | 文献统计 | DB 有数据 | GET /api/articles/stats | 200, total > 0, byStatus 非空 | 功能 |
| TC-050 | 非管理员创建文献 | user role="user" | POST /api/articles → 带用户 token | 403 | 权限 |

---

## TC-051 ~ TC-060：知识图谱

| # | 测试标题 | 预置条件 | 测试步骤 | 预期结果 | 维度 |
|---|---------|---------|---------|---------|------|
| TC-051 | 图谱数据加载 | LightRAG 有数据 | GET /api/graph | 200, nodes.length=168, edges.length=25 | 功能 |
| TC-052 | 图谱统计 | LightRAG 有数据 | GET /api/graph/stats | 200, totalNodes=168, totalEdges=25, nodeTypes 非空 | 功能 |
| TC-053 | 节点搜索匹配 | 存在含 "血" 的节点 | GET /api/graph/nodes/search?query=血 | 200, 返回匹配节点列表 | 功能 |
| TC-054 | 节点搜索无匹配 | 无 | GET /api/graph/nodes/search?query=zzz不存在 | 200, 空数组 | 边界 |
| TC-055 | 图谱 Canvas 渲染 | 前端 GraphPage 加载 | 页面打开, 检查 Canvas 元素 | Canvas 存在, 节点可见, 边可见 | UI |
| TC-056 | 节点类型筛选 | 图谱页面 | 选择"疾病"筛选项 | 仅显示疾病类型节点 | UI |
| TC-057 | 节点搜索交互 | 图谱页面 | 搜索框输入 "血压" | 匹配节点高亮, 不匹配节点淡出 | UI |
| TC-058 | 全局/局部模式切换 | 图谱页面 | 点击"全局图谱"按钮 | 视图切换, 所有节点可见 | UI |
| TC-059 | 标签显隐切换 | 图谱页面 | 点击"标签"按钮 | 节点标签显示/隐藏切换 | UI |
| TC-060 | 导出 PNG | 图谱页面 | 点击"导出PNG"按钮 | 触发浏览器下载, 文件名含日期 | UI |

---

## TC-061 ~ TC-075：Agent 问答

| # | 测试标题 | 预置条件 | 测试步骤 | 预期结果 | 维度 |
|---|---------|---------|---------|---------|------|
| TC-061 | SSE 流建立 | 后端运行 | GET /api/agent/stream?question=hello | 200, Content-Type=text/event-stream | 功能 |
| TC-062 | Agent 开始事件 | SSE 连接 | 等待第一个事件 | data: {"type":"start",...} | 功能 |
| TC-063 | Agent 工具调用事件 | SSE 连接 | 等待 step 事件 | data: {"type":"step","tool":"search_rag",...} | 功能 |
| TC-064 | Agent 回答事件 | SSE 连接 | 等待 answer 事件 | data: {"type":"answer","answer":...,"sources":[...]} | 功能 |
| TC-065 | Agent 前端快捷问题 | AdminChatPage | 点击 "房颤高卒中风险..." 按钮 | 文本框填入问题, 可发送 | UI |
| TC-066 | 发送空消息 | AdminChatPage | 不输入直接点发送 | 不发送（按钮 disabled） | 边界 |
| TC-067 | Agent 回答含引用 | 发送医学问题 | 检查回答末尾 | 显示 "文献溯源" 面板, 含引用来源 | 功能 |
| TC-068 | 推理过程面板 | 发送问题 | 观察右侧面板 | 显示预推理阶段 → 工具调用步骤 → 最终回答 | UI |
| TC-069 | 推理步骤计时 | 发送问题 | 观察步骤时间 | 每步显示精确耗时 (如 "2.3s") | UI |
| TC-070 | Agent FAISS 降级 | LLM API 不可用 | 发送问题, Agent 自动降级 | 返回 "Agent 推理引擎暂时不可用" 提示 + 直接检索结果 | 异常 |
| TC-071 | 复制回答 | 有回答显示 | 点击复制按钮 | 内容复制到剪贴板, toast 提示 | UI |
| TC-072 | 用户对话历史 | UserChatPage | 发送 3 条消息 | 左侧历史列表显示会话 | UI |
| TC-073 | 新建对话 | UserChatPage | 点击 "新建对话" | 消息列表清空, 创建新会话 | UI |
| TC-074 | SSE 连接中断恢复 | SSE 连接中 | 断开网络 | 前端显示错误提示, 不影响页面其他功能 | 异常 |
| TC-075 | Agent 长问题处理 | 无 | 发送 500+ 字的问题 | Agent 正常处理, 不截断 | 边界 |

---

## TC-076 ~ TC-085：数据一致性

| # | 测试标题 | 预置条件 | 测试步骤 | 预期结果 | 维度 |
|---|---------|---------|---------|---------|------|
| TC-076 | FAISS 与 MySQL 文档数一致 | 有 3 篇文章入库 | 对比 get_stats + articles/stats | FAISS total_documents == MySQL total_approved | 数据 |
| TC-077 | 上传任务状态与前端一致 | 有任务运行中 | 对比 DB status 与前端显示 | 状态文字和颜色一致 | 数据 |
| TC-078 | 文献删除后 FAISS 同步 | 删除某文章 | 检查 FAISS 检索结果 | 已删除文章不再出现 | 数据 |
| TC-079 | 图谱节点数与 LightRAG 一致 | LightRAG 已构建 | 对比 GraphManager.build() nodes 与 LightRAG entity 文件 | 数量一致 | 数据 |
| TC-080 | 文献库统计卡片数据准确 | 有 3 篇文章 | 卡片数字 vs DB SELECT COUNT | 4 个卡片数字都正确 | 数据 |
| TC-081 | Dashboard 知识节点数与图谱一致 | 图谱 168 节点 | Dashboard 卡片 vs 图谱 stats | 数字一致 | 数据 |
| TC-082 | camelCase 转换验证 | 后端返回 snake_case | 前端 console.log 查看数据 | 所有 key 为 camelCase | 数据 |
| TC-083 | 图表图片路径一致 | 有图片的文献 | 对比 extracted_figures.img_path 与文件系统 | 文件存在, 路径正确 | 数据 |
| TC-084 | 文本段数与 content_list 一致 | 有语义块的文献 | text_segments COUNT vs content_list.json items | 数量一致 | 数据 |
| TC-085 | 操作日志完整 | 有登录/创建操作 | SELECT FROM operation_logs | 日志记录完整, IP 非 127.0.0.1 | 数据 |

---

## TC-086 ~ TC-095：边界条件

| # | 测试标题 | 预置条件 | 测试步骤 | 预期结果 | 维度 |
|---|---------|---------|---------|---------|------|
| TC-086 | 空文献库页面 | DB 无文章 | 打开 LibraryPage | 显示 "暂无文献" 或空列表, 不崩溃 | 边界 |
| TC-087 | 空图谱 | LightRAG 无数据 | 打开 GraphPage | 显示 "暂无数据" 或空 Canvas | 边界 |
| TC-088 | 空问答 | 无聊天记录 | 打开 AdminChatPage | 显示欢迎页 + 快捷问题 | 边界 |
| TC-089 | 空文件队列 | 无上传任务 | 打开 ParsingPage 文件队列 | 显示 "拖拽上传" 提示 | 边界 |
| TC-090 | 空任务中心 | upload_tasks 为空 | 打开 ParsingPage 任务中心 | 显示 "暂无任务" | 边界 |
| TC-091 | 特殊字符文献名 | 无 | 创建文献 title="<script>alert(1)</script>" | 正常存储, 前端渲染时不执行 JS | 安全 |
| TC-092 | 超长文献标题 | 无 | 创建文献 title=500 个中文字符 | 正常存储, 前端截断显示不溢出 | 边界 |
| TC-093 | 中文用户名登录 | 中文名用户存在 | 用中文用户名登录 | 正常认证, 无编码错误 | 边界 |
| TC-094 | 并发上传 5 个 PDF | 无 | 快速连续上传 5 个 PDF | 全部入队, 逐个处理, 无崩溃 | 并发 |
| TC-095 | 页面快速切换 | 登录状态 | 连续点击导航 6 个页面 | 无白屏, 无 crash, 无内存泄漏 | 边界 |

---

## TC-096 ~ TC-105：异常恢复

| # | 测试标题 | 预置条件 | 测试步骤 | 预期结果 | 维度 |
|---|---------|---------|---------|---------|------|
| TC-096 | 后端重启后前端恢复 | 后端运行中 | 重启后端, 前端继续操作 | 前端自动重连或显示错误提示, 不白屏 | 异常 |
| TC-097 | MySQL 断连恢复 | MySQL 暂停 | 暂停 MySQL, 调 API, 恢复 MySQL | API 返回 500, 但后端不崩溃; 恢复后正常 | 异常 |
| TC-098 | 任务处理中断后恢复 | 有 parsing 阶段任务 | 重启后端 | 被打断任务正确标记, 新任务正常处理 | 异常 |
| TC-099 | FAISS 索引文件损坏 | faiss_index.bin 损坏 | 启动后端 | 后端启动不崩溃, 日志含警告 | 异常 |
| TC-100 | .env 缺少 Agent 配置 | 注释 AGENT 配置 | 发送 Agent 请求 | 返回明确错误, 不崩溃 | 异常 |
| TC-101 | 无效 PDF 文件上传 | 无 | 上传损坏的 PDF | 解析失败, 任务标记 failed, 不阻塞队列 | 异常 |
| TC-102 | Agent LLM 超时后重试 | LLM 慢响应 | 发送问题 | 重试 3 次 (2s/4s 间隔), 最后降级到 FAISS | 异常 |
| TC-103 | 网络断开时前端行为 | 前端运行 | 断开网络, 操作页面 | 显示合理错误提示, 不崩溃 | 异常 |
| TC-104 | 浏览器刷新后会话保持 | 已登录 | 刷新页面 | 不重定向到 /login, 用户状态保持 | 异常 |
| TC-105 | 多标签页同时登录 | 已登录 | 新标签页打开 /admin | 正常加载, token 共享 | 异常 |

---

## TC-106 ~ TC-110：性能

| # | 测试标题 | 预置条件 | 测试步骤 | 预期结果 | 阈值 | 维度 |
|---|---------|---------|---------|---------|------|------|
| TC-106 | 首屏加载时间 | 前端构建生产版本 | Lighthouse Performance 审计 | FCP < 1.5s, LCP < 2.5s | LCP < 3s | 性能 |
| TC-107 | FAISS 检索延迟 | 知识库有 3 篇文献 | curl /api/search 测 10 次取平均 | < 100ms | < 200ms | 性能 |
| TC-108 | API 响应时间 (articles列表) | 有数据 | curl GET /api/articles 测 10 次 | < 50ms | < 100ms | 性能 |
| TC-109 | 图谱渲染帧率 | GraphPage 168 节点 | Chrome DevTools FPS meter | > 30fps | > 20fps | 性能 |
| TC-110 | 包体积 | 前端构建生产版本 | `ls -lh dist/public/assets/*.js` | < 500KB gzipped | < 600KB | 性能 |

---

## 测试执行记录

| 执行日期 | 执行人 | 通过 | 失败 | 阻塞 | 备注 |
|---------|--------|------|------|------|------|
| (待执行) | | | | | |

---

> **文档版本**：v1.0 | 2026-05-31 | **团队**：天机运算
