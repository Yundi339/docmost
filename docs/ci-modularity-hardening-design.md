# CI 与模块化治理设计

> 状态：已完成
> 范围：CI 发布门禁、MCP OAuth 模块化与数据一致性、协同编辑连接生命周期、模块边界约束  
> 原则：先证明有必要，再修改；每项实现与本文 Todo、测试和复盘同步提交。

## 1. 背景和目标

近期功能已经覆盖 MCP、OAuth、目录隐私、空间关系图、邮箱变更、受保护分享和协同状态。复查结果表明，大部分功能遵守了现有 NestJS、Kysely、React、TanStack Query、Jotai、Vitest/Jest 技术栈，但存在三类需要治理的问题：

1. 生产和 Release 工作流会构建 TypeScript，却没有在发布镜像前执行 ESLint 和自动化测试；现有 JavaScript Action 还停留在旧的 Node 运行时版本。
2. OAuth 单个 Service 同时承担协议、Provider、客户端管理、授权和令牌职责；动态注册数据使用 JSON 整体更新，活动授权使用“先查再插”，并发下缺少数据库不变量。
3. 普通页面编辑器和数据库记录页编辑器各自创建、重连和销毁协同 Provider，行为已经出现差异，主编辑器还会在 React render 阶段调用 `attach()`。

本计划不引入新的业务框架，不改变现有 OAuth URL、MCP scope、登录方式、编辑器协议或部署拓扑。目标是降低安全关键代码的修改面，并让发布产物有可验证的质量门禁。

## 2. 隐私和仓库边界

以下内容禁止进入代码、文档、测试快照、工作流日志和 Git 历史：

- 个人姓名、邮箱、账号、令牌和密钥；
- 真实公网域名、IP、SSH 信息、端口映射和服务器目录；
- Registry、对象存储、证书或生产环境变量的真实值；
- OAuth 授权码、Refresh Token、Access Token、API Key 和页面正文。

测试只使用保留域名（如 `example.test`）、RFC 5737 文档 IP、虚构 UUID 和占位配置名。提交前必须扫描已暂存 diff 和新增文档；扫描结果只报告命中位置，不输出潜在密钥值。

## 3. 现状决策

### 3.1 必须修改

| 项目                   | 必要性                                                 | 决策                                                                     |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Action Node 运行时     | GitHub 已弃用旧 Action Node 运行时，现有工作流产生告警 | 升级到支持 Node 24 的 Action major                                       |
| 发布前验证             | Docker build 不能证明权限和协议行为                    | 新增可复用 verify workflow，生产和 Release 必须依赖它                    |
| OAuth 并发授权         | 活动授权缺少数据库唯一约束                             | 迁移去重、撤销重复令牌、增加 partial unique index 和原子 upsert          |
| OAuth DCR 存储         | JSON read-modify-write 会丢失并发更新                  | 建立注册客户端表，在事务和父客户端锁内注册                               |
| OAuth 模块边界         | 新 Provider 会修改安全核心的多处逻辑                   | 保留一个 Nest Module，拆分职责 Service，并建立 Provider adapter registry |
| 协同 Provider 生命周期 | 两套实现已产生 attach、stateless 和清理差异            | 提取现有 React Hook，不改变 TipTap/Hocuspocus/Yjs 技术栈                 |

### 3.2 不修改或不扩大范围

- MCP 工具注册、访问策略、执行和审计已经模块化，本计划不再次重构。
- `DirectoryModule`、`SpaceGraphModule`、邮箱变更和受保护分享边界清晰，不按文件行数机械拆分。
- AIO 应用继续使用项目当前 Node LTS；GitHub Action 的 Node 24 运行时不要求业务镜像同步升级。
- 本计划只保留 ChatGPT Provider，不虚构其他 Provider 的协议规则和界面。
- 不引入 dependency-cruiser、Nx boundary 插件或新的状态管理库；先使用 ESLint 内建规则保护明确的依赖方向。
- 不改变 OAuth endpoint、MCP resource、scope 默认值、授权同意流程和现有审计脱敏策略。

## 4. CI 设计

### 4.1 可复用验证工作流

新增 `.github/workflows/verify.yml`，支持 `workflow_call`、Pull Request 和手动触发。验证 job 使用仓库 `packageManager` 声明安装 pnpm，并执行：

1. `pnpm install --frozen-lockfile`；
2. `pnpm version:check`；
3. `pnpm lint`；
4. 构建服务端测试依赖的 `@docmost/editor-ext`；
5. 服务端 Jest；
6. 客户端 Vitest；
7. `pnpm build`。

