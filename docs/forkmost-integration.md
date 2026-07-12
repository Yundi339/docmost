# Forkmost 可行性与实施设计

## 1. 文档定位

- 建立日期：2026-07-12
- 当前项目分支：`feat/native-database-fusion`
- 调研来源：`docs/forkmost-integration-analysis.md`
- Forkmost 参考提交：`a408d8208b2ddfc6104b1656615f721ac9f55f2c`
- 文档状态：持续维护

本文是 Forkmost 候选功能在当前 Docmost 分支中的设计、决策和 Todo 唯一
入口。原分析文档保留为调研快照，不再用来表示实施进度。

最终目标不是复制 Forkmost，而是判断其尚未开发或仍可优化的能力是否符合当前
业务，并在当前架构中重新实现值得投入的部分。判断优先从用户能否完成任务、
数据是否可信、功能是否经常使用出发，再考虑开发成本。

### 1.1 维护规则

1. Todo ID 创建后不复用、不改含义。需求变化时关闭旧项并新增 ID。
2. 功能代码、测试和本文 Todo 必须在同一个提交中更新。
3. 只有验收条件全部通过才能勾选 `[x]`；部分完成仍保持 `[ ]`，并在复盘中说明。
4. 每次完成实现都在“实施复盘”追加记录，包括用户变化、鉴权、审计、数据库、
   验证结果和遗留风险。
5. 实施中发现缺陷时，先新增 `BUG-FM-NNN` Todo，再修复和勾选。不能只在提交
   信息或聊天中记录。
6. 新增依赖、公开 API、数据库表、权限或凭据 scope 前，必须完成对应决策项。
7. 前端隐藏只能改善体验；所有权限必须由后端再次校验。

## 2. 约束和非目标

### 2.1 既有技术栈

前后端只能沿用项目现有技术和工程方式：

| 范围     | 必须沿用                                                              |
| -------- | --------------------------------------------------------------------- |
| 后端     | NestJS 11、Fastify、TypeScript、class-validator DTO                   |
| 数据库   | PostgreSQL、Kysely、现有 migration/repository 模式                    |
| 权限     | CASL Ability、`PageAccessService`、API Key/OAuth scope、Session Guard |
| 审计     | `AUDIT_SERVICE`、`AuditEvent`、`AuditResource` 和现有请求上下文       |
| 实时更新 | 现有 `WsService`、协作服务和前端 Query invalidation                   |
| 后端测试 | Jest 和现有 Nest 测试模块                                             |
| 前端     | React 18、TypeScript、Vite 8、Mantine 8、Tabler Icons                 |
| 前端状态 | TanStack Query 5、Jotai、现有 Axios client                            |
| 编辑器   | Tiptap 3、Yjs、Hocuspocus、y-indexeddb                                |
| 国际化   | i18next，并同步项目现有全部 locale                                    |
| 前端测试 | Vitest、Testing Library 和现有测试约定                                |
| 工作区   | pnpm、Nx、现有 ESLint 9 flat config                                   |

不能为了单个功能引入另一套 ORM、权限框架、状态管理、UI 组件库、协作协议或
审计系统。确需新依赖时，必须说明现有依赖为何无法满足、首屏体积、维护状态和
许可证影响，并先完成决策 Todo。

### 2.2 明确非目标

- 不合并 Forkmost 整体分支，也不直接复制其 AGPL 实现。
- 不用前端菜单可见性代替服务端权限。
- 不增加完整 Service Worker 离线缓存。
- 不增加绕过 Yjs/Hocuspocus 的“强制写数据库保存”。
- 不恢复已经撤销的公开分享 URL；重新开启分享继续生成新凭据。
- 不增加永不过期 API Key。
- 不依赖 Mermaid 间接安装的图形库；需要图引擎时必须显式决策和声明依赖。

## 3. 用户价值判断方法

每个候选功能按以下问题判断，不用 Forkmost 的完成度替代产品判断：

1. **任务价值**：用户是否因此能完成此前无法完成的真实工作？
2. **覆盖与频率**：受益用户有多少，使用是每天发生还是偶发？
3. **信任价值**：是否降低数据泄露、误操作、丢失感或账号锁死风险？
4. **理解成本**：用户是否能预测功能行为，是否会产生错误安全感？
5. **实现风险**：是否影响权限边界、协作数据、公开访问或数据库迁移？
6. **运维成本**：单机 AIO、可选 Redis、反向代理和小带宽环境是否仍可用？

优先级含义：

| 优先级 | 含义                                                 |
| ------ | ---------------------------------------------------- |
| P0     | 已存在安全、数据正确性或账号锁死风险，先于新功能处理 |
| P1     | 用户价值高、适合进入近期版本                         |
| P2     | 有明确价值，但覆盖较窄或需要产品验证                 |
| P3     | 收益较低，只有出现用户证据后再投入                   |
| 不做   | 与当前架构或用户目标冲突，记录理由防止重复讨论       |

## 4. 当前能力盘点

