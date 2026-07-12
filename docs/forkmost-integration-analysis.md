# Forkmost 功能引入评估与实施状态

> 原始调研完成于 2026-07-11，实施状态更新于 2026-07-12。本文同步候选功能的高层结论和
> 当前状态；持续设计、决策、Todo 和实施复盘以
> [`forkmost-integration.md`](./forkmost-integration.md) 为准。

## 1. 评估信息

- 评估日期：2026-07-11
- 状态更新：2026-07-12
- 当前分支：`feat/native-database-fusion`
- Forkmost 分支：`personal`
- Forkmost 评估提交：`a408d8208b2ddfc6104b1656615f721ac9f55f2c`
- Forkmost 状态：2026-05-19 归档并宣布 EOL
- Forkmost 最新发布：`v0.70.2.0`
- 来源：https://github.com/Vito0912/forkmost

Forkmost 与当前项目的版本、企业模块、权限模型和数据库迁移已经有较大差异。不建议合并整个分支。应当提取业务需求，在当前 Docmost 架构中重新实现认证、权限、审计和数据库边界。

Forkmost 使用 AGPL-3.0。直接复制代码必须处理许可证和来源问题，尤其不能未经确认将 AGPL 代码复制到非 AGPL 的企业模块。本文建议以功能需求为依据自行实现。

## 2. 结论和优先级

| 优先级 | 功能                      | 结论                                                 |
| ------ | ------------------------- | ---------------------------------------------------- |
| P0     | SSO Provider 管理安全补全 | 已完成 owner-only、DTO、密钥保护和审计               |
| P0     | SSO 登录能力与锁死保护    | 已完成模块化能力注册、有效强制判断和 owner 恢复      |
| P1     | 公开分享密码              | 已按统一 Guard、短期凭证、限流和审计重新实现         |
| P1     | 成员目录隐私策略          | 应建立统一策略模块，覆盖网页、提及、权限选择器和 MCP |
| P1     | 代码块标题、换行和下载    | 已完成，使用编辑器属性扩展，无新增 API 或数据库迁移  |
| P1     | 用户修改邮箱              | 后端已有基础逻辑，应补成验证式流程                   |
| P2     | MCP 可逆维护              | 工具模块化、页面回收/恢复和审计已完成；评论删除延期  |
| P2     | 空间关系图                | 有价值，需要重新设计权限查询和大空间性能策略         |
| P2     | H4-H6、图片说明           | 已实现，并覆盖 HTML、JSON、Markdown 和 Yjs 兼容测试  |

## 3. P0：SSO Provider 管理安全问题

### 3.1 原问题

原 `apps/server/src/ee/sso/sso.controller.ts` 只有 `JwtAuthGuard` 和 `SessionAuthGuard`，没有 owner 权限校验。前端菜单隐藏不能构成服务端安全边界，登录用户可以尝试直接调用：

- `POST /api/sso/providers`
- `POST /api/sso/info`
- `POST /api/sso/create`
- `POST /api/sso/update`
- `POST /api/sso/delete`

原 `SsoService` 使用 `selectAll()` 并直接返回数据库实体，其中包含：

- `oidcClientSecret`
- `ldapBindPassword`
- `ldapConfig`
- 任意 `settings`

创建和更新接口使用 `body: any`，没有严格 DTO。工作区通用更新接口还允许管理员修改 `enforceSso` 和 SSO 邮箱域名，形成另一条配置旁路。

### 3.2 影响

- 非 owner 可能读取身份提供商密钥。
- 非 owner 可能创建、修改或删除 SSO Provider。
- 非 owner 可能修改 SSO 强制登录和允许邮箱域名。
- Provider URL 如果包含凭据，可能导致凭据进入日志、代理或下游请求。
- 错误配置可能使整个工作区无法正常登录。

### 3.3 已实施修复