生产工作流和 Release 工作流均以 reusable workflow job 为前置依赖。Registry 登录、镜像构建、产物上传和 Release 创建只能在验证成功后执行。

### 4.2 权限和供应链

- verify 只授予 `contents: read`，不读取生产 secrets。
- 生产 secrets 仅在通过验证后的生产 environment job 中可见。
- 升级 checkout、setup-node、pnpm setup、Docker 和 artifact/release Action 到支持 Node 24 的 major。
- 本轮保持仓库现有 major tag 更新模式；Action SHA 固定需要配套 Dependabot 更新机制，作为独立供应链策略评审，不与行为整改混做。

## 5. OAuth 后端设计

### 5.1 模块结构

继续使用单个 `OAuthModule`，避免为每个类创建无价值的 Nest Module。模块内部职责如下：

| 组件                        | 职责                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| `OAuthService`              | 兼容 Facade；保留 Controller/MCP Guard 的稳定调用面，不包含业务实现 |
| `OAuthMetadataService`      | canonical issuer、workspace 解析、metadata、WWW-Authenticate        |
| `OAuthClientService`        | owner 客户端管理、DCR、注册客户端读取、客户端 metadata 获取         |
| `OAuthAuthorizationService` | consent 预览/批准/拒绝、授权列表/撤销、原子授权 upsert              |
| `OAuthTokenService`         | authorization code、PKCE、refresh rotation、access token validation |
| `OAuthProviderRegistry`     | 按 Provider ID 查找 adapter；未知 Provider 默认拒绝                 |
| `ChatGptOAuthProvider`      | ChatGPT redirect URI 和默认客户端配置规则                           |
| `oauth-protocol.utils.ts`   | scope、resource、URL、PKCE、token hash 等无状态协议函数             |

Provider adapter 只能定义外部客户端特有规则，不能自行绕过 workspace MCP mode、scope、用户状态、授权状态和审计。

### 5.2 注册客户端表

新增 `oauth_registered_clients`：

| 字段                             | 约束                                                  |
| -------------------------------- | ----------------------------------------------------- |
| `id`                             | UUID 主键                                             |
| `oauth_client_id`                | `oauth_clients` FK，级联删除；由父记录唯一确定工作区  |
| `client_id`                      | 全局唯一、不记录 secret                               |
| `client_name` / `client_uri`     | 展示 metadata                                         |
| `redirect_uris`                  | `text[]`，最多 10 个，应用层限制单项长度              |
| `grant_types` / `response_types` | `text[]`                                              |
| `token_endpoint_auth_method`     | 当前只允许 `none`                                     |
| `scopes`                         | `text[]`，仍受 workspace mode 和 owner allowlist 限制 |
| `created_at` / `updated_at`      | 审计时间                                              |

迁移从 `oauth_clients.settings.dcrClients` 回填。注册表不重复保存 `workspace_id`，避免子记录与父 OAuth 客户端出现工作区不一致；运行时通过 `oauth_client_id` 外键和父记录确定工作区。注册在事务内锁定所属 `oauth_clients` 行，按 redirect URI 集合复用现有客户端，避免并发重复和 JSON 丢失更新。表中最多保留 50 条，达到上限时拒绝新注册而不是静默删除仍可能在使用的客户端。

旧 JSON 数据在迁移后保留一个版本，便于旧镜像回滚读取；新代码不再把 JSON 作为权威来源。down migration 将表数据重新写回 JSON 后再删表。

### 5.3 活动授权唯一性

活动授权身份由以下字段定义：

`workspace_id + user_id + client_id + resource + revoked_at IS NULL`

迁移先保留每组最新授权，将其他重复授权及其 Refresh Token 标记撤销，再创建 partial unique index。批准授权使用 PostgreSQL `ON CONFLICT ... WHERE revoked_at IS NULL DO UPDATE`，从数据库层消除并发窗口。

### 5.4 令牌和审计

- 授权码继续使用 hash 存储并通过条件更新保证一次消费。
- Refresh Token 继续旋转；旧 token 的并发重放只能有一个成功。
- access token validation 继续检查 workspace、用户、client、resource、scope 和授权状态。
- `lastUsedAt` 只有距上次记录超过 5 分钟时才更新，避免每次 MCP 请求写数据库。
- 审计只记录 Provider、client ID 的截断值、scope、redirect host、授权用户 ID 和结果，不记录完整 URL query、token、code verifier 或页面内容。

## 6. OAuth 前端设计

现有 Owner 和账户页面保留 Mantine、TanStack Query 和 i18next。新增轻量 Provider descriptor registry，集中定义 Provider 名称、支持状态和图标；页面按服务端返回 Provider 渲染，不再分别硬编码 `find(provider === "chatgpt")`。