| 能力                         | 当前状态         | 结论                                             |
| ---------------------------- | ---------------- | ------------------------------------------------ |
| SSO Provider 管理安全        | 已完成           | owner-only、DTO、密钥加密/脱敏和审计已落地       |
| OIDC 实际登录                | 未开发           | 前端生成登录 URL，服务端无 login/callback 路由   |
| SAML/LDAP/Google 实际登录    | 未开发           | 可启用但无对应服务端认证处理器，存在锁死风险     |
| 公开分享密码                 | 未开发           | 高价值，需要统一分享访问 Guard                   |
| 成员目录隐私                 | 未开发           | 普通成员搜索当前会返回全工作区用户及邮箱         |
| 代码块标题/换行/下载         | 未开发           | 低风险、高频技术文档能力                         |
| 修改邮箱                     | 部分             | 后端立即修改存在，前端入口关闭，缺少新邮箱验证   |
| MCP 读写/审计/OAuth          | 已完成           | 统一校验已存在，但工具集中在单一大 Service       |
| MCP 回收页面/删除评论        | 未开发           | 需先拆模块和定义破坏性 scope                     |
| 空间关系图                   | 未开发           | 中等价值，必须解决页面级权限和大空间性能         |
| H4-H6                        | 部分             | schema/CSS 可处理，工具栏、slash、提示文案不完整 |
| 图片 alt/对齐                | 已完成           | 无需重复引入                                     |
| 图片说明 caption             | 未开发           | 有文档质量价值，Markdown 降级规则待决定          |
| Ctrl/Meta 点击链接           | 未开发           | 小而明确的编辑体验改进                           |
| 协作同步状态                 | 部分             | 有协作与本地缓存，缺少用户可理解的状态和重试入口 |
| 侧栏偏好                     | 已完成本地持久化 | 跨设备同步收益低，暂缓                           |
| 音频/PDF/列/富表格           | 已完成           | 无需重复引入                                     |
| Highlight/查找替换/拼写检查  | 已完成           | 无需重复引入                                     |
| 上下标/页面提及路径/导出清理 | 已完成           | 无需重复引入                                     |
| Manifest/安装图标            | 已完成           | 不扩展为完整 Service Worker                      |

## 5. 推荐路线图

### 阶段 0：恢复正确性和安全底线

1. 修复 Backlink 更新错表。
2. 修复搜索建议缓存 key。
3. 阻止未实现的 SSO 类型被启用或用于 `enforceSso`，避免工作区锁死。
4. 为上述缺陷增加回归测试。

### 阶段 1：高价值、低到中风险体验

1. 代码块标题、换行和下载。
2. 协作同步状态和重试，不实现伪“强制保存”。
3. 成员目录隐私策略和最小化返回字段。
4. OIDC 登录第一阶段，使已存在的 Provider 管理真正可用。

### 阶段 2：外部协作和账号安全

1. 公开分享密码和统一 `ShareAccessGuard`。
2. 验证式邮箱修改。
3. 分享与身份流程的通知、限流和审计补全。

### 阶段 3：MCP 可维护性与受控破坏性操作

1. 无行为变化拆分 MCP 工具注册与执行模块。
2. 引入明确的破坏性授权边界。
3. 增加移入回收站；删除评论在复用核心删除服务后再开放。

### 阶段 4：验证型功能

1. 空间关系图先做受限 beta 和性能基线。
2. H4-H6 完整入口、图片 caption、Ctrl/Meta 点击链接。
3. 根据真实使用数据决定是否继续投入低频编辑器功能。

## 6. 详细设计

### 6.1 P0 正确性缺陷

#### BUG-FM-001：Backlink 更新写错表

`BacklinkRepo.updateBacklink()` 当前调用 `updateTable('userTokens')`，目标应为
`backlinks`。虽然目前没有调用点，它是潜在的数据破坏入口，也是空间关系图的
前置阻塞。

实施要求：

- 修正目标表，增加 repository 测试，断言只更新指定 backlink。
- 搜索并确认没有调用者依赖当前错误行为。
- 关系图开发前检查 backlinks source/target 索引和页面权限过滤。

#### BUG-FM-002：搜索建议缓存上下文不完整

`useSearchSuggestionsQuery()` 的 key 只有 query，忽略 `includeUsers`、
`includeGroups`、`includePages`、`spaceId` 和 `limit`。同一浏览器内不同选择器可能
复用不属于当前上下文的结果。

实施要求：

- key 使用规范化后的完整查询参数。
- 覆盖提及、页面选择器和成员/群组选择器切换测试。
- 目录隐私上线时主动失效旧 suggestion cache。

#### BUG-FM-003：未实现的 SSO 可以启用并锁死登录

当前公开工作区信息会返回启用的 Provider，登录页会跳转至
`/api/sso/{type}/{providerId}/login`；服务端 `SsoController` 只有管理接口。
SSO 和 `enforceSso` 都是 owner 主动选择的设置，不存在普通用户越权开启问题。
问题在于系统此前允许 owner 选择一个没有登录处理器的配置：启用 Provider 并打开
`enforceSso` 后，密码与 Passkey 会被隐藏/拒绝，但 SSO 路由仍不存在。

短期修复：

- 服务端只允许“已有认证处理器”的类型设置 `isEnabled=true`。
- `enforceSso` 校验可用 Provider，而不是只检查数据库中启用标记。
- 前端对未实现类型显示“暂不可用”，不能显示可启用控件和可点击登录按钮。
- 已有会话的 owner 始终可以关闭 Provider 和 `enforceSso`；普通管理员仍不能修改。
- 不增加网页密码绕过、环境变量后门或自动改写 owner 选择。

OIDC 完成后只解除 OIDC 的限制，SAML、LDAP、Google 必须分别通过同样验收。

#### BUG-FM-004：P0 初版造成 core 反向依赖可选 EE 模块

P0 实施复核时发现，若 `WorkspaceModule` 为复用 capability 而直接导入 `SsoModule`，
会破坏当前项目通过 `EeModule` 可选加载企业模块的边界。最终实现将 capability 下沉为
无 EE 依赖的 core auth 子模块，`WorkspaceModule` 和 EE `SsoModule` 单向依赖它。

### 6.2 OIDC 登录

#### 用户价值

企业用户希望用现有身份平台登录，owner 只配置一次，成员无需维护另一套密码。
当前配置界面已经制造“可用”的预期，因此完成 OIDC 比继续增加 Provider 表单更有
价值。第一阶段只做标准 OIDC，不同时承诺 SAML、LDAP 和 Google。