- 所有 SSO Provider 管理方法在数据库访问前检查 `UserRole.OWNER`。
- Controller 所有方法都传入当前用户和当前工作区，Service 再执行 owner 和 workspace 绑定校验。
- 新增 `CreateSsoProviderDto`、`UpdateSsoProviderDto` 和 `SsoProviderIdDto`。
- 限制 Provider 类型、UUID、URL 协议、字段类型和字段长度。
- 拒绝包含用户名或密码的 SAML、OIDC、LDAP URL。
- API 不再返回 OIDC client secret、LDAP bind password、LDAP config 和任意 settings。
- API 仅返回 `hasOidcClientSecret` 和 `hasLdapBindPassword`。
- OIDC 和 LDAP 密钥使用基于 `APP_SECRET` 的 AES-256-GCM 加密。
- 已存在的明文密钥在 owner 读取 Provider 时自动升级为密文。
- 密钥更新采用只写语义：留空表示保持不变，输入新值才替换。
- 前端密钥输入框不再回显旧值，OIDC 密钥改为密码输入框。
- SSO 配置区仅 owner 可见。
- `emailDomains` 和 `enforceSso` 加入 workspace owner-only 字段集合。
- 创建、更新、删除 Provider 使用既有 SSO 审计事件。
- 审计只记录 Provider 类型、名称、启用状态和“是否已配置密钥”，不记录密钥值。

### 3.4 数据库兼容性

本次不增加字段和数据库迁移。密文仍保存在原 `oidc_client_secret` 和 `ldap_bind_password` 字段中，并使用 `enc:v1:` 前缀区分。

旧明文值可以继续读取，并在 owner 访问 SSO 设置时进行惰性升级。未来真正实现 OIDC/LDAP 登录模块时，必须通过 `SsoSecretService.decryptStored()` 读取，不能直接使用数据库字段。

### 3.5 SSO 登录能力与工作区锁死

进一步核查发现，当前仓库只有 Provider 管理能力，没有以下实际认证处理器：

- SAML login/callback
- OIDC login/callback
- Google login/callback
- LDAP 登录认证

前端原先仍会为启用的 Provider 生成登录 URL，工作区也只依据数据库中的
`isEnabled=true` 判断能否开启 `enforceSso`。这不是 owner 是否有权自主配置的问题，
而是服务端声明了并不存在的登录能力。错误开启后，本地密码、Passkey 和邀请流程会被
原始 `enforceSso` 阻断，而 SSO 请求落到不存在的路由，可能永久锁死工作区。

已实施修复：

- 新增全局 `SsoLoginCapabilityService`。具体登录模块只有在 Controller 实际装载时才
  注册 Provider 类型和处理器名称，管理模块不维护脱离路由的静态可用名单。
- 当前没有任何登录模块注册能力，因此 SAML、OIDC、Google 和 LDAP 都允许创建和保存
  配置，但不能从关闭切换为启用。
- Provider 管理响应增加 `loginAvailable`；公开工作区只返回已启用且处理器可用的
  Provider，登录页不会再展示无效入口。
- 新增 `SsoEnforcementService`，统一计算“配置强制且存在可用 Provider”。密码登录、
  重置密码、邀请、邮箱修改、Passkey、统一登录流和公开工作区不再直接信任原始布尔值。
- 历史 `enforceSso=true` 但没有登录处理器的配置按未强制处理，恢复本地登录；owner
  登录后仍能关闭旧配置。
- 开启强制 SSO、停用和删除 Provider 复用同一工作区行锁，防止并发移除最后一个可用
  Provider。
- 开启前确认存在未停用且保留本地密码的 owner。有效强制 SSO 下提供显式 owner 恢复
  登录，必须验证密码并继续 MFA；成员提交相同字段仍会被拒绝。
- owner 恢复状态进入签名 MFA token，只有服务端确认实际使用恢复路径后，登录审计才
  记录 `ownerRecovery=true`。

该实现不等于已经支持 SSO 协议。未来 OIDC/SAML/LDAP 模块必须注册能力后才会自动进入
现有启用、公开展示和强制登录判断，无需在多个 Controller 重写分支。

## 4. 公开分享禁用语义

当前“禁用公开分享”会删除现有分享记录。经产品语义确认，这是有意的凭据撤销行为：

- 分享链接等价于公开访问 token。
- 一旦链接泄露，禁用公开分享应撤销旧 token。
- 重新启用后生成新链接，旧链接不能恢复。
- 这相当于 token rotation，而不是临时暂停。

因此该行为不属于 P0，也不建议改为“重新启用后恢复旧链接”。现有删除逻辑保持不变。

已完成和可继续补充的改进：

- 前端明确提示“所有现有分享链接将永久失效”。
- 工作区/空间策略修改沿用设置审计，并在事务中批量撤销分享。
- 后续可以增加批量撤销数量，但不能记录分享 token。

## 5. 公开分享密码

### 5.1 业务价值

允许用户为公开链接设置第二层访问凭据，适合向客户、供应商或临时协作者分享文档。

### 5.2 已实施模块