本轮用户可见行为不变：仍只有 ChatGPT OAuth。结构变化使未来新增 Provider 时不需要复制 Owner/账户页面逻辑。所有新文案必须加入现有语言资源，不使用代码内不可翻译字符串。

## 7. 协同编辑前端设计

新增 `useCollaborationProvider()`，统一管理：

- collaboration token 和过期刷新；
- Y.Doc、`IndexeddbPersistence`、Hocuspocus socket/provider 创建；
- local/remote synced 和 connection status；
- stateless handler（可选）；
- 页面切换、空闲隐藏、重连和销毁；
- `attach()` 仅在 effect 中执行一次；
- 保存快捷键需要的同步命令。

Hook 返回稳定的 remote provider、ready/synced/status 和 `handleSaveShortcut`。普通编辑器继续处理页面 cache 的 stateless 消息；嵌入编辑器继续处理记录页保存和 `onEditorReady`，这些属于各自 UI，不进入共享 Hook。

## 8. 模块边界约束

先建立能够被当前代码满足、且不会制造大规模历史重构的规则：

- 服务端 `core`、`common`、`integrations` 禁止导入 `ee`；企业模块依赖核心能力，核心层不反向依赖企业实现。
- OAuth Provider adapter 禁止导入 Controller、MCP 工具实现或前端代码。
- 协同生命周期只允许编辑器通过共享 Hook 创建 Hocuspocus provider；新增 ESLint restricted import，阻止两个编辑器直接导入底层 provider 和 IndexedDB persistence。

如果规则暴露已有合法例外，必须调整边界或记录精确例外，不能全局关闭规则。

## 9. 测试与验收

### 9.1 OAuth

- metadata 使用 canonical origin，不信任 forwarded host；
- DCR redirect、scope、数量限制和并发注册；
- consent 并发批准只产生一个活动授权；
- authorization code 一次消费、过期、client/resource/redirect 校验；
- PKCE 成功和失败；
- Refresh Token 轮换、并发重放、scope 只能收窄；
- client 禁用、授权撤销、用户禁用后 access token 立即失效；
- metadata document 的 host、HTTPS、端口、重定向、超时、大小和 JSON 校验；
- 审计不包含 token、code、verifier 和 client metadata 正文。

### 9.2 协同编辑

- 每个 page/token 生命周期只 attach 一次；
- 页面切换会销毁旧 local/remote/socket；
- token 过期只重试当前 provider；
- idle hidden 断开、visible 重连；
- 普通页保留 stateless cache 更新，嵌入页不误注册；
- 两个编辑器使用同一个 Hook，render 阶段无副作用。

### 9.3 完成门禁

- ESLint、服务端 Jest、客户端 Vitest、全量 build 通过；
- migration up/down 经过 PostgreSQL 实例验证；
- 工作流 YAML 可解析，production/release 都依赖 verify；
- staged diff 和新增文档通过敏感信息扫描；
- Todo、复盘和实际代码状态一致后才能 commit；全部提交完成后才 push。

## 10. TodoList

Todo ID 创建后不改含义。实现中发现问题必须先新增 `BUG-GOV-NNN`，再修复并勾选。

### 10.1 基线与设计

- [x] `GOV-BASE-001` 审计现有 CI、OAuth、MCP、目录、关系图、邮箱、分享和协同模块边界。
- [x] `GOV-BASE-002` 明确必须修改、不修改、兼容、回滚和隐私边界。
- [x] `GOV-BASE-003` 建立本文、稳定 Todo ID、验收标准和复盘规则。

### 10.2 CI

- [x] `GOV-CI-001` 升级现有 GitHub Action 到支持 Node 24 的 major。
- [x] `GOV-CI-002` 新增 reusable verify workflow，执行版本、lint、服务端测试、客户端测试和 build。
- [x] `GOV-CI-003` 让 production 和 release 在 verify 成功后才接触发布凭据或产物。
- [x] `GOV-CI-004` 验证 workflow 权限、YAML、矩阵构建依赖和失败阻断行为。

### 10.3 OAuth 数据与模块

