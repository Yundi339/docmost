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
| SSO 启用策略                 | 已修复           | owner 自主配置；只有实际登录模块注册后才能启用   |
| 公开分享密码                 | 已完成           | 统一 Guard、限流、附件撤销和审计已落地           |
| 成员目录隐私                 | 未开发           | 普通成员搜索当前会返回全工作区用户及邮箱         |
| 代码块标题/换行/下载         | 已完成           | 编辑器属性扩展、下载安全和兼容测试已落地         |
| 修改邮箱                     | 已完成           | Session-only 申请/确认、一次性令牌和双向通知     |
| MCP 读写/审计/OAuth          | 已完成           | 工具注册、执行、访问和审计已模块化               |
| MCP 回收页面/删除评论        | 页面已完成       | 页面回收/恢复可逆；评论硬删除工具明确延期        |
| 空间关系图                   | 未开发           | 中等价值，必须解决页面级权限和大空间性能         |
| H4-H6                        | 已完成           | 工具栏、slash、目录和协作兼容测试已落地          |
| 图片 alt/对齐                | 已完成           | 无需重复引入                                     |
| 图片说明 caption             | 已完成           | HTML/JSON/Yjs 无损，Markdown 明确降级            |
| Ctrl/Meta 点击链接           | 已完成           | 编辑态安全打开，普通点击和只读行为保持不变       |
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
3. 修复 SSO 无处理器启用和强制登录锁死风险。
4. 为上述缺陷增加回归测试。

### 阶段 1：高价值、低到中风险体验

1. 代码块标题、换行和下载。
2. 协作同步状态和重试，不实现伪“强制保存”。
3. 成员目录隐私策略和最小化返回字段。
4. OIDC 登录第一阶段，使已存在的 Provider 管理真正可用。

### 阶段 2：外部协作和账号安全

1. `[已完成]` 公开分享密码和统一 `ShareAccessGuard`。
2. `[已完成]` 验证式邮箱修改。
3. 分享与身份流程的通知、限流和审计补全。

### 阶段 3：MCP 可维护性与受控破坏性操作

1. `[已完成]` 无行为变化拆分 MCP 工具注册与执行模块。
2. `[已完成]` 引入明确的破坏性授权边界。
3. `[部分完成]` 页面移入回收站和恢复已完成；删除评论在软删除服务完成后再开放。

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

#### BUG-FM-003：没有登录处理器的 SSO Provider 可被启用

当前仓库有 SAML、OIDC、Google 和 LDAP 的管理表单与 Provider 数据，但没有对应的
login/callback/LDAP 认证 Controller。owner 是否决定使用 SSO 是业务权限，服务端是否
具备登录能力是技术事实，两者不能混为一谈。允许启用不存在处理器的 Provider 会在
登录页制造可用假象，并让请求落到不存在的路由。

实施要求：

- 登录模块在启动时向 `SsoLoginCapabilityService` 注册自身 Provider 类型和处理器；
  管理模块不维护与路由脱节的硬编码名单。
- 未注册类型允许创建和保存配置，但不能从关闭切换为启用；历史已启用项仍可关闭。
- 管理响应返回 `loginAvailable`，公开工作区只返回已启用且处理器可用的 Provider。
- 未来 OIDC/SAML/LDAP 模块只有在 Controller 实际装载时才注册能力。

#### BUG-FM-004：原始 enforceSso 布尔值可永久锁死工作区

原实现只检查数据库中是否存在 `isEnabled=true` 的 Provider，随后密码、邀请、Passkey、
邮箱和统一登录流直接信任 `workspace.enforceSso`。不存在登录处理器时，所有本地登录会
被拒绝，而 SSO 路由又不存在。

实施要求：

- `SsoEnforcementService` 统一计算“配置强制且至少一个启用 Provider 具有已注册处理器”；
  所有认证入口禁止直接读取原始布尔值做安全判断。
- 历史无效配置按未强制处理，公开登录和邀请恢复本地入口，owner 登录后可关闭旧配置。
- 启用强制 SSO、停用或删除 Provider 在同一工作区行锁下校验，不能并发移除最后一个
  可用 Provider。
- 提供显式 owner 恢复登录。仅密码验证后的 owner 可绕过有效 SSO，仍需 MFA；恢复标记
  进入签名 MFA token 和登录审计。成员即使提交同一字段也继续被拒绝。