#### 模块边界

在现有 `apps/server/src/ee/sso` 内增加独立 OIDC 子模块：

- `oidc/oidc-auth.controller.ts`
- `oidc/oidc-auth.service.ts`
- `oidc/oidc-client.service.ts`
- `oidc/oidc-transaction.service.ts`
- `oidc/dto/oidc-auth.dto.ts`

复用现有 `SsoService` 读取 Provider、`SsoSecretService` 解密 secret、
`LoginFlowService` 进入统一 MFA/session 流程，以及已有 `authProviders`、
`authAccounts` 表。不能在 OIDC 内另写 session 或 MFA 逻辑。

#### API、鉴权和安全

| API                                      | 鉴权              | 说明                             |
| ---------------------------------------- | ----------------- | -------------------------------- |
| `GET /api/sso/oidc/:providerId/login`    | Public + throttle | 创建 state/nonce/PKCE 并跳转 IdP |
| `GET /api/sso/oidc/:providerId/callback` | Public + throttle | 验证回调并进入统一登录流程       |

- Provider 必须属于当前域名解析出的 workspace、已启用且配置完整。
- 使用项目已有 `openid-client`，启用 authorization code + PKCE、state、nonce。
- AIO 不强制 Redis。短期事务可使用加密、签名、HttpOnly、SameSite=Lax、短时
  Cookie；多实例可选 Redis 实现一次性状态，但两种模式必须有相同行为。
- callback 必须验证 issuer、audience、state、nonce、PKCE 和回调地址。
- `redirect` 只接受站内相对路径，拒绝开放重定向。
- discovery、JWKS 和 token 请求设置超时、响应大小、重定向与协议限制。
- owner 配置的 issuer 仍可能产生 SSRF。默认要求 HTTPS；内网 IdP 例外必须作为
  显式自托管设置，不从普通请求参数决定。
- 不能仅凭未验证 email 自动绑定已有账号。只有 `email_verified=true` 且满足工作区
  策略时才允许安全绑定，否则要求已有 `authAccounts` 映射或拒绝。
- `allowSignup`、邮箱域名、禁用用户、`enforceSso` 和 MFA 继续由现有服务校验。
- access token、refresh token、ID token、authorization code、state、nonce 不写
  审计和普通日志。

#### 前端变化

- 继续使用现有登录页、Mantine 按钮和 `buildSsoLoginUrl()`。
- 只有后端声明可用的 Provider 才显示登录按钮。
- OIDC 回调由后端完成并跳回现有 MFA 或应用路由，不增加第二套前端 token 流程。
- Provider 设置页增加“配置检查”，只返回分步骤结果，不回显 discovery/token 内容。
- 新文案同步全部 locale。

#### 审计与数据库

- 管理审计沿用现有 SSO Provider 事件。
- 登录成功沿用 `USER_LOGIN`，metadata 的 source 为 `sso`，只附 provider ID/type。
- 增加失败分类审计或安全日志：配置无效、state 无效、身份未绑定、域名拒绝；不记录
  IdP 错误原文中的 token。
- 第一阶段原则上不新建表。实施前补充 `authAccounts` 对
  `(workspaceId, authProviderId, providerUserId)` 的唯一约束，防止同一外部身份绑定
  多个本地用户；迁移前先检查重复数据。

### 6.3 成员目录隐私

#### 用户价值和用户规则

在包含不同部门、客户或私密空间的工作区中，普通成员不应因输入 `@` 就看到全员
邮箱。隐私策略必须按“用户正在做什么”决定结果，而不是简单隐藏整个成员功能：

| 场景           | 建议可见范围                                       |
| -------------- | -------------------------------------------------- |
| 页面/评论提及  | 能访问当前页面的用户和群组                         |
| 页面权限选择器 | 当前操作者有权授权，且候选身份符合目录策略         |
| 空间成员管理   | 有管理空间权限的操作者可选择工作区内允许加入的身份 |
| 工作区成员管理 | owner/admin 按现有能力查看完整管理信息             |
| MCP 成员工具   | 继续要求 `Manage Member`，不因 OAuth 放宽          |

普通目录响应只返回 `id`、`name`、`avatarUrl`。邮箱可以作为服务端匹配条件，但不
返回给普通成员，也不进入前端 Query cache。

#### 模块和策略

在 workspace/member 边界增加：

- `DirectoryVisibilityPolicy`
- `DirectoryQueryService`
- 明确的查询 context：mention、permission-picker、space-member、admin、mcp

策略建议保存在 workspace settings JSON：

- `workspace`：工作区成员可互相发现，兼容当前行为。
- `shared-spaces`：只显示与操作者存在共同有效访问范围的成员。
- `admins-only`：普通成员不浏览通用目录，但页面内提及仍可按页面访问关系工作。

所有搜索、提及、权限选择器、群组成员读取和未来 API 必须调用同一策略服务。不能
在各 Repo 复制条件。现有工作区默认 `workspace` 保持兼容；新工作区默认值需产品
决策。

#### 鉴权、审计和性能

- 后端先做 workspace/space/page 权限，再执行目录 SQL。
- 不通过“开放空间”推导用户一定可被其他成员发现，除非产品明确决定。
- 策略修改仅 owner 可用，并记录 before/after 审计。
- 不审计每次搜索，避免写放大；异常批量枚举由限流与安全日志观察。
- SQL 查询直接限制候选范围和数量，不能先加载全员再在 Node.js 过滤。
- 为 shared-space 查询用真实数据执行 `EXPLAIN ANALYZE`，确认是否需要成员关系索引。

### 6.4 代码块标题、换行和下载

#### 用户价值