- [x] `GOV-OAUTH-001` 为 token exchange、PKCE、refresh rotation/replay、失效检查补 characterization tests。
- [x] `GOV-OAUTH-002` 提取协议纯函数、Provider adapter 和 registry，ChatGPT 行为保持不变。
- [x] `GOV-OAUTH-003` 拆分 metadata、client、authorization、token service，保留兼容 Facade。
- [x] `GOV-OAUTH-004` 新增注册客户端表、旧 JSON 回填、事务注册和 down migration。
- [x] `GOV-OAUTH-005` 去重历史活动授权、撤销关联 token、增加唯一索引和原子 upsert。
- [x] `GOV-OAUTH-006` 对授权 `lastUsedAt` 写入做 5 分钟节流并测试。
- [x] `GOV-OAUTH-007` 前端增加 Provider descriptor registry，Owner/账户页不再散落 ChatGPT 查找逻辑。
- [x] `GOV-OAUTH-008` 复核权限、scope、审计脱敏、迁移和 OAuth/MCP 回归。

### 10.4 协同编辑与边界

- [x] `GOV-COLLAB-001` 实现统一 `useCollaborationProvider()` Hook。
- [x] `GOV-COLLAB-002` 普通页和嵌入页迁移到 Hook，移除 render 阶段 attach 和重复生命周期。
- [x] `GOV-COLLAB-003` 增加 attach、切页清理、token 刷新、idle 重连和 stateless 差异测试。
- [x] `GOV-BOUNDARY-001` 增加可落地的服务端 EE 依赖方向 ESLint 约束。
- [x] `GOV-BOUNDARY-002` 阻止编辑器重新直接创建协同底层 Provider，并验证没有历史误伤。

### 10.5 收尾

- [x] `GOV-VERIFY-001` 运行全量 lint、Jest、Vitest 和 build。
- [x] `GOV-VERIFY-002` 使用 PostgreSQL 验证 migration up/down 和并发不变量。
- [x] `GOV-VERIFY-003` 扫描敏感信息、审查 staged diff、确认不包含部署和个人信息。
- [x] `GOV-VERIFY-004` 更新复盘与 Todo，创建有边界的 commits，并在全部完成后 push。

### 10.6 实施缺陷

- [x] `BUG-GOV-001` 修复 OAuth partial unique index 迁移构造器无法引用谓词列的编译错误，使用 Kysely `sql.ref()` 表达数据库列。
- [x] `BUG-GOV-002` 页面编辑器复用组件切换 `pageId` 时重置静态回退和首次连接标记，避免沿用上一页连接展示状态。
- [x] `BUG-GOV-003` 修复独立数据库迁移 CLI 的 `postgres` CommonJS 导入错误，确保构建产物可以执行迁移命令。
- [x] `BUG-GOV-004` 修复 OAuth 数据迁移 UPDATE 别名使用 PostgreSQL 保留关键字导致的 SQL 解析失败。
- [x] `BUG-GOV-005` 校验 access token、授权码和 Refresh Token 关联的 workspace、用户及 OAuth 客户端身份一致，避免只依赖上游签名或写入逻辑维持跨表绑定。
- [x] `BUG-GOV-006` 修复全新 CI runner 在构建 `@docmost/editor-ext` 之前运行服务端 Jest，导致无法解析该工作区包的问题。

## 11. 实施复盘

### 2026-07-13：基线与设计

- 完成：`GOV-BASE-001`、`GOV-BASE-002`、`GOV-BASE-003`。
- 结论：MCP、目录、关系图、邮箱和分享不需要再次拆分；CI、OAuth 和协同 Provider 生命周期存在可证明的问题，进入实施。
- 用户变化：无。本阶段只建立约束和验收证据。
- 新发现 BUG：暂无。

### 2026-07-13：CI 运行时与发布门禁

- 完成：`GOV-CI-001` 至 `GOV-CI-004`。
- 实现：新增 reusable verify workflow；升级 checkout、Node/pnpm setup、Docker build/login/buildx、artifact 和 release Action；production/release 均显式依赖 verify。
- 安全：verify 权限为只读且不接收生产 secrets；生产 Registry 凭据只在验证成功后的 environment job 中使用。
- 验证：三个 workflow 通过 `actionlint 1.7.12`；手动 Release 的 `source_ref` 同时传给 verify 和 build，避免验证与构建提交不一致。
- 用户变化：无。失败的 lint、测试或 build 会在镜像发布前阻断流水线。
- 新发现 BUG：暂无。

### 2026-07-13：OAuth 数据一致性与模块化