- 开启强制 SSO 前确认工作区存在未停用且保留本地密码的 owner，避免恢复入口不可用。

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
已决定 Markdown 只导出语言和代码，显示属性允许降级，不发明私有 Markdown 语法。
详细实现见 [`code-block-mcp-design.md`](./code-block-mcp-design.md)。

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

实际公开访问面清单：

| 公开面                        | 入口                                      | 统一保护方式                         |
| ----------------------------- | ----------------------------------------- | ------------------------------------ |
| 分享跳转与信息                | `POST /api/shares/info`                   | `ShareAccessGuard`                   |
| 页面及继承分享                | `POST /api/shares/page-info`              | `ShareAccessGuard`                   |
| 子页面树                      | `POST /api/shares/tree`                   | `ShareAccessGuard`                   |
| PostgreSQL/Typesense 分享搜索 | `POST /api/search/share-search`           | `ShareAccessGuard`                   |
| SEO/OG HTML                   | `GET /share/.../p/...`                    | `ShareAccessService`，未解锁不出标题 |
| 页面附件                      | `GET /api/files/public/...`               | share/version 绑定的附件 JWT         |
| 嵌入                          | 复用上述页面、树和附件入口                | 不增加独立旁路                       |
| 导出                          | `/api/pages/export`、`/api/spaces/export` | 保持 JWT、页面权限和审计，不是公开面 |

Guard 在返回密码状态前先检查 workspace/space 分享策略、页面删除状态和受限祖先，
避免已禁用或已受限资源通过 `401` 暴露。附件 JWT 同时绑定 attachment、page、share、
workspace 和 password version；修改密码、移除密码、删除分享或切换“包含子页面”都会
使相关旧令牌失效。

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

实现采用每个 `workspace/share/IP` 五分钟首个失败写审计、进程内最多 5000 个采样键；
真正的暴力尝试限制继续使用项目现有 Redis `ThrottlerStorageRedisService`，因此 AIO
内置 Redis 和外置 Redis 多实例拥有同一安全限制。workspace/space 批量禁用分享沿用
既有设置变更审计并在事务中删除分享记录。

### 6.7 验证式邮箱修改

#### 用户价值

用户确实需要修正或迁移登录邮箱，但立即更新会让输错地址、账号劫持和邮件归属
不明变成恢复问题。现有后端基础校验可复用，不能直接把被注释的前端按钮打开。

#### 流程

1. Session 用户提交当前密码和新邮箱，以密码完成本次敏感操作的 step-up。
2. 服务端检查 SSO 策略、唯一性和限流，向新邮箱发送短期确认链接。
3. 数据库只保存 token 的 SHA-256 hash、目标邮箱、过期时间和使用时间。
4. 用户登录后从链接回到个人资料页，显式确认；服务端在事务内再次检查 SSO、
   申请归属、有效期、单次使用和邮箱唯一性。
5. 更新邮箱并标记为已验证，再向旧邮箱发送安全通知。

使用独立 `user_email_change_requests` 表，不复用存放明文 token 的旧模型。
`workspace/user` 唯一约束和 upsert 保证每个用户最多一条申请；重复申请原子轮换
token，使旧链接失效，表规模最多与用户数相同。

| API                                    | 鉴权                     | 说明                     |
| -------------------------------------- | ------------------------ | ------------------------ |
| `POST /api/users/email-change/request` | JWT + Session + password | 创建或轮换一次性申请     |
| `POST /api/users/email-change/confirm` | JWT + Session + token    | 显式确认并完成事务内修改 |

API Key、OAuth 和 MCP 不得修改身份邮箱。强制 SSO 工作区继续禁止本地修改。审计
申请和确认，但不记录 token、密码或完整邮件正文。确认链接不会自动调用 API，避免
邮件安全扫描器触发修改。本次不增加公开确认或取消接口；重复申请即撤销旧链接。
用户 ID 没有改变，现有 Session、API Key 和已授权 OAuth 不会因邮箱字段变化而撤销。

### 6.8 MCP 模块化与可逆维护工具

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

本轮只增加真正可逆的 `trash_page` 和 `restore_page`。两者复用网页端同一页面生命周期
服务，并保留侧边栏 WebSocket、搜索/AI 事件和业务审计。`trash_page` 需要
`mcp:destructive` 与 `confirm: true`；`restore_page` 需要 `mcp:write`。

当前 `delete_comment` 为硬删除，不符合“可逆”目标，本轮明确不实现。后续必须先设计
评论软删除/恢复和保留期，再决定是否向 MCP 开放。

