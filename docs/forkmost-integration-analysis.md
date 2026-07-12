# Forkmost 功能引入评估

> 本文是 2026-07-11 的调研快照。持续设计、决策、Todo 和实施复盘以
> [`forkmost-integration.md`](./forkmost-integration.md) 为准。

## 1. 评估信息

- 评估日期：2026-07-11
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
| P0     | SSO Provider 管理安全补全 | 当前存在服务端越权和密钥返回问题，立即修复           |
| P1     | 公开分享密码              | 有价值，但必须重新设计访问凭证、限流和统一 Guard     |
| P1     | 成员目录隐私策略          | 应建立统一策略模块，覆盖网页、提及、权限选择器和 MCP |
| P1     | 代码块标题、换行和下载    | 低风险、高实用性，适合编辑器属性扩展                 |
| P1     | 用户修改邮箱              | 后端已有基础逻辑，应补成验证式流程                   |
| P2     | MCP 移入回收站和删除评论  | 可以增加，但应先模块化 MCP 工具并强化审计            |
| P2     | 空间关系图                | 有价值，需要重新设计权限查询和大空间性能策略         |
| P2     | H4-H6、图片说明           | 可以增加，需保证编辑器和导入导出兼容                 |

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

## 4. 公开分享禁用语义

当前“禁用公开分享”会删除现有分享记录。经产品语义确认，这是有意的凭据撤销行为：

- 分享链接等价于公开访问 token。
- 一旦链接泄露，禁用公开分享应撤销旧 token。
- 重新启用后生成新链接，旧链接不能恢复。
- 这相当于 token rotation，而不是临时暂停。

因此该行为不属于 P0，也不建议改为“重新启用后恢复旧链接”。现有删除逻辑保持不变。

可以补充的非阻塞改进：

- 前端明确提示“所有现有分享链接将永久失效”。
- 审计区分“用户删除单个分享”和“工作区/空间策略批量撤销分享”。
- 审计记录批量撤销数量，但不记录分享 token。

## 5. 公开分享密码

### 5.1 业务价值

允许用户为公开链接设置第二层访问凭据，适合向客户、供应商或临时协作者分享文档。

### 5.2 模块位置

在 `apps/server/src/core/share` 增加：

- `share-access.service.ts`
- `share-access.guard.ts`
- `share-password.service.ts`
- 解锁 DTO、限流器和测试

分享访问控制是核心读取边界，不能只在前端处理。

### 5.3 安全和数据库设计

- `shares` 增加 `password_hash`、`password_version`、`password_updated_at`。
- `POST /api/shares/unlock` 校验密码并签发短期 HttpOnly Cookie。
- 凭证绑定 `shareId` 和 `passwordVersion`，修改密码后旧凭证自动失效。
- 密码不能进入 URL、React Query key、localStorage 或 sessionStorage。
- API 只返回 `passwordProtected: boolean`，不能返回密码哈希。
- 页面、树、附件、搜索、导出和 SEO 统一经过 `ShareAccessGuard`。
- 单机 AIO 使用本地限流，多实例使用 Redis 共享限流。

设置和移除密码要求页面编辑权限和 REST 写 scope。审计设置、移除和版本变化；失败解锁只做聚合或采样，避免审计写放大。

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

建议增加：

- 代码块标题
- 自动换行开关
- 下载按钮

实现放在 `packages/editor-ext/src/lib/custom-code-block` 和客户端 Code Block NodeView。使用 ProseMirror 属性保存，不需要数据库迁移和新 API。

要求：

- 下载文件名过滤路径字符和控制字符。
- 补充 HTML、JSON、Markdown、Yjs 和历史版本测试。
- 明确 Markdown 围栏无法保存全部显示属性时的降级规则。
- 不为每个代码块注册全局 paste 或 selection listener。

编辑器变更由页面历史和协作更新覆盖，不需要独立业务审计。

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

当前 MCP 已有统一的 mode、scope、DTO、页面权限和审计包装器，但工具集中在 `mcp.service.ts`。建议先做无行为变化的拆分：

- `tools/page.tools.ts`
- `tools/comment.tools.ts`
- `tools/space.tools.ts`
- `tools/search.tools.ts`
- `mcp-tool-registry.service.ts`

所有工具继续统一执行 DTO、workspace 绑定、MCP 模式、scope、CASL、页面权限、成功/失败审计和敏感参数清理。

建议新增：

- `trash_page`：只移入回收站，需要 `mcp:write`、read-write 模式、页面编辑权限和 `confirm: true`。
- `delete_comment`：本人评论或空间管理员，并要求对应页面权限。

必须调用现有 PageService 和 CommentService，不能直接写数据库；同时触发侧边栏和评论 WebSocket 更新。

审计保存工具名、认证类型、凭据 ID、空间、页面路径、标题快照、目标 ID 和结果，不保存文档全文、OAuth token 或 API key。

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

H4-H6 和图片说明可作为 P2：

- H4-H6 同步调整 Heading extension、工具栏、目录、样式和导入导出。
- 图片说明包含 caption 和 alt，并保证移动端及导出可访问性。
- 优先增加属性，不随意增加新节点类型，降低旧客户端内容损失风险。
- 依赖现有前端版本检测，旧标签页刷新后再编辑包含新 schema 的页面。

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

1. SSO Provider owner-only、DTO、密钥加密、响应脱敏和审计。
2. 公开分享密码和统一 `ShareAccessGuard`。
3. `DirectoryVisibilityPolicy`。
4. 代码块增强和验证式邮箱修改。
5. 无行为变化地拆分 MCP 工具，再增加可逆删除工具。
6. 权限过滤、限量加载的空间关系图。
7. H4-H6 和图片说明。

每个阶段都应包含角色矩阵、服务端越权、API key scope、MCP scope、审计内容、数据库迁移/回滚和前端可见性测试。前端菜单可见性只能改善体验，不能代替服务端权限校验。