已在 `apps/server/src/core/share` 增加：

- `share-access.service.ts`
- `share-access.guard.ts`
- `share-password.service.ts`
- 解锁 DTO、限流器和测试

分享访问控制是核心读取边界，不能只在前端处理。

### 5.3 安全和数据库实现

- `shares` 增加 `password_hash`、`password_version`、`password_updated_at`。
- `POST /api/shares/unlock` 校验密码并签发短期 HttpOnly Cookie。
- 凭证绑定 `shareId` 和 `passwordVersion`，修改密码后旧凭证自动失效。
- 密码不能进入 URL、React Query key、localStorage 或 sessionStorage。
- API 只返回 `passwordProtected: boolean`，不能返回密码哈希。
- 页面信息、子页面、树、附件、分享搜索、嵌入和 SEO 使用统一分享访问判断。导出仍是
  登录态能力，继续校验 JWT/API Key 和页面权限，不作为公开分享接口绕过 Guard。
- 解锁使用独立命名的 Redis 限流器。AIO 复用内置 Redis，外置部署复用配置的 Redis，
  多实例共享计数。

设置、修改和移除密码要求页面编辑权限和 REST 写 scope。审计记录设置、修改、移除和
采样的失败解锁；密码明文、hash 和 capability 不进入响应或审计。修改密码、取消密码、
修改 `includeSubPages` 都会轮换版本，使旧 Cookie 和旧附件 token 失效。

实现过程中还补齐了以下绕过：

- 在密码挑战前检查工作区/空间分享策略、页面删除状态、受限祖先和 workspace 绑定，
  防止通过错误码探测受保护资源。
- 拒绝同时提交 `shareId` 和 `pageId`，避免双 locator 目标错配。
- 旧附件 token 必须绑定 share 和 password version；未绑定的遗留公开 token 直接拒绝。
- 密码只存在于表单状态和 HTTPS 请求体，不进入 URL、React Query mutation cache 或
  浏览器存储。

Forkmost 将密码放入 `sessionStorage` 并在内容请求中反复传递，还把 `passwordHash` 暴露给前端类型，因此不能直接复制。

## 6. 成员目录隐私策略

建议增加 `DirectoryVisibilityPolicy`，支持：

- `workspace`：工作区成员互相可发现。
- `shared-spaces`：只显示存在共同有效空间权限的成员。
- `admins-only`：普通成员不能浏览目录。

统一应用到成员搜索、@提及、页面权限选择器、评论提及、群组成员和 MCP。不能在多个 Repo 中分别写不同过滤规则。

策略保存在 workspace settings JSON。普通目录接口只返回 ID、名称和头像，默认不返回邮箱。只审计策略变更，不审计每次搜索。

当前管理成员接口和 MCP `list_workspace_members` 已要求 `Manage Member`，应保持服务端限制。

## 7. 代码块增强

已完成以下能力：

- 代码块标题
- 自动换行开关
- 下载按钮

实现位于 `packages/editor-ext/src/lib/custom-code-block` 和客户端 Code Block NodeView。
`title`、`wrap` 使用 ProseMirror 属性保存，不需要数据库迁移和新 API。

已落实的安全和兼容约束：

- 下载文件名会过滤路径分隔符、控制字符、路径穿越片段和保留名称，并限制总长度。
- HTML、JSON、Yjs、协同编辑和历史文档会保留或兼容新增属性。
- 标准 Markdown 只导出语言和源码，`title`、`wrap` 按设计降级，不引入私有语法。
- 自动换行只改变显示，不修改源码；复制和下载始终使用原始 UTF-8 文本。
- Mermaid 源码/预览、复制和双击行为保持不变，未增加重复的全局监听器。
- 编辑、只读、长标题、超长代码和移动端工具栏均有对应测试。

编辑器变更由页面历史和协作更新覆盖，不需要独立业务审计。
完整设计、实现位置和验证记录见
[`code-block-mcp-design.md`](./code-block-mcp-design.md)。

## 8. 用户修改邮箱

当前后端已有密码校验、SSO 限制、邮箱唯一性检查和审计，但前端入口和提交逻辑未启用。

建议采用验证式流程：

1. 用户输入当前密码和新邮箱。
2. 服务端向新邮箱发送短期确认链接。
3. 数据库只保存 token 哈希和过期时间。
4. 用户确认后在事务中检查唯一性并更新邮箱。
5. 给旧邮箱发送安全通知。