新增 `mcp:destructive` scope，默认不授予旧 API Key、OAuth client 或 grant；不再增加
第二个 owner 总开关，因为现有 workspace MCP mode 与凭据 scope 已形成两层控制。
`confirm: true` 只能改善误操作体验，不能替代权限和 scope。

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
- [x] `DEC-FM-003` 代码块 title/wrap 在标准 Markdown 导出时允许降级，不引入私有语法。
- [ ] `DEC-FM-004` 决定图片 Markdown title 是否映射 caption；建议不自动等同，避免改变既有 title 语义。
- [x] `DEC-FM-005` 新增 `mcp:destructive`；旧凭据默认不具备，不增加重复的 owner 总开关。
- [x] `DEC-FM-006` 空间关系图进入受限 beta；显式使用 Cytoscape 3.33.1（MIT），仅在用户打开空间关系图时动态加载。
- [ ] `DEC-FM-007` 确认 OIDC 首期只支持标准 authorization code + PKCE，不同时承诺 SAML/LDAP/Google。
- [ ] `DEC-FM-008` 确认 OIDC verified email 自动绑定策略；建议默认关闭，owner 显式开启后才允许。
- [x] `DEC-FM-009` 邮箱 request/confirm 均为 Session-only；确认必须显式点击，不增加 public confirm/cancel。

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
- [x] `BUG-FM-003` 阻止没有已注册登录处理器的 SSO Provider 被启用或公开。
- [x] `BUG-FM-004` 统一有效 SSO 判断，恢复历史无效配置并防止并发移除最后可用 Provider。
- [x] `FM-P0-001` 增加能力注册、enable、public data、enforce 和登录路径一致性测试。
- [x] `FM-P0-002` 增加 owner 恢复模式、成员拒绝和 MFA 恢复标记签名测试。

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

- [x] `FM-CODE-001` 为 custom code block 增加兼容的 `title`、`wrap` attrs。
- [x] `FM-CODE-002` 使用现有 NodeView 实现标题编辑、换行开关、下载图标和 tooltip。
- [x] `FM-CODE-003` 实现下载文件名清理、语言扩展名映射和安全默认名。
- [x] `FM-CODE-004` 保持 Mermaid preview/source、复制和只读模式行为。
- [x] `FM-CODE-005` 增加 JSON、HTML、Markdown、Yjs、协作和历史文档兼容测试。
- [x] `FM-CODE-006` 完成长标题、超长代码、响应式布局、只读模式和全部 locale 验收。
- [x] `BUG-FM-010` 修复无标题只读代码块空工具栏和下载文件名残留连续点号。
- [x] `BUG-FM-012` 修复标题回车重复提交和 Escape 取消仍写回的问题。

### 10.6 同步状态

- [ ] `FM-SYNC-001` 盘点 Hocuspocus/Yjs/provider 现有连接和同步事件。
- [ ] `FM-SYNC-002` 建立页面级同步状态 atom，区分已同步、离线、待同步和错误。
- [ ] `FM-SYNC-003` 在标题区域实现安静状态图标、tooltip 和重新连接命令。
- [ ] `FM-SYNC-004` 将 Ctrl/Cmd+S 映射为状态提示/重试，不增加直接数据库保存。
- [ ] `FM-SYNC-005` 与服务器版本更新提示联动，本地待同步时阻止无提示刷新。
- [ ] `FM-SYNC-006` 增加断网恢复、切页、刷新、双标签页和代理重连测试。
- [ ] `FM-SYNC-007` 同步全部 locale，验证移动端不遮挡标题工具。

### 10.7 分享密码

- [x] `FM-SHARE-001` 列出页面、树、附件、搜索、导出、SEO、嵌入全部公开访问面。
- [x] `FM-SHARE-002` 设计并迁移 password hash/version/updatedAt 字段和回滚。
- [x] `FM-SHARE-003` 实现 `SharePasswordService`、`ShareAccessService` 和统一 Guard。
- [x] `FM-SHARE-004` 实现 owner/editor 设置、修改、移除密码 API 与 DTO/scope 校验。
- [x] `FM-SHARE-005` 实现 public unlock 限流和短期 HttpOnly capability Cookie。
- [x] `FM-SHARE-006` 将所有公开面接入 Guard，验证附件和导出不可旁路。
- [x] `FM-SHARE-007` 实现分享管理 UI、访客解锁页、错误/loading 状态和全部翻译。
- [x] `FM-SHARE-008` 增加设置/移除/轮换审计和失败解锁聚合策略。
- [x] `FM-SHARE-009` 增加暴力尝试、Cookie 版本失效、跨 share 重用和并发测试。
- [x] `FM-SHARE-010` 验证 AIO 内置 Redis 与外置 Redis 多实例复用同一共享限流实现。
- [x] `BUG-FM-005` 禁用公开分享或页面受限时先返回 404，不泄露密码保护状态。
- [x] `BUG-FM-006` 新增 share unlock 命名限流器时跳过登录、MFA、Passkey 和 OAuth。
- [x] `BUG-FM-007` “包含子页面”变化时轮换访问版本，撤销旧子页面附件 URL。
- [x] `BUG-FM-008` 拒绝同时提交 shareId/pageId，防止 Guard 与页面查询使用不同目标。