技术文档常需要说明文件名、查看长命令且不破坏页面宽度、把示例直接下载。三个
能力使用频率高，不增加后端攻击面，适合优先实现。

#### 设计

- 在现有 custom code block extension 增加 `title` 和 `wrap` attrs。
- NodeView 使用现有 React、Mantine、Tabler Icons；下载使用浏览器 Blob。
- 标题为空时不占空间；换行是块级显示偏好；下载按钮使用图标和 tooltip。
- 文件名过滤路径分隔符、控制字符和保留名称，并提供安全默认名。
- Mermaid 代码块继续保留现有 source/preview 行为，不注册重复全局监听器。

无需新 API、数据库迁移或独立审计。内容继续进入现有 Yjs 更新和页面历史。

兼容要求：JSON、HTML、Yjs 必须无损；标准 Markdown 围栏不天然保存 title/wrap。
默认建议 Markdown 只导出语言和代码，显示属性允许降级，不发明私有 Markdown 语法。

### 6.5 协作同步状态

#### 用户价值

用户真正关心的是“刚输入的内容是否已经同步”，而不是一个无法证明持久化的保存
按钮。小带宽、代理重连和服务器部署时，这种不确定性会直接降低信任。

#### 设计

- 复用现有 Hocuspocus provider、Yjs 和 y-indexeddb 事件，建立页面级同步状态 atom。
- 状态限定为连接中、已同步、离线、本地有待同步更新、错误。
- 正常“已同步”保持安静；离线或错误在页面标题区域显示图标和 tooltip。
- 提供“重新连接”命令，调用 provider 的现有重连能力。
- `Ctrl/Cmd+S` 只阻止浏览器保存并展示/重试同步状态，不直接写数据库。
- 服务器版本更新通知继续要求用户刷新；刷新前若有本地未同步更新，应明确警告。

无需新 API 和数据库。测试必须覆盖断网、恢复、切页、部署版本提示并发出现，以及
旧标签页不能识别新 schema 时的刷新保护。

### 6.6 公开分享密码

#### 用户价值

公开 URL 适合临时外部协作，但链接可转发。密码提供第二层门槛，适合客户、供应商
和未建立账号的临时读者。它不是身份认证，也不能替代受限空间和登录成员权限。

#### 数据和模块

`shares` 增加：

- `passwordHash`
- `passwordVersion`
- `passwordUpdatedAt`

在 `apps/server/src/core/share` 增加 `ShareAccessService`、
`ShareAccessGuard`、`SharePasswordService` 和严格 DTO。密码使用项目批准的慢哈希，
只在解锁时计算；后续内容请求验证短期 capability Cookie，避免每个资源请求重复哈希。

#### API 与权限

| API                                | 鉴权              | 权限                    |
| ---------------------------------- | ----------------- | ----------------------- |
| `POST /api/shares/password/set`    | JWT/API Key       | 页面编辑 + `rest:write` |
| `POST /api/shares/password/remove` | JWT/API Key       | 页面编辑 + `rest:write` |
| `POST /api/shares/unlock`          | Public + throttle | share 存在且密码正确    |

- Cookie 使用 HttpOnly、Secure、SameSite，绑定 share ID、password version 和过期时间。
- 修改或移除密码递增版本，旧 capability 立即失效。
- 密码不得进入 URL、localStorage、sessionStorage、Query key、日志或审计。
- API 只返回 `passwordProtected`，不返回 hash。
- 单机 AIO 使用现有限流后端；配置 Redis 时沿用共享限流，功能不能强依赖 Redis。

实施前必须列出并统一保护所有公开面：分享 info、页面、子页面树、附件、搜索、导出、
SEO 和嵌入。遗漏任何一个都视为验收失败。

审计设置、修改、移除密码和批量撤销分享；失败解锁只聚合或采样，避免攻击者制造
审计写放大。禁用公开分享仍删除记录并轮换 URL，不改为暂停旧 token。

### 6.7 验证式邮箱修改

#### 用户价值

用户确实需要修正或迁移登录邮箱，但立即更新会让输错地址、账号劫持和邮件归属
不明变成恢复问题。现有后端基础校验可复用，不能直接把被注释的前端按钮打开。

#### 流程

1. Session 用户通过近期主认证，提交当前密码和新邮箱。
2. 服务端检查 SSO 策略、唯一性和限流，向新邮箱发送短期确认链接。
3. 数据库只保存 token 的 SHA-256 hash、目标邮箱、过期时间和使用时间。
4. 确认时在事务内再次检查唯一性并更新邮箱。
5. 通知旧邮箱，撤销全部网页登录 session，要求重新登录。

建议增加 `pending_email_changes` 表，而不是复用存放明文 token 的旧模型。唯一活动
申请按 workspace/user 约束，重复申请使旧 token 失效。

| API                                    | 鉴权                             | 说明     |
| -------------------------------------- | -------------------------------- | -------- |
| `POST /api/users/email-change/request` | JWT + Session + step-up          | 创建申请 |
| `POST /api/users/email-change/confirm` | Public one-time token + throttle | 完成修改 |
| `POST /api/users/email-change/cancel`  | JWT + Session                    | 撤销申请 |

API Key、OAuth 和 MCP 不得修改身份邮箱。强制 SSO 工作区继续禁止本地修改。审计
申请、确认和撤销，但不记录 token、密码或完整邮件正文。用户身份没有改变，默认不
撤销 API Key 和已授权 OAuth；这一行为需在安全说明中明确。

### 6.8 MCP 模块化与破坏性工具

#### 用户价值

模块化本身不改变界面，但能保证新增工具不会绕过现有 DTO、权限和审计。用户层面
的目标是：AI 能安全完成常用维护操作，且用户能在 MCP 活动中知道“谁、通过哪个
凭据、对哪个空间/页面路径做了什么”。