建议接口：

- `POST /api/users/email-change/request`
- `POST /api/users/email-change/confirm`

只允许 Session 登录，不允许 API key 或 MCP 修改身份邮箱。SSO 强制工作区继续禁止本地修改。审计申请和最终修改，不记录 token。

## 9. MCP 可逆删除和模块化

MCP 工具模块化和可逆页面维护已经完成。`McpService` 只保留协议与会话生命周期；
工具注册、执行和访问逻辑已拆分为：

- `tools/page.tools.ts`
- `tools/comment.tools.ts`
- `tools/space.tools.ts`
- `tools/search.tools.ts`
- `tools/member.tools.ts`
- `mcp-tool-registry.service.ts`
- `mcp-tool-executor.service.ts`
- `mcp-tool-access.service.ts`

原有 20 个工具由强类型 `McpToolDescriptor` 描述，并通过契约快照锁定工具名称、顺序、
schema、scope、annotations 和 DTO 策略。所有工具继续统一执行 DTO、workspace 绑定、
MCP 模式、scope、CASL、页面权限、成功/失败审计和敏感参数清理。工具 provider 不能
绕过统一 executor，也不能直接写数据库表。

已新增：

- `trash_page`：只移入回收站，需要显式 `mcp:destructive`、read-write 模式、页面编辑
  权限和字面值 `confirm: true`。
- `restore_page`：恢复回收站页面，需要 `mcp:write`、read-write 模式以及空间和页面
  编辑权限。

API Key 和 OAuth 均支持 `mcp:destructive`，但默认预设、现有凭据、现有授权和旧 grant
不会自动获得该作用域。OAuth 客户端必须重新请求作用域并由用户重新授权。只读工作区
模式始终拒绝破坏性操作。

网页接口与 MCP 共用 `PageLifecycleService`，统一处理 workspace 绑定、页面与空间权限、
后代页面回收/恢复、分享撤销、搜索/AI 事件、业务审计和侧边栏 WebSocket 更新。

审计保存工具名、认证类型、凭据 ID、空间、页面路径、标题快照、目标 ID 和结果，不保存文档全文、OAuth token 或 API key。

`delete_comment` 未实现。当前评论操作是硬删除，在完成评论软删除、恢复和保留期设计前，
不能把它包装成“可逆” MCP 工具。该延期是明确的安全边界，不是遗漏。

完整设计、授权流程和验证记录见
[`code-block-mcp-design.md`](./code-block-mcp-design.md)。

## 10. 空间关系图

增加独立 `SpaceGraphModule`，前端作为空间视图懒加载，避免图形库进入登录页和普通编辑页首屏 bundle。

`POST /api/spaces/graph` 必须：

- 要求登录和 `REST_READ`。
- 校验空间读取权限。
- 在 SQL 层过滤页面级权限、受限祖先和回收站页面。
- 限制节点数量，支持按中心页面展开或服务端裁剪。
- 不能先查询完整图再在 Node.js 中过滤。

前端布局使用 Worker 或严格节点上限。增加索引前使用真实数据执行 `EXPLAIN ANALYZE`，重点检查 pages 的 workspace/space/deleted 组合和 backlinks 的 source/target 索引。

普通查看不逐次写审计；导出关系图时记录审计。任何缓存键都必须包含用户权限指纹和页面树版本。

Forkmost 的实现一次返回整个空间，未过滤删除页面和页面级权限，不适合直接使用。

## 11. 编辑器小功能

H4-H6、图片说明和链接快捷打开已完成：

- H4-H6 已接入 slash menu、固定工具栏、bubble menu 和目录，并覆盖 HTML、JSON、
  Markdown、Yjs 同步和协作撤销。
- 图片 caption 使用既有 image 节点的独立属性，不新增节点类型。HTML 使用
  `figure/figcaption`，JSON 和 Yjs 无损；旧 `img` 保持兼容。
- 标准 Markdown 继续只输出图片和 alt，明确丢弃 caption，不引入 Docmost 私有语法。
- 编辑状态下 Ctrl/Meta 点击安全 URL 会以 `noopener,noreferrer` 打开新标签；普通点击
  仍显示链接预览，只读模式保持原行为，并拒绝 `javascript:`、`data:` 等危险协议。
- 依赖现有前端版本检测，旧标签页收到服务器更新提示后由用户刷新再继续编辑。

浮动图片暂不建议。CSS float 在移动端、表格、列布局和导出中的复杂度高，收益低于明确的左、中、右对齐属性。