### 10.8 邮箱修改

- [x] `FM-EMAIL-001` 完成 Session-only、密码 step-up、SSO 和账号恢复威胁模型。
- [x] `FM-EMAIL-002` 增加 `user_email_change_requests` migration、每用户唯一约束、容量边界和回滚。
- [x] `FM-EMAIL-003` 实现 Session-only request/confirm DTO、Service 和 Controller。
- [x] `FM-EMAIL-004` token 只保存 SHA-256 hash，并实现过期、单次使用和旧申请失效。
- [x] `FM-EMAIL-005` 确认时锁定 workspace、申请和用户，重新检查 SSO/唯一性并更新已验证邮箱。
- [x] `FM-EMAIL-006` 向新邮箱发送确认，向旧邮箱发送安全通知。
- [x] `FM-EMAIL-007` 恢复账户设置入口，完成 request/confirm/success/error 状态和全部翻译。
- [x] `FM-EMAIL-008` 增加申请/确认审计并确认不记录 token 和密码。
- [x] `FM-EMAIL-009` 增加 API Key/OAuth/MCP 拒绝、SSO 禁止、竞争确认和重放测试。
- [x] `BUG-FM-013` 使用 workspace/user 唯一约束和 upsert，阻止并发申请留下多个有效链接。
- [x] `BUG-FM-014` 使用 URL fragment 和单次 session handoff，阻止确认 token 进入代理日志和登录回跳 URL。
- [x] `BUG-FM-015` 复用已在线使用的标准 `ThrottlerGuard`，避免启用缺少构造依赖验证的未使用 Guard。
- [x] `BUG-FM-016` 将邮箱校验与服务端错误接入 i18next，阻止非英文界面回退为英文错误。

### 10.9 MCP

- [x] `FM-MCP-001` 为当前所有工具生成行为、schema、scope、权限和审计契约清单。
- [x] `FM-MCP-002` 引入强类型 `McpToolDescriptor` 和注册表，不改变外部工具协议。
- [x] `FM-MCP-003` 抽取唯一 `McpToolExecutor`，集中 mode/scope/DTO/ACL/audit/error redaction。
- [x] `FM-MCP-004` 按 page/comment/space/search/member 拆分工具 provider。
- [x] `FM-MCP-005` 增加拆分前后契约测试，确认工具名、输入 schema 和返回内容不变。
- [x] `FM-MCP-006` 在 API Key/OAuth 管理与 consent 中增加 `mcp:destructive`，旧 grant 默认不具备。
- [x] `FM-MCP-007` 实现 `trash_page`，复用页面生命周期服务并触发侧边栏实时更新。
- [ ] `FM-MCP-008` 设计评论软删除/恢复后再抽取核心 CommentDeletionService，本轮不实现。
- [ ] `FM-MCP-009` `delete_comment` 延后，禁止把现有硬删除包装成“可逆”工具。
- [x] `FM-MCP-010` 为破坏性工具增加 MCP annotations、确认交互和越权测试。
- [x] `FM-MCP-011` MCP 活动展示空间、页面路径、标题、目标和凭据名称，不只显示 UUID。
- [x] `FM-MCP-012` 增加 session/API Key/OAuth、只读模式、scope 和审计脱敏矩阵测试。
- [x] `FM-MCP-013` 实现 `restore_page`，复用核心恢复流程并触发侧边栏实时更新。
- [x] `FM-MCP-014` 提交前扫描并阻止个人信息、私有服务器信息和凭据进入 tracked tree。
- [x] `BUG-FM-009` 将既有 Passkey 测试/文档中的私有部署示例替换为保留测试域名。
- [x] `BUG-FM-011` 页面删除/恢复在服务层和递归 SQL 中显式绑定 workspace，阻止跨工作区递归旁路。

### 10.10 空间关系图