#### 模块设计

将当前大 `McpService` 拆分为：

- `McpSessionService`：协议 session 生命周期。
- `McpToolExecutor`：唯一执行包装器。
- `McpToolRegistry`：声明和注册工具。
- `tools/page.tools.ts`
- `tools/comment.tools.ts`
- `tools/space.tools.ts`
- `tools/search.tools.ts`
- `tools/member.tools.ts`

每个 descriptor 必须声明：工具名、read/write/destructive 类别、DTO、MCP schema、
所需 scope、handler、资源元数据解析器和 MCP annotations。执行包装器继续统一处理：

- workspace 绑定和 MCP mode
- API Key/OAuth scope
- DTO 校验
- CASL/`PageAccessService`
- 审计成功与失败
- 敏感参数清理和统一错误映射

工具 handler 只能调用核心业务 service，不能直接调用 repo。拆分第一步必须是无
行为变化重构，并用现有工具契约测试锁定 schema 和结果。

#### 新工具

`trash_page` 是首选：可恢复、用户价值明确、复用 PageService，并触发侧边栏
WebSocket/Query invalidation。

`delete_comment` 风险更高：当前删除编排位于 Controller 且为硬删除。必须先抽取
可复用 `CommentDeletionService` 或核心 command，统一“本人评论/空间管理员 + 页面
权限 + WebSocket + 审计”，再提供 MCP handler。

建议新增 `mcp:destructive` scope，并默认不授予旧 API Key 和 OAuth grant；是否再
增加 owner 工作区开关由决策项确认。`confirm: true` 只能改善误操作体验，不能替代
权限和 scope。

审计记录工具、认证类型、凭据 ID、空间、页面路径/标题快照、目标 ID、结果和耗时，
不记录文档全文、评论全文、API Key 或 OAuth token。MCP 活动 UI 对本人显示可理解的
资源名称；owner 查看全局时仍遵循审计访问权限。

### 6.9 空间关系图

#### 用户价值和范围

关系图对架构文档、知识发现和整理孤立页面有价值，但不是所有用户的日常入口。
先作为空间级 beta，验证用户是否真的用于导航和维护，不做首页装饰。

#### 后端

增加独立 `SpaceGraphModule` 和 `POST /api/spaces/graph`：

- `JwtAuthGuard` + `REST_READ`。
- 校验 space read，再在 SQL 层过滤页面级限制、受限祖先和回收站页面。
- 边的两端都可见时才返回边，防止通过节点关系推断隐藏页面。
- 默认限制 500 个节点；大空间按中心页面、深度或查询过滤展开。
- 不能读取完整空间后在 Node.js 过滤。
- 第一阶段不做跨用户缓存；后续缓存必须包含权限指纹和页面树/反向链接版本。
- 普通查看不逐次审计；导出图数据记录审计。

先修复 `BUG-FM-001`，再用真实数据执行 `EXPLAIN ANALYZE`。现有 backlinks 已有
source 唯一索引和 target 索引，只有查询计划证明需要时才增加组合索引。

#### 前端

作为空间视图懒加载，使用现有 React Query、Mantine 和 Tabler controls，提供列表
降级和键盘可访问性。若原生 Canvas/SVG 无法满足布局和交互，可显式引入
Cytoscape，但必须完成依赖决策、动态 import、许可证和 bundle 检查；不能依赖
Mermaid 的传递依赖。

### 6.10 编辑器补充能力

#### H4-H6

当前 schema 和 CSS 已能处理 H4-H6，缺的是用户入口和一致文案。建议在标题菜单
二级项和 slash command 中提供，不把六个按钮都放到主工具栏。同步更新 ToC 深度、
空状态文案、快捷键、Markdown/HTML 导入导出测试。

#### 图片 caption

现有 image atom 已有 alt 和 alignment。caption 建议作为现有节点的字符串 attr，
NodeView 在编辑态提供简洁输入，阅读态渲染 `figure/figcaption`，避免增加容易被旧
客户端删除的新子节点类型。

JSON/HTML/Yjs 无损；标准 Markdown 是否把 image title 映射为 caption 需要决策。
若不映射，导出 Markdown 明确降级但不能丢失 alt。

#### Ctrl/Meta 点击链接

在现有 LinkView 中，编辑态普通点击继续打开预览，Ctrl/Meta 点击使用既有 URL
清理和导航方法直接打开目标。需要覆盖内部页面、外链、锚点和恶意协议测试。

这些能力不增加 API、数据库迁移或独立审计，均由现有协作历史覆盖。

## 7. 不做或暂缓

| 候选项                | 决策   | 用户角度理由                                                 |
| --------------------- | ------ | ------------------------------------------------------------ |
| 完整 Service Worker   | 不做   | 容易缓存旧前端，放大部署后按钮失效和协作版本冲突             |
| 强制保存              | 不做   | 无法证明服务端持久化，给用户错误安全感；改做同步状态         |
| 浮动图片              | 不做   | 对齐已满足主要需求，float 在移动端、表格、列和导出中不可预测 |
| 更多字体 ligature     | P3     | 仅少量用户受益，且影响字体体积和渲染一致性                   |
| 侧栏偏好跨设备同步    | P3     | 本地持久化已满足主要使用，增加账户设置写入价值较低           |
| 永不过期 API Key      | 不做   | 与长期凭据安全目标冲突                                       |
| Forkmost 原 OIDC 实现 | 不复制 | 状态存储和当前 Provider/session 架构不一致                   |
| Forkmost 原分享密码   | 不复制 | 前端存储/重复传输密码且保护面不统一                          |
| Forkmost 原关系图     | 不复制 | 全量返回且页面级权限不足                                     |

## 8. 跨模块验收标准