- 完成：`GOV-OAUTH-001` 至 `GOV-OAUTH-008`。
- 实现：将原 OAuth Service 拆为 metadata、client、authorization、token 和协议工具，原 Service 保留为 Controller 与 MCP Guard 的兼容 Facade；Provider registry 当前只注册 ChatGPT adapter，未知 Provider 默认拒绝。
- 数据：动态注册客户端迁入独立关系表并由父 OAuth 客户端确定工作区；父行锁、50 条硬上限和全局 `client_id` 唯一约束消除 JSON 并发覆盖。活动授权迁移去重、撤销关联 Refresh Token，并由 partial unique index 与原子 upsert 维持唯一性。
- 前端：Owner 与账户页改用同一 Provider descriptor registry，用户可见入口、scope 和 ChatGPT 行为不变。
- 安全：canonical issuer 不采用请求 Host；redirect、scope、PKCE、resource、client/授权/用户状态校验保持在共享服务；审计测试确认不写入 token、authorization code 或 verifier。
- 验证：6 个 OAuth 测试套件共 38 项通过；临时 PostgreSQL 完成全量 migration up/down、旧 JSON 回填、重复授权去重、唯一约束和 down 回写验证。
- 新发现并修复：`BUG-GOV-001`、`BUG-GOV-003`、`BUG-GOV-004`、`BUG-GOV-005`。

### 2026-07-13：协同 Provider 生命周期与边界

- 完成：`GOV-COLLAB-001` 至 `GOV-COLLAB-003`、`GOV-BOUNDARY-001`、`GOV-BOUNDARY-002`。
- 实现：普通页面和数据库记录页共用 `useCollaborationProvider()`；Hook 统一创建、attach、token 刷新、同步状态、空闲断开、重连与销毁，页面继续保留各自的 stateless cache 和 REST 保存职责。
- 边界：服务端核心目录禁止反向导入 EE，OAuth adapter 禁止导入 MCP/Controller；两个编辑器禁止直接导入 Hocuspocus 实例、Yjs 和 IndexedDB persistence。
- 验证：协同 Hook 与既有生命周期测试共 8 项通过；客户端 Provider registry 测试 2 项通过；全量 lint 未产生新增 error。
- 新发现并修复：`BUG-GOV-002`。使用已连接 `pageId` 表达静态回退状态，切页首帧不会沿用上一页连接结果。

### 2026-07-13：本地完成门禁

- 完成：`GOV-VERIFY-001`、`GOV-VERIFY-002`。
- 自动化：全量 ESLint 通过；服务端 81 个 Jest 套件、435 项测试和 1 个 snapshot 通过；客户端 26 个 Vitest 文件、150 项测试通过。
- 构建：editor extension、server 和 client 的生产构建通过，客户端共转换 11,687 个模块。
- 数据库：临时 PostgreSQL 使用 tmpfs，验证全量 up、新迁移数据不变量、down 回写和再次 up；测试容器已删除，未连接现有实例或读取用户数据。
- 隐私：扫描暂存内容和全部待推送提交，真实域名/服务器标识、凭据特征、私钥和服务器绝对路径均无命中；字面邮箱与 IP 仅为保留测试值和回环地址。
- 提交边界：只暂存本文计划涉及的 33 个文件，明确排除工作区原有的系统状态服务修改。
- 待完成：创建有边界的提交、最终 push 和线上 CI 结果确认。

### 2026-07-14：首次线上门禁复盘

- 结果：verify 在服务端 Jest 前失败，生产授权和镜像构建 job 均被阻断，发布凭据未被使用。
- 原因：`@docmost/editor-ext` 的包入口和类型声明指向 `dist`；全新 runner 安装依赖后尚无构建产物，本地则因已有产物没有暴露该顺序问题。
- 处理：新增 `BUG-GOV-006`，在服务端 Jest 前显式构建该工作区包；重新打开 `GOV-CI-004`，必须由下一次线上流水线证明修复有效。
- 用户影响：失败流水线没有发布镜像，也没有更新生产标签。

### 2026-07-14：最终完成复盘

- 完成：`BUG-GOV-006`、`GOV-CI-004`、`GOV-VERIFY-004`，本文 Todo 已全部关闭。
- 线上门禁：全新 runner 依次完成版本校验、lint、工作区测试依赖构建、服务端 Jest、客户端 Vitest 和全量 build；分支授权通过后才执行生产镜像发布。
- 部署核验：运行镜像 revision 与目标提交一致，构建版本采用东八区时间前缀；进程无重启，启动日志无 error，内部和公开健康检查通过。
- OAuth/MCP：受保护资源和授权服务器 metadata 使用 canonical public origin；未认证 MCP 请求返回 401 且包含 OAuth challenge。
- 提交：功能与 CI 修复均使用有边界的提交；并行开发中的代码块、编辑器可编辑状态和系统状态文件保持未暂存，没有混入本计划提交。
- 隐私：最终文档只记录通用验证结论，不包含公网主机、Registry、证书、目录、凭据或个人信息。