- [x] `FM-GRAPH-001` 通过 beta 决策并定义导航、孤立页发现和影响分析三个用户任务。
- [x] `FM-GRAPH-002` 实现 `SpaceGraphModule`、DTO、`POST /spaces/graph` 和导出接口。
- [x] `FM-GRAPH-003` SQL 层过滤 space/page/ancestor/deleted 权限，边只连接可见节点。
- [x] `FM-GRAPH-004` 实现 500 节点上限、中心页/深度过滤和稳定裁剪规则。
- [ ] `FM-GRAPH-005` 用真实数据执行 `EXPLAIN ANALYZE`，按证据决定索引。
- [x] `FM-GRAPH-006` 前端空间视图懒加载，提供搜索、筛选、列表降级和键盘操作。
- [x] `FM-GRAPH-007` 显式引入并双层动态加载 Cytoscape，完成 MIT 许可证和 production bundle 检查。
- [x] `FM-GRAPH-008` 导出图数据时审计，普通查看不逐次写审计。
- [ ] `FM-GRAPH-009` 增加受限页面推断、超大空间、移动端和性能回归测试。
- [x] `BUG-FM-012` 隐藏父页面已删除但自身状态异常的不可达子树，避免其被关系图误判为根页面。
- [x] `BUG-FM-013` 关闭关系图无用框选，在触摸设备禁用节点拖拽并扩大节点和操作按钮的触控目标。
- [x] `BUG-FM-014` 将粗指针操作按钮补足到 44px，并把触摸设备默认图上限从 500 降为 100。

复盘：服务端先校验空间读取权限；中心页按 workspace、space、删除状态和页面级权限
独立校验。递归 SQL 沿页面树传播受限祖先权限，搜索使用转义后的参数，边查询只接收
最终可见节点 ID。导出审计仅保存空间 ID、节点/边数量、中心页 ID 和裁剪状态，不保存
搜索词或页面内容。前端关系图和 Canvas 分两层 `lazy import`；production build 中登录页、
入口 HTML 和普通入口 chunk 均不引用关系图或 Cytoscape。真实 PostgreSQL 查询计划、
大空间和移动端端到端验证仍归 `FM-GRAPH-005/009`，在取得数据前不凭猜测增加索引。

### 10.11 编辑器补充

- [x] `FM-EDIT-001` 为 H4-H6 增加标题子菜单、slash command、快捷键和 ToC 文案。
- [x] `FM-EDIT-002` 增加 H4-H6 Markdown/HTML/JSON/Yjs 和历史文档测试。
- [x] `FM-EDIT-003` 为 image atom 增加 caption attr 和编辑/阅读渲染。
- [x] `FM-EDIT-004` 保持 alt/alignment，并验证 caption 导入导出降级规则。
- [x] `FM-EDIT-005` 实现 Ctrl/Meta 点击链接，覆盖内部、外部、锚点和恶意协议。
- [x] `FM-EDIT-006` 完成新增编辑器文案翻译和移动端/只读/分享页验收。

### 10.12 发布前复盘

- [x] `FM-REL-001` 对本阶段变更执行角色、身份、资源和审计矩阵。
- [x] `FM-REL-002` 执行受影响 client/server test、typecheck、lint 和 build。
- [x] `FM-REL-003` 检查 migration 回滚、AIO 内置 Redis、外置 Redis 和反向代理环境。
- [ ] `FM-REL-004` 使用两个浏览器验证实时更新和旧前端版本提示。
- [x] `FM-REL-005` 更新本文 Todo、实施复盘、用户可见变化和遗留风险。

## 11. 实施复盘

### 2026-07-12：调研转为持续实施设计

- 完成：`FM-BASE-001` 至 `FM-BASE-006`。
- 用户可见变化：无；本次只建立设计和实施约束。
- 鉴权/审计/数据库：未改运行时代码。
- 验证：对照当前 SSO、搜索、Backlink、MCP、编辑器、分享、认证和技术栈代码。
- 新发现缺陷：`BUG-FM-001`、`BUG-FM-002`。当时把“owner 自主启用”错误等同于
  “无需验证登录处理器”，该结论已在后续复盘中纠正。

### 2026-07-12：P0 正确性修复与 SSO 误判撤回

- 完成 Todo：`BUG-FM-001`、`BUG-FM-002`；关闭不适用的 `BUG-FM-003`、
  `BUG-FM-004`、`FM-P0-001` 和 `FM-P0-002`。
- 用户可见变化：SSO 维持原有 owner 自主启用行为，不显示额外的不可用提示，也不
  禁止开关。搜索建议在不同用户/群组/页面、空间和 limit 上下文间不再误用缓存。