每个功能除自身验收外，还要按适用范围完成以下检查：

- owner、admin、member、guest 的服务端角色矩阵。
- Session、API Key、OAuth、MCP 身份的允许/拒绝矩阵。
- workspace、space、page 和受限祖先的资源绑定。
- 成功、失败、越权和不存在资源的审计内容及脱敏。
- 数据库 migration up/down、已有数据兼容、唯一约束和并发事务。
- AIO 无 Redis、配置 Redis、多层反向代理环境。
- WebSocket/Query invalidation 和另一个浏览器实时变化。
- 中文、英文及项目全部 locale 的新增文案。
- 桌面与移动端布局、键盘操作、loading/empty/error 状态。
- 首屏 bundle 不引入非必要编辑器/图形代码。
- 单元、集成、越权和至少一条关键用户流程测试。

## 9. 决策 Todo

- [ ] `DEC-FM-001` 决定新工作区目录默认策略；建议 `shared-spaces`，旧工作区保持 `workspace`。
- [ ] `DEC-FM-002` 决定开放空间是否构成成员可发现关系；建议否，按实际成员/页面访问计算。
- [ ] `DEC-FM-003` 确认代码块 title/wrap 在标准 Markdown 导出时允许降级；建议允许，不引入私有语法。
- [ ] `DEC-FM-004` 决定图片 Markdown title 是否映射 caption；建议不自动等同，避免改变既有 title 语义。
- [ ] `DEC-FM-005` 确认新增 `mcp:destructive` scope，并决定是否增加 owner 总开关；建议 scope 必须，总开关默认关闭。
- [ ] `DEC-FM-006` 决定空间关系图是否进入 beta；只有确认后才评估/引入显式图引擎依赖。
- [ ] `DEC-FM-007` 确认 OIDC 首期只支持标准 authorization code + PKCE，不同时承诺 SAML/LDAP/Google。
- [ ] `DEC-FM-008` 确认 OIDC verified email 自动绑定策略；建议默认关闭，owner 显式开启后才允许。

## 10. 实施 Todo

### 10.1 已完成基线

- [x] `FM-BASE-001` 完成 Forkmost 仓库、版本、许可证和候选功能调研。
- [x] `FM-BASE-002` 修复 SSO Provider 管理接口 owner-only、DTO 和 workspace 绑定。
- [x] `FM-BASE-003` 完成 SSO secret AES-GCM 加密、惰性升级和响应脱敏。
- [x] `FM-BASE-004` 完成 SSO 管理审计和前端 owner-only 可见性。
- [x] `FM-BASE-005` 确认公开分享关闭为 token 撤销/轮换，不恢复旧 URL。
- [x] `FM-BASE-006` 建立本文档、稳定 Todo ID 和实施复盘规则。

### 10.2 P0 缺陷

- [x] `BUG-FM-001` 修复 `BacklinkRepo.updateBacklink()` 更新错表并增加回归测试。
- [x] `BUG-FM-002` 修复搜索建议 Query key 缺少完整上下文并增加切换场景测试。
- [x] `BUG-FM-003` 阻止没有认证处理器的 SSO Provider 被启用或用于强制 SSO。
- [x] `BUG-FM-004` 修复 P0 初版的 core 到可选 EE 反向模块依赖。
- [x] `FM-P0-001` 增加 SSO 可用性服务端测试：enable、public data、enforce 和登录路由一致。
- [x] `FM-P0-002` 验证已有会话的 owner 可以关闭无效 SSO，admin 不能修改且不增加登录绕过。

### 10.3 OIDC

- [ ] `FM-OIDC-001` 完成 OIDC 威胁模型、账号绑定矩阵和自托管 issuer 网络策略。
- [ ] `FM-OIDC-002` 实现模块化 OIDC login/callback Controller 和 DTO。
- [ ] `FM-OIDC-003` 复用 `SsoSecretService` 与 `openid-client` 完成 discovery、PKCE、state、nonce 校验。
- [ ] `FM-OIDC-004` 实现 AIO 可用的加密事务 Cookie，并兼容可选 Redis 多实例部署。
- [ ] `FM-OIDC-005` 实现 `authAccounts` 查找/绑定、verified email 和 allowSignup 策略。
- [ ] `FM-OIDC-006` 为外部身份增加 workspace/provider/subject 唯一性迁移和重复数据预检。
- [ ] `FM-OIDC-007` 复用 `LoginFlowService` 完成 MFA、session、禁用用户和 enforceSso 流程。
- [ ] `FM-OIDC-008` 完成站内 redirect 校验、请求超时、协议/响应大小和敏感错误清理。
- [ ] `FM-OIDC-009` 前端只显示后端声明可用的 OIDC Provider，并增加配置检查状态。
- [ ] `FM-OIDC-010` 增加成功/失败审计，确认 token/code/state/nonce 不进入日志。
- [ ] `FM-OIDC-011` 增加单元、回调集成、重放、开放重定向、账号冲突和 owner 权限测试。
- [ ] `FM-OIDC-012` 同步全部 locale，并完成反向代理公开 URL 验证。

### 10.4 目录隐私

- [ ] `FM-DIR-001` 盘点 search、mention、comment、permission picker、group、admin 和 MCP 所有目录入口。
- [ ] `FM-DIR-002` 定义 `DirectoryVisibilityPolicy` 和强类型查询 context。
- [ ] `FM-DIR-003` 实现 `DirectoryQueryService`，在 SQL 层限制候选身份。
- [ ] `FM-DIR-004` 普通目录响应移除 email，仅返回最小资料；管理员接口保持现有能力。
- [ ] `FM-DIR-005` 将页面/评论提及限制为可访问当前页面的身份。
- [ ] `FM-DIR-006` 将页面权限、空间成员和群组选择器接入统一策略。
- [ ] `FM-DIR-007` 保持 MCP 成员工具 `Manage Member` 服务端限制并增加越权测试。
- [ ] `FM-DIR-008` 增加 owner 目录策略设置 UI、审计和全部翻译。
- [ ] `FM-DIR-009` 完成旧工作区默认值兼容和新工作区策略迁移。
- [ ] `FM-DIR-010` 用真实规模执行查询计划并补限流/枚举测试。