## 12. 已有功能，无需重复引入

当前项目已经拥有：

- 音频块
- PDF 块和附件索引
- 列布局
- 表格富内容
- Highlight
- 搜索和替换
- 拼写检查偏好
- 页面宽度偏好和分享页宽度
- 上标和下标
- 页面提及锚点
- 导出文件名清理
- Web App manifest 和安装图标

不建议增加完整 Service Worker 离线缓存。它会放大部署后的旧 JS 缓存问题，并与 Yjs 协作、断线编辑和服务器版本更新提示冲突。

## 13. 不建议引入

| 功能或实现              | 原因                                             |
| ----------------------- | ------------------------------------------------ |
| Forkmost 整体合并       | 版本旧、项目 EOL、迁移和企业模块不兼容           |
| 原样复制公开分享密码    | 密码重复传输、前端存储、哈希暴露、缺少统一 Guard |
| 原样复制 OIDC           | 状态可降级到实例内存，与当前 Provider 模型不一致 |
| 原样复制空间关系图      | 未过滤删除页面和页面级权限，全量加载风险高       |
| 强制保存                | 容易误导持久化状态，并制造重复历史或竞争写入     |
| 完整离线 Service Worker | 缓存旧前端并增加协作冲突                         |
| 永不过期 API key 修补   | 长期凭据风险高，当前项目要求显式过期             |
| 浮动图片                | 移动端、导出和复杂布局成本高                     |

## 14. 推荐实施顺序

1. `[已完成]` SSO Provider owner-only、DTO、密钥保护、能力注册、锁死恢复和审计。
2. `[已完成]` 公开分享密码和统一分享访问判断。
3. `[已完成]` H4-H6、图片说明和 Ctrl/Meta 点击链接。
4. `[已完成]` 代码块标题、换行、下载及兼容性测试。
5. `[已完成]` 无行为变化拆分 MCP 工具，并增加受控的页面回收与恢复工具。
6. `[待实施]` `DirectoryVisibilityPolicy` 和验证式邮箱修改。
7. `[待实施]` 权限过滤、限量加载的空间关系图。
8. `[延期]` 评论软删除、恢复和保留期设计完成后，再评估 MCP 评论删除工具。

每个阶段都应包含角色矩阵、服务端越权、API key scope、MCP scope、审计内容、数据库迁移/回滚和前端可见性测试。前端菜单可见性只能改善体验，不能代替服务端权限校验。

## 15. 当前验证与剩余边界

截至 2026-07-12：

- SSO Provider 管理安全由 `179f9c0a` 完成；SSO 能力校验和锁死恢复由 `5e5b4bf6`
  重新实现。中间曾错误撤回能力保护，原因是把“owner 自主决定是否启用”与“服务器
  是否存在登录处理器”混为一谈，当前文档和代码均已纠正。
- 分享密码、H4-H6、图片 caption 和链接快捷打开由 `dba1f23e` 完成。
- 代码块增强、MCP 模块化、`trash_page`、`restore_page` 和页面生命周期复用由
  `efba9a38` 完成。
- 最新全量验证为：服务端 69 个 suite、372 项；客户端 13 个文件、106 项。editor-ext、
  server 和 client 的 TypeScript 与 production build 通过，ESLint 无错误，新增文案
  覆盖全部 12 个现有 locale。
- SSO 能力重构不增加数据库字段，复用既有 `idx_auth_providers_workspace_id`；分享密码
  使用独立 migration 增加 hash、version 和 updatedAt。
- 代码块和 MCP 本轮不增加数据库 migration。代码块属性存于 ProseMirror JSON；
  `mcp:destructive` 存于现有 scope 数组，旧凭据和授权不会隐式扩权。
- 当前仍然没有可工作的 OIDC、SAML、Google 或 LDAP 登录处理器，所以这些 Provider
  在 UI 中显示“登录不可用”，也不能启用。这是符合代码事实的保护，不是协议实现。
- 下一项 SSO 工作应从标准 OIDC authorization code + PKCE 开始，并完成 state、nonce、
  redirect、账号绑定、verified email、SSRF/超时和失败审计后，再由 OIDC 模块注册能力。
- 成员目录隐私、验证式邮箱修改和空间关系图仍未实施。评论软删除/恢复也尚未设计，
  因此 MCP 不提供评论删除。不能因 Forkmost 存在对应代码就视为当前项目已有能力。