- 前端实现与兼容：搜索建议 cache key 使用完整规范化上下文；误加的 SSO 控件和
  12 个 locale 提示已撤回。
- 后端鉴权与资源边界：SSO 原有 owner-only、workspace 绑定和 DTO 校验不变；没有
  引入 Provider 类型名单或 core/EE 新依赖。
- 审计与敏感数据：无新增凭据和数据库字段；现有 SSO 创建、更新、删除审计不变。
- 数据库迁移与回滚：无迁移。`BacklinkRepo` 只更新 `backlinks` 指定 ID。
- 测试和人工验证：Backlink 与搜索回归测试保留；撤回后重新执行相关测试和构建。
- 遗留风险和下一步：具体 SSO 协议实现按独立功能评估，不再作为当前 P0 缺陷处理。

> 后续纠正：本段把用户“从未使用 SSO”误读为“问题不存在”，并据此撤回了有效的
> 服务端保护。`BUG-FM-003/004` 已重新打开、按模块化能力注册方式修复，以下复盘为
> 当前结论。

### 2026-07-12：SSO 能力校验与锁死恢复重做

- 完成 Todo：`BUG-FM-003`、`BUG-FM-004`、`FM-P0-001`、`FM-P0-002`。
- 用户可见变化：owner 可以保存暂不支持的 Provider 配置，但启用开关会显示“登录不可用”；
  没有可用 Provider 时不能开启强制 SSO。登录页提供显式的 owner 恢复登录入口。
- 前端实现与兼容：沿用 React、Mantine、TanStack Query 和 i18next；能力状态完全来自
  服务端。恢复登录只显示密码表单，不提供忘记密码或 Passkey 捷径，文案覆盖 12 个 locale。
- 后端鉴权与资源边界：新增全局能力注册和有效执行服务；密码登录、重置、邀请、邮箱、
  Passkey、公开工作区和统一登录流不再直接信任原始 `enforceSso`。只有实际登录模块能
  注册类型，当前四种类型因无处理器均不可启用。
- 并发与恢复：工作区强制开关和 Provider 停用/删除使用同一工作区行锁；旧无效配置自动
  恢复本地登录。开启前验证 owner 保留本地密码；有效强制 SSO 下只有显式请求且密码
  验证成功的 owner 可恢复，并继续 MFA。
- 审计与敏感数据：Provider 管理审计不变；owner 恢复成功在登录审计中记录布尔标记，
  密码、MFA code 和 Provider secret 不进入日志。
- 数据库与性能：无字段迁移；复用既有 `idx_auth_providers_workspace_id`。没有注册能力时
  直接短路且不查询数据库；未来有能力时每个认证决策只执行一次 workspace Provider 查询。
- 测试和验证：能力注册、旧配置恢复、有效执行、最后 Provider 保护、owner/成员恢复和
  MFA 签名均有回归测试；server 68 个 suite、358 项和 client 11 个文件、96 项通过，
  server/client/editor-ext production build 通过。
- 遗留边界：本次不虚构 OIDC/SAML/LDAP 协议实现；具体 Provider 仍按 10.3 Todo 独立开发。

### 2026-07-12：分享密码与编辑器补充

- 完成 Todo：`FM-SHARE-001` 至 `FM-SHARE-010`、`FM-EDIT-001` 至
  `FM-EDIT-006`、`FM-REL-001` 至 `FM-REL-003`、`FM-REL-005`，以及实施中发现的
  `BUG-FM-005` 至 `BUG-FM-008`。
- 用户可见变化：页面编辑者可在现有分享弹层设置、修改和移除密码；访客在同一分享
  URL 输入密码后继续访问。编辑器增加 H4-H6、图片说明和编辑状态下 Ctrl/Meta 点击
  链接直接新标签打开。
- 前端实现与兼容：沿用 React、Mantine、TanStack Query、Tiptap/Yjs 和 i18next；
  密码只存在于表单状态和 HTTPS 请求体，不进入 URL、Query key 或浏览器存储。新增
  文案已覆盖 12 个 locale。现有分享页、只读编辑器和响应式菜单复用同一组件。
- 后端鉴权与资源边界：设置/修改/移除要求 JWT 或 `rest:write` API Key、workspace
  一致且用户可编辑页面；MCP OAuth 不能调用 REST 管理 API。公开页面、树、搜索、SEO、
  嵌入和附件统一校验 share，导出继续要求登录和页面权限。