### 10.5 代码块

- [ ] `FM-CODE-001` 为 custom code block 增加兼容的 `title`、`wrap` attrs。
- [ ] `FM-CODE-002` 使用现有 NodeView 实现标题编辑、换行开关、下载图标和 tooltip。
- [ ] `FM-CODE-003` 实现下载文件名清理、语言扩展名映射和安全默认名。
- [ ] `FM-CODE-004` 保持 Mermaid preview/source、复制和只读模式行为。
- [ ] `FM-CODE-005` 增加 JSON、HTML、Markdown、Yjs、协作和历史文档兼容测试。
- [ ] `FM-CODE-006` 完成移动端、长标题、超长代码和全部 locale 验收。

### 10.6 同步状态

- [ ] `FM-SYNC-001` 盘点 Hocuspocus/Yjs/provider 现有连接和同步事件。
- [ ] `FM-SYNC-002` 建立页面级同步状态 atom，区分已同步、离线、待同步和错误。
- [ ] `FM-SYNC-003` 在标题区域实现安静状态图标、tooltip 和重新连接命令。
- [ ] `FM-SYNC-004` 将 Ctrl/Cmd+S 映射为状态提示/重试，不增加直接数据库保存。
- [ ] `FM-SYNC-005` 与服务器版本更新提示联动，本地待同步时阻止无提示刷新。
- [ ] `FM-SYNC-006` 增加断网恢复、切页、刷新、双标签页和代理重连测试。
- [ ] `FM-SYNC-007` 同步全部 locale，验证移动端不遮挡标题工具。

### 10.7 分享密码

- [ ] `FM-SHARE-001` 列出页面、树、附件、搜索、导出、SEO、嵌入全部公开访问面。
- [ ] `FM-SHARE-002` 设计并迁移 password hash/version/updatedAt 字段和回滚。
- [ ] `FM-SHARE-003` 实现 `SharePasswordService`、`ShareAccessService` 和统一 Guard。
- [ ] `FM-SHARE-004` 实现 owner/editor 设置、修改、移除密码 API 与 DTO/scope 校验。
- [ ] `FM-SHARE-005` 实现 public unlock 限流和短期 HttpOnly capability Cookie。
- [ ] `FM-SHARE-006` 将所有公开面接入 Guard，验证附件和导出不可旁路。
- [ ] `FM-SHARE-007` 实现分享管理 UI、访客解锁页、错误/loading 状态和全部翻译。
- [ ] `FM-SHARE-008` 增加设置/移除/轮换审计和失败解锁聚合策略。
- [ ] `FM-SHARE-009` 增加暴力尝试、Cookie 版本失效、跨 share 重用和并发测试。
- [ ] `FM-SHARE-010` 验证无 Redis AIO 与 Redis 多实例行为一致。

### 10.8 邮箱修改

- [ ] `FM-EMAIL-001` 完成 Session-only、step-up、SSO 和账号恢复威胁模型。
- [ ] `FM-EMAIL-002` 增加 `pending_email_changes` migration、唯一约束、清理和回滚。
- [ ] `FM-EMAIL-003` 实现 request/confirm/cancel DTO、Service 和 Controller。
- [ ] `FM-EMAIL-004` token 只保存 SHA-256 hash，并实现过期、单次使用和旧申请失效。
- [ ] `FM-EMAIL-005` 确认时事务内检查唯一性、更新邮箱并撤销网页登录 session。
- [ ] `FM-EMAIL-006` 向新邮箱发送确认，向旧邮箱发送安全通知。
- [ ] `FM-EMAIL-007` 恢复账户设置入口，完成 pending/success/error 状态和全部翻译。
- [ ] `FM-EMAIL-008` 增加申请/确认/撤销审计并确认不记录 token 和密码。
- [ ] `FM-EMAIL-009` 增加 API Key/OAuth/MCP 拒绝、SSO 禁止、竞争确认和重放测试。

### 10.9 MCP

- [ ] `FM-MCP-001` 为当前所有工具生成行为、schema、scope、权限和审计契约清单。
- [ ] `FM-MCP-002` 引入强类型 `McpToolDescriptor` 和注册表，不改变外部工具协议。
- [ ] `FM-MCP-003` 抽取唯一 `McpToolExecutor`，集中 mode/scope/DTO/ACL/audit/error redaction。
- [ ] `FM-MCP-004` 按 page/comment/space/search/member 拆分工具 provider。
- [ ] `FM-MCP-005` 增加拆分前后契约测试，确认工具名、输入 schema 和返回内容不变。
- [ ] `FM-MCP-006` 在 API Key/OAuth 管理与 consent 中增加 `mcp:destructive`，旧 grant 默认不具备。
- [ ] `FM-MCP-007` 实现 `trash_page`，复用 PageService 并触发侧边栏实时更新。
- [ ] `FM-MCP-008` 抽取核心 CommentDeletionService，网页与 MCP 共用权限/审计/广播。
- [ ] `FM-MCP-009` 实现 `delete_comment`，限制本人或空间管理员并校验页面权限。
- [ ] `FM-MCP-010` 为破坏性工具增加 MCP annotations、确认交互和越权测试。
- [ ] `FM-MCP-011` MCP 活动展示空间、页面路径、标题、目标和凭据名称，不只显示 UUID。
- [ ] `FM-MCP-012` 增加 session/API Key/OAuth、只读模式、scope 和审计脱敏矩阵测试。