- 审计与敏感数据：新增设置、修改、移除和采样失败解锁事件；hash、明文密码和
  capability 均不进入响应或审计。失败解锁按 share/IP 五分钟采样并限制内存键数量，
  暴力尝试由共享 Redis 限流器阻断。
- 数据库迁移与回滚：`shares` 新增 nullable bcrypt hash、非负 version 和 updatedAt；
  down migration 先移除 check 再移除三列。所有公开 repo 投影只返回
  `passwordProtected`。版本使用数据库表达式原子递增，并发修改不会丢失撤销版本。
- 编辑器数据兼容：caption 是独立 image attr，HTML 使用 `figure/figcaption`，JSON 和
  Yjs 无损；旧 `img` 继续解析。标准 Markdown 只输出图片及 alt，明确丢弃 caption，
  不引入私有语法。H4-H6 的 HTML、JSON、Markdown、Yjs 和协作撤销均有测试。
- 测试和人工验证：server 65 个 suite、344 项通过；client 11 个文件、96 项通过；
  编辑器定向 7 项通过；全项目 ESLint 0 error（13 个既有 warning）；editor-ext、server、
  client production build 通过，12 个 locale 键完整性检查通过。
- 性能/部署验证：解锁时才执行 bcrypt，后续为本地 JWT 校验加一次有索引的 share/page
  查询；无新增前端依赖。Cookie 的 `Secure` 继续由 `APP_URL`/反向代理外部 HTTPS 配置
  决定，AIO 内置 Redis和外置 Redis 都复用现有限流存储。
- 新发现 BUG Todo：`BUG-FM-005`（策略泄露）、`BUG-FM-006`（命名限流串扰）、
  `BUG-FM-007`（子页面附件旧 token）、`BUG-FM-008`（双 locator 绕过）均已增加
  Todo、修复并回归。
- 遗留风险和下一步：`FM-REL-004` 的两个真实浏览器部署升级验证不属于本次两项功能，
  仍保持未勾选；上线后可再做一次反向代理下的 Cookie/SEO 人工验收。

### 2026-07-12：代码块增强、MCP 模块化与可逆页面维护（`efba9a38`）

- 完成 Todo：`FM-CODE-001` 至 `FM-CODE-006`、`FM-MCP-001` 至
  `FM-MCP-007`、`FM-MCP-010` 至 `FM-MCP-014`，以及实施中发现的
  `BUG-FM-010`、`BUG-FM-011`、`BUG-FM-012`。
- 用户可见变化：代码块可设置标题、切换视觉换行并下载 UTF-8 源文件；owner 可为
  API Key 或 ChatGPT OAuth 显式授权破坏性 MCP 工具；新增可恢复的页面移入回收站和
  恢复工具。MCP 活动使用现有资源解析展示空间、页面路径和标题。
- 前端实现与兼容：沿用 React、Mantine、Tiptap、Tabler、TanStack Query 和 i18next；
  没有新增依赖。无标题只读代码块保持原有高度，标题单行截断，移动端工具栏换行。
  JSON、HTML 和 Yjs 无损保留 title/wrap，标准 Markdown 按决策只保留代码围栏和源码。
- 后端鉴权与资源边界：`McpService` 只负责协议和 session，20 个原工具按五类 provider
  拆分并统一经过 executor 的 mode、scope、DTO、ACL 和审计模板。页面网页接口和 MCP
  共用 `PageLifecycleService`；服务层及递归 SQL 都显式限制 workspace。
- 审计与敏感数据：页面业务事件和 `mcp.tool_called` 双层审计保留；内容、评论正文、
  token 和凭据不进入 MCP metadata。回收/恢复继续触发搜索、AI 队列和侧边栏 WebSocket。
  最终 tracked tree 和新增行已执行私人部署标记、服务器路径、私钥和常见 token 形态扫描。
- 数据库迁移与回滚：无 schema migration。旧代码块使用默认属性；旧 API Key、OAuth
  client、grant、code、refresh token 都不会隐式获得 `mcp:destructive`。移除新工具时，
  已回收页面仍可从现有网页回收站恢复。
- 测试和人工验证：server 69 个 suite、372 项，client 13 个文件、106 项和 MCP 20 工具
  契约 snapshot 通过；双端 typecheck、ESLint 和 production build 通过。生产启动探测已
  进入数据库 bootstrap，未出现 Nest 依赖解析错误；本机未运行依赖服务，因此未继续监听。