### 10.10 空间关系图

- [ ] `FM-GRAPH-001` 通过 beta 决策并定义导航、孤立页发现和影响分析三个用户任务。
- [ ] `FM-GRAPH-002` 实现 `SpaceGraphModule`、DTO 和 `POST /spaces/graph`。
- [ ] `FM-GRAPH-003` SQL 层过滤 space/page/ancestor/deleted 权限，边只连接可见节点。
- [ ] `FM-GRAPH-004` 实现 500 节点上限、中心页/深度过滤和稳定分页或裁剪规则。
- [ ] `FM-GRAPH-005` 用真实数据执行 `EXPLAIN ANALYZE`，按证据决定索引。
- [ ] `FM-GRAPH-006` 前端空间视图懒加载，提供搜索、筛选、列表降级和键盘操作。
- [ ] `FM-GRAPH-007` 若获批准，显式引入并动态加载图引擎，检查许可证和 bundle。
- [ ] `FM-GRAPH-008` 导出图数据时审计，普通查看不逐次写审计。
- [ ] `FM-GRAPH-009` 增加受限页面推断、超大空间、移动端和性能回归测试。

### 10.11 编辑器补充

- [ ] `FM-EDIT-001` 为 H4-H6 增加标题子菜单、slash command、快捷键和 ToC 文案。
- [ ] `FM-EDIT-002` 增加 H4-H6 Markdown/HTML/JSON/Yjs 和历史文档测试。
- [ ] `FM-EDIT-003` 为 image atom 增加 caption attr 和编辑/阅读渲染。
- [ ] `FM-EDIT-004` 保持 alt/alignment，并验证 caption 导入导出降级规则。
- [ ] `FM-EDIT-005` 实现 Ctrl/Meta 点击链接，覆盖内部、外部、锚点和恶意协议。
- [ ] `FM-EDIT-006` 完成新增编辑器文案翻译和移动端/只读/分享页验收。

### 10.12 发布前复盘

- [ ] `FM-REL-001` 对本阶段变更执行角色、身份、资源和审计矩阵。
- [ ] `FM-REL-002` 执行受影响 client/server test、typecheck、lint 和 build。
- [ ] `FM-REL-003` 检查 migration 回滚、AIO 无 Redis 和反向代理环境。
- [ ] `FM-REL-004` 使用两个浏览器验证实时更新和旧前端版本提示。
- [ ] `FM-REL-005` 更新本文 Todo、实施复盘、用户可见变化和遗留风险。

## 11. 实施复盘

### 2026-07-12：调研转为持续实施设计

- 完成：`FM-BASE-001` 至 `FM-BASE-006`。
- 用户可见变化：无；本次只建立设计和实施约束。
- 鉴权/审计/数据库：未改运行时代码。
- 验证：对照当前 SSO、搜索、Backlink、MCP、编辑器、分享、认证和技术栈代码。
- 新发现缺陷：`BUG-FM-001`、`BUG-FM-002`、`BUG-FM-003`。
- 关键修正：SSO Provider 管理安全已完成，但 OIDC/SAML/LDAP/Google 认证处理器未完成，
  不能把“设置页可配置”等同于“SSO 可登录”。

### 2026-07-12：P0 正确性与 SSO 配置有效性

- 完成 Todo：`BUG-FM-001`、`BUG-FM-002`、`BUG-FM-003`、`BUG-FM-004`、
  `FM-P0-001`、`FM-P0-002`。
- 用户可见变化：没有登录处理器的 SSO 类型显示不可用且不能开启；历史已启用记录
  仍允许 owner 单向关闭。登录页不会展示这些无效 Provider。
- 前端实现与兼容：使用现有 React、Mantine、i18next 和 TanStack Query；搜索建议
  cache key 包含用户/群组/页面、空间和 limit 上下文；新增提示同步 12 个 locale。
- 后端鉴权与资源边界：在 core auth 子模块新增 `SsoLoginCapabilityService`，作为
  Provider 启用、公开展示和强制 SSO 校验的唯一能力来源；core 不反向依赖可选 EE。
  owner-only 规则保持不变，没有新增登录绕过。
- 审计与敏感数据：无新增凭据和数据库字段；被拒绝的配置不产生状态变更，现有 SSO
  创建、更新、删除审计保持不变。
- 数据库迁移与回滚：无迁移。修复 `BacklinkRepo` 只更新 `backlinks` 指定 ID。
- 测试和人工验证：P0 定向 server 25 项、client 9 项通过；完整 server 59 个 suite、
  334 项和完整 client 10 个文件、91 项通过；server/client production build、受影响
  文件 ESLint、Prettier、版本同步和 `git diff --check` 通过。
- 性能/部署验证：没有增加网络请求和首屏依赖；capability 判断为内存 Set，公开
  Provider 在现有查询结果上做有界过滤。
- 新发现 BUG Todo：`BUG-FM-004`，已在本次复核中修复并通过构建。
- 遗留风险和下一步：所有 SSO 类型当前均不可用，这是服务端没有 login/callback
  处理器的真实状态。OIDC 实现完成后才能在 capability 注册并解除 OIDC 开关限制。

### 复盘模板

后续每次实现追加以下结构：

```text
### YYYY-MM-DD：<阶段或功能>（<commit>）

- 完成 Todo：
- 用户可见变化：
- 前端实现与兼容：
- 后端鉴权与资源边界：
- 审计与敏感数据：
- 数据库迁移与回滚：
- 测试和人工验证：
- 性能/部署验证：
- 新发现 BUG Todo：
- 遗留风险和下一步：
```