- 性能/部署验证：无新增数据库查询路径；回收/恢复复用现有递归 CTE、事件队列和 WebSocket。
  前端下载只使用本地 Blob URL 并立即释放。无需迁移、外部服务或新增容器。
- 新发现 BUG Todo：`BUG-FM-010`（只读空工具栏/文件名连续点号）、`BUG-FM-011`
  （页面生命周期 workspace 防御纵深）和 `BUG-FM-012`（标题键盘重复/错误提交）均已
  增加 Todo、修复并回归。
- 遗留风险和下一步：`FM-MCP-008/009` 保持未勾选；评论当前是硬删除，在设计并实现
  comment soft-delete/restore 前不得增加 MCP 删除评论工具。
- 详细设计、模块落点、授权方式、工具输入和最终验收记录见
  [`code-block-mcp-design.md`](./code-block-mcp-design.md)。

### 2026-07-12：验证式邮箱修改（本次提交）

- 完成 Todo：`DEC-FM-009`、`FM-EMAIL-001` 至 `FM-EMAIL-009`，以及实施中发现的
  `BUG-FM-013` 至 `BUG-FM-016`。
- 用户可见变化：个人资料页重新开放“修改电子邮箱”；输入当前密码后，新邮箱收到
  30 分钟有效的确认链接。用户登录并显式确认后才会更新，旧邮箱会收到安全通知。
  强制 SSO 工作区显示禁用状态。
- 前端实现与兼容：沿用 React、Mantine、Jotai、React Router、Zod 和 i18next；确认
  链接复用现有个人资料路由，登录重定向会保留回跳参数。链接不会在页面加载时自动
  提交，避免邮件扫描器触发。原始 token 放在 URL fragment 中，不发送给 Web/代理；
  应用启动时把它转存到当前标签页的 sessionStorage 并立即清除地址栏，确认组件读取后
  立即删除。登录回跳只携带不敏感的确认标记。新增文案覆盖全部 12 个 locale，没有
  新增前端依赖。
- 后端鉴权与资源边界：request/confirm 都由 `JwtAuthGuard`、`SessionAuthGuard` 和
  限流保护；API Key 与 MCP OAuth 被服务端拒绝。通用 `UpdateUserDto` 已移除 email 和
  confirmPassword，不能从旧接口旁路。确认事务锁定 workspace、申请和用户，并重新
  检查有效 SSO、用户/工作区绑定、过期、重放和大小写无关的邮箱唯一性。
- 审计与敏感数据：申请记录 `user.email_change_requested`，完成记录
  `user.email_changed`；审计只记录邮箱 before/after，不记录密码、原始 token、token hash
  或邮件正文。数据库和普通日志也不保存原始 token。
- 数据库迁移与回滚：新增 `user_email_change_requests`。token 仅保存 SHA-256 hash；
  workspace/user 唯一约束配合 upsert 原子轮换旧申请，表规模最多与用户数相同。回滚
  删除申请表，不回退已经确认的用户邮箱。
- 测试和人工验证：server 71 个 suite、380 项，client 15 个文件、113 项全量通过；
  双端 TypeScript 通过。覆盖 Session Guard、API Key/MCP OAuth 拒绝、SSO、token hash、
  并发确认、重放、通用更新旁路、fragment token handoff、显式确认和 SSO 前端状态。
  双端 production build 通过；服务端启动探测通过 Nest 依赖装配并进入数据库/Redis
  初始化，本机未运行依赖服务，因此未执行端到端邮件确认。
- 性能/部署验证：申请和确认均使用有界索引查询；确认邮件复用现有 BullMQ 邮件队列，
  AIO 和外置部署不增加新服务。新增 migration 随现有启动迁移流程执行。
- 新发现 BUG Todo：`BUG-FM-013`。最初的“删除旧申请再插入”在并发请求下可能留下
  两个有效链接，已改为数据库唯一约束和原子 upsert，并在邮件入队失败清理时同时匹配
  token hash，避免误删更新后的申请。`BUG-FM-014` 修复了查询参数会把原始 token 暴露
  给反向代理访问日志和登录 redirect URL 的问题。`BUG-FM-015` 避免启用未经生产验证
  的自定义限流 Guard，`BUG-FM-016` 补齐了服务端校验错误的全部 locale 翻译。
- 遗留风险和下一步：邮件队列不可用时 request 会失败并清理对应申请；旧邮箱安全通知
  入队失败不会回滚已经完成的身份字段修改，只记录不含邮箱地址的服务端错误。公开
  confirm/cancel 不在本次范围，重复申请用于撤销旧链接。

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
