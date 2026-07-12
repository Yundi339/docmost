# Docmost Passkey 设计与实施清单

## 1. 目标

为 Docmost 网页账户增加 Passkey 注册、登录和凭据管理能力，同时保持现有密码、SSO、MFA、JWT、用户会话、MCP 和公开分享行为兼容。

本文件既是设计文档，也是实施过程的唯一 Todo。每完成一项必须在同一提交中勾选；实施中发现的新缺陷必须追加到“缺陷复盘”后再修复。

## 2. 非目标

- MCP 不接受 Passkey。MCP 继续使用 API Key 或 OAuth Bearer Token。
- 第一阶段不删除密码，也不提供纯 Passkey 账号。
- 第一阶段不在邀请注册过程中创建 Passkey。用户完成注册并登录后再添加。
- 不改变公开分享、匿名阅读、公开附件和阅读模式的鉴权方式。
- 不收集认证器 attestation 证书、设备序列号或生物特征数据。
- 不复制 `alkaidlab_webhook` 中自研的 CBOR、ES256、RS256 或签名验证代码。

## 3. 现有技术栈约束

| 层         | 使用方案                                               |
| ---------- | ------------------------------------------------------ |
| 服务端     | NestJS、Fastify、class-validator、现有 Guard/Decorator |
| 数据库     | PostgreSQL、Kysely、现有 migration/repository 模式     |
| 会话       | 现有 `user_sessions`、Access JWT 和 HttpOnly Cookie    |
| 限流       | 现有 Nest Throttler 与 Redis storage                   |
| 审计       | 现有 `AUDIT_SERVICE`、`AuditEvent`、`AuditResource`    |
| 前端       | React、Mantine、TanStack Query、Axios API client       |
| 状态与翻译 | 现有 hooks/query 模式、i18next 及全部 locale 文件      |
| 测试       | Jest、现有 service/controller/repository spec 结构     |
| WebAuthn   | `@simplewebauthn/server`、`@simplewebauthn/browser`    |

前端 WebAuthn 包必须动态加载，避免增加登录页初始 bundle。服务端和浏览器包使用相同主版本并锁定在 pnpm lockfile。

## 4. 参考实现中保留的业务规则

- 挑战默认 5 分钟过期且只能使用一次。
- 凭据必须同时校验工作区、用户和 challenge 归属。
- 禁用、删除或未验证邮箱的用户不能通过 Passkey 登录。
- 保存并更新 WebAuthn signature counter。
- 保存设备名称、创建时间和最近使用时间。
- 添加、删除和登录均进入审计。
- 不能删除最后一种可用登录方式。
- 凭据变更后处理相关登录会话。

## 5. 不照搬参考实现的部分

- RP ID 和 expected origin 不读取请求 `Host`/`Origin` 作为信任来源。
- 不使用用户名优先并返回 `allowCredentials` 的方式，避免账号和凭据枚举。
- 不限制为 platform authenticator，允许系统 Passkey、密码管理器和安全密钥。
- `userVerification` 使用 `required`，而不是 `preferred`。
- 不使用单进程锁保护 challenge；多实例一致性由 PostgreSQL 原子语句保证。
- 不把 credential ID 当作前端资源 ID。
- 不因为某次 Passkey 验签失败而锁死用户的密码和 SSO 登录。

## 6. 模块边界

### 6.1 服务端

新增 `apps/server/src/ee/passkey`：

- `passkey.module.ts`：模块依赖和导出。
- `passkey.controller.ts`：公开登录 ceremony 与会话内管理 API。
- `passkey.service.ts`：options、verification、策略和事务编排。
- `passkey-origin.service.ts`：从 `DomainService` 计算可信 origin/RP ID。
- `passkey-login.service.ts`：与现有登录完成流程衔接。
- `dto/passkey.dto.ts`：所有请求长度、格式和枚举校验。

新增 `apps/server/src/database/repos/passkey`：

- `passkey-account.repo.ts`
- `user-passkey.repo.ts`
- `passkey-challenge.repo.ts`
- `login-counter.repo.ts`

现有认证流程抽取公共“主认证完成”服务，密码和 Passkey 共用以下逻辑：

- 检查用户状态和邮箱验证。
- 检查工作区强制 SSO。
- 判断用户 MFA 和工作区强制 MFA。
- 生成 MFA pending token 或创建正式 session。
- 更新 `lastLoginAt`。
- 记录统一登录审计。

### 6.2 前端

新增 `apps/client/src/ee/passkey`：

- `services/passkey-service.ts`
- `queries/passkey-query.ts`
- `types/passkey.types.ts`
- `components/passkey-login-button.tsx`
- `components/account-passkey-section.tsx`
- `components/passkey-create-modal.tsx`
- `components/passkey-delete-modal.tsx`
- `lib/passkey-browser.ts`

账户设置页面只负责组合组件，不直接处理 WebAuthn ceremony。

## 7. 数据库设计

### 7.1 `passkey_accounts`

每个用户一个稳定、随机、无个人信息的 WebAuthn user handle。

| 字段           | 类型        | 约束                      |
| -------------- | ----------- | ------------------------- |
| `id`           | uuid        | 主键                      |
| `workspace_id` | uuid        | FK workspaces，cascade    |
| `user_id`      | uuid        | FK users，cascade，unique |
| `user_handle`  | bytea       | 64 随机字节，unique       |
| `created_at`   | timestamptz | not null                  |

不能使用邮箱、用户名、其无盐哈希或可跨系统关联的值作为 user handle。

### 7.2 `user_passkeys`

| 字段              | 类型        | 约束                         |
| ----------------- | ----------- | ---------------------------- |
| `id`              | uuid        | 对前端公开的内部资源 ID      |
| `workspace_id`    | uuid        | FK workspaces，cascade       |
| `user_id`         | uuid        | FK users，cascade            |
| `credential_id`   | text        | 全局 unique，不返回前端      |
| `public_key`      | bytea       | not null，不返回前端         |
| `counter`         | bigint      | 非负，默认 0                 |
| `transports`      | text[]      | 过滤为规范允许值             |
| `device_type`     | varchar     | `singleDevice`/`multiDevice` |
| `backed_up`       | boolean     | not null                     |
| `name`            | varchar(80) | trim 后 1-80 字符            |
| `disabled_at`     | timestamptz | counter 异常时停用凭据       |
| `disabled_reason` | varchar(80) | 仅保存分类原因               |
| `created_at`      | timestamptz | not null                     |
| `updated_at`      | timestamptz | not null                     |
| `last_used_at`    | timestamptz | nullable                     |

索引：`(workspace_id, user_id, created_at desc)`。每个用户最多 10 个凭据。

### 7.3 `passkey_challenges`

| 字段              | 类型        | 说明                                   |
| ----------------- | ----------- | -------------------------------------- |
| `id`              | text        | 32 随机字节 base64url，不使用 UUIDv7   |
| `workspace_id`    | uuid        | 必须绑定工作区                         |
| `user_id`         | uuid        | 登录时可空，注册时必填                 |
| `session_id`      | uuid        | 登录时可空，注册时绑定当前 session     |
| `type`            | varchar     | registration/authentication/management |
| `challenge`       | text        | WebAuthn 随机 challenge                |
| `expected_origin` | text        | ceremony 创建时的可信 origin 快照      |
| `rp_id`           | text        | ceremony 创建时的 RP ID 快照           |
| `expires_at`      | timestamptz | 默认 5 分钟                            |
| `created_at`      | timestamptz | not null                               |

消费必须使用带工作区、类型、过期条件的 `DELETE ... RETURNING`。过期判断使用数据库 `now()`。

### 7.4 `auth_login_counters`

| 字段                | 类型        | 说明                 |
| ------------------- | ----------- | -------------------- |
| `id`                | uuid        | 主键                 |
| `workspace_id`      | uuid        | 工作区               |
| `user_id`           | uuid        | 用户                 |
| `method`            | varchar     | password/passkey/mfa |
| `failure_count`     | integer     | 当前窗口失败次数     |
| `window_started_at` | timestamptz | 窗口起点             |
| `last_failed_at`    | timestamptz | 最近失败             |
| `locked_until`      | timestamptz | 可空                 |
| `updated_at`        | timestamptz | not null             |

唯一约束：`(workspace_id, user_id, method)`。未知用户或未知凭据只使用 Redis IP 限流，不写任意身份数据到数据库。

## 8. WebAuthn 参数

### 注册

- `attestationType: 'none'`
- `residentKey: 'required'`
- `userVerification: 'required'`
- 不设置 `authenticatorAttachment`
- 算法先支持 ES256 和 RS256
- `excludeCredentials` 包含用户已有凭据
- options 浏览器超时 60 秒，服务端 challenge 有效期 5 分钟

### 登录

- 使用 discoverable credentials，不要求先填写邮箱。
- `allowCredentials` 为空，不向未认证调用者暴露 credential IDs。
- 根据 credential ID 查找凭据，再校验 userHandle 与 `passkey_accounts` 一致。
- `expectedOrigin` 和 `expectedRPID` 来自 challenge 快照。
- 要求 user presence 和 user verification。

## 9. Origin、反向代理和域名

自托管实例以 `APP_URL` 为唯一可信公开地址。当前生产环境应计算为：

- expected origin：`https://docs.example.test:23000`
- RP ID：`docs.example.test`

内部 `127.0.0.1:3006`、容器端口 3000 和代理转发头不参与 RP 信任判断。非 localhost 环境必须为 HTTPS。

hostname 改变后旧 Passkey 无法使用；端口改变不改变 RP ID，但 expected origin 会改变。系统状态应显示 Passkey 是否可用、expected origin 和 RP ID，不显示任何凭据数据。

## 10. API 与权限

| API                                          | 鉴权                             | 作用                        |
| -------------------------------------------- | -------------------------------- | --------------------------- |
| `POST /auth/passkeys/authentication/options` | Public + throttle                | 创建登录 options            |
| `POST /auth/passkeys/authentication/verify`  | Public + throttle                | 验签并进入 MFA/session 流程 |
| `POST /passkeys/list`                        | JWT + SessionAuthGuard           | 查看自己的凭据              |
| `POST /passkeys/registration/options`        | JWT + SessionAuthGuard + step-up | 创建注册 options            |
| `POST /passkeys/registration/verify`         | JWT + SessionAuthGuard + step-up | 验签并保存凭据              |
| `POST /passkeys/update`                      | JWT + SessionAuthGuard           | 只修改自己的名称            |
| `POST /passkeys/delete`                      | JWT + SessionAuthGuard + step-up | 删除自己的凭据              |

管理接口禁止 API Key、OAuth 和 MCP Token。所有查询同时包含 `workspace_id`、`user_id` 和内部 Passkey ID。

## 11. 登录失败保护

- 密码和 MFA 使用账号计数器、IP throttle 和分级冷却。
- 第 5 次失败冷却 1 分钟，第 8 次 5 分钟，第 10 次 15 分钟。
- 连续 30 分钟无失败后开始新窗口，成功登录清空该用户所有认证方式的失败计数。
- Passkey 验签失败更新计数和审计，但不锁定密码或 SSO。
- signature counter 异常只停用/拒绝该凭据并告警，不锁定用户。
- 用户取消、浏览器不支持和正常超时不计为认证失败。
- 登录页不公开剩余次数、账号是否存在或 Passkey 数量。

## 12. MFA、SSO 和恢复

- Passkey 只替代密码这一步，不自动满足现有 TOTP MFA 策略。
- Passkey 成功后必须经过与密码相同的 MFA 判断。
- `enforceSso=true` 时前端隐藏 Passkey 登录，后端仍必须拒绝。
- 强制 SSO 后保留凭据；关闭强制 SSO 时旧凭据重新可用，管理员界面需提示。
- 密码重置保留 Passkey，但撤销全部 session 并发送安全通知。
- 用户停用时撤销 session 并禁止 Passkey；重新启用后凭据恢复可用。
- 第一阶段保留密码回退，因此不新增管理员重置 Passkey 或纯 Passkey 恢复流程。

## 13. 会话与二次验证

`user_sessions.metadata` 增加非敏感字段：

- `primaryAuth`: password/passkey/sso
- `passkeyId`: 使用 Passkey 登录时记录内部 ID
- `authTime`: 主认证完成时间
- `mfaVerifiedAt`: 完成 MFA 的时间

添加和删除 Passkey 要求最近 10 分钟完成主认证；超过后要求重新输入当前密码。第一阶段无本地密码的 SSO-only 用户不能管理 Passkey。

删除 Passkey 后撤销所有 `metadata.passkeyId` 对应该凭据的活跃 session。如果当前 session 由该 Passkey 创建，则删除成功后当前用户重新登录。

## 14. 前端交互

### 登录页

- 密码表单下增加分隔线和“使用通行密钥登录”按钮。
- 点击后动态加载 browser 包并启动 discoverable credential 选择。
- 不要求填写邮箱。
- 复用现有 MFA challenge/setup 跳转。
- 强制 SSO、后端不可用、非 HTTPS 或浏览器不支持时不提供误导性的可用按钮。
- 用户取消不显示红色安全错误，不增加失败计数。

### 账户设置

- 在“两步验证”和“登录会话”之间增加“通行密钥”。
- 显示名称、创建时间、最近使用时间和同步/设备类型的用户化描述。
- 添加时自动建议“操作系统 + 浏览器”名称，并允许修改。
- 使用菜单提供重命名和删除，不暴露 credential ID、公钥或 counter。
- 删除前显示确认和二次验证输入。
- 所有 loading 状态防止重复提交；路由离开时取消 pending ceremony。
- 所有新增文案同步到现有全部 locale。

## 15. 公开访问与 MCP 隔离

- 不注册全局 Passkey Guard。
- `/share/...`、公开页面和匿名附件继续使用原有 `@Public()` 行为。
- iframe 限制只应用于登录、OAuth 授权和账户安全页面，不影响公开分享嵌入。
- MCP 审计、OAuth token 和 API Key 校验不读取 Passkey 表。
- ChatGPT OAuth 授权页可以借助网页登录 session，但 MCP 最终仍只收到 OAuth token。

## 16. 审计与通知

新增事件：

- `user.passkey_created`
- `user.passkey_renamed`
- `user.passkey_deleted`
- `user.passkey_counter_anomaly`
- `user.login_failed`

成功登录继续使用 `user.login`，metadata 增加 `source: 'passkey'` 和内部 `passkeyId`。审计禁止记录 credential ID、公钥、challenge、签名、完整 WebAuthn response、密码、TOTP secret 和备份码。

未知攻击流量只采样；达到冷却阈值、counter 异常和成功安全操作必须记录。添加和删除凭据发送安全邮件，内容包含时间、IP 和设备摘要，不包含可直接执行操作的免认证链接。

## 17. 额外认证加固

Passkey 上线前必须修复直接影响新登录链的现有问题：

- MFA verify 接入 throttle 和登录失败计数。
- MFA Cookie 使用 `secure` 配置。
- MFA pending token携带主认证来源。
- MFA pending token 使用随机 `jti` 和 Redis 原子消费，验证成功后不能重放。
- MFA 成功统一更新 `lastLoginAt`、审计和 session metadata。
- MFA 备份码改为至少 128 位随机值并只保存哈希。
- TOTP secret 使用项目现有的服务端密钥加密模式保存。
- Passkey 页面拒绝 cross-origin WebAuthn ceremony，并设置合适的 frame/permissions policy。

## 18. 发布与回滚

- 使用功能开关控制前端入口，默认只在迁移完成且 APP_URL 合法时开放。
- `APP_SECRET` 是认证数据加密根密钥，升级、重启和容器替换时必须保持稳定；变更会使既有 JWT、TOTP seed 等密文失效，禁止在普通发布中自动生成新值。
- 部署顺序：migration -> 后端 -> 前端入口。
- 老前端访问新后端不受影响；新前端遇到老后端时隐藏/降级 Passkey 入口。
- 回滚旧后端后密码和 SSO 必须仍可登录，因此第一阶段禁止删除密码。
- 数据库回滚不主动删除 Passkey 表；需要显式确认后才执行 destructive down migration。

## 19. 测试矩阵

- 正常注册、登录、重命名、删除和多凭据。
- 错误 origin、RP ID、challenge、userHandle、signature 和 credential ID。
- challenge 重放、过期、跨类型、跨 session、跨工作区和并发消费。
- counter 递增、counter 为 0、counter 回退和并发登录。
- 已禁用/删除/邮箱未验证用户。
- 强制 SSO、用户 MFA、工作区强制 MFA 和 MFA setup-required。
- 密码、MFA、Passkey 各自失败计数和 IP throttle。
- 用户取消不计失败，未知凭据不产生任意数据库用户记录。
- API Key、OAuth、MCP Token 不能调用管理接口。
- 用户不能查看、修改或删除其他用户的 Passkey。
- 删除凭据撤销对应 session，不撤销无关 session。
- 自托管带端口 APP_URL、localhost HTTP 和非法非 HTTPS APP_URL。
- 公开分享、匿名阅读和 MCP 回归测试。
- Chrome、Edge、Safari、Firefox 的支持/不支持/取消状态。
- 前端 desktop/mobile 布局、长名称、翻译和重复提交。

## 20. 实施 Todo

### A. 设计与依赖

- [x] 完成参考项目 Passkey 前后端、数据库和测试梳理。
- [x] 完成 Docmost JWT、Session、MFA、SSO、审计和代理架构映射。
- [x] 明确 MCP 和公开访问不进入 Passkey 鉴权链。
- [x] 输出设计、风险、测试矩阵和实施清单。
- [x] 加入并锁定 SimpleWebAuthn server/browser 依赖。

### B. 数据库与仓储

- [x] 新增 Passkey 相关 migration。
- [x] 更新 Kysely DB 类型和 entity 类型。
- [x] 实现 passkey account repository。
- [x] 实现 credential repository 和最大数量限制。
- [x] 实现 challenge 原子消费与清理。
- [x] 实现登录失败计数 repository。
- [x] 添加数据库约束、索引和 repository tests。

### C. 统一认证与安全加固

- [x] 抽取密码/Passkey 共用的登录完成流程。
- [x] Session metadata 记录认证来源、时间和 MFA 状态。
- [x] 实现 LoginAttemptService 和 Redis IP 限流衔接。（账号计数使用 PostgreSQL；公开认证端点使用现有 Redis `AUTH_THROTTLER` 按 IP 限流）
- [x] 修复 MFA verify 限流、Cookie 和统一登录审计。
- [x] 加密 TOTP secret，并升级 backup code 存储。
- [x] 实现敏感认证操作的 step-up 校验。（第一阶段使用当前密码）

### D. Passkey 后端

- [x] 实现可信 origin/RP ID 计算和状态检查。
- [x] 实现 discoverable authentication options/verify。
- [x] 实现 registration options/verify。
- [x] 实现 list/update/delete 管理接口。
- [x] 实现 credential session 定向撤销。
- [x] 实现 SSO、MFA、用户状态和邮箱验证策略。
- [x] 实现输入大小、凭据数量、challenge 数量和并发保护。
- [x] 实现 WebAuthn 页面跨域保护响应头。

### E. 审计与通知

- [x] 增加 Passkey 和登录失败审计事件、资源和全部 locale 翻译。
- [x] 审核所有审计 metadata，确认无敏感 WebAuthn 数据。
- [x] 添加凭据创建/删除安全邮件。
- [x] 未知凭据失败仅进入 Redis IP throttle 和服务日志，不逐条写业务审计，防止审计写放大。

### F. 前端

- [x] 实现 Passkey API service、types 和 queries。
- [x] 登录页增加 Passkey 入口并复用 MFA 跳转。
- [x] 账户设置增加 Passkey 管理区。
- [x] 实现创建、重命名、删除和二次验证交互。
- [x] 动态加载 WebAuthn browser 包并处理取消/不支持状态。
- [x] 同步全部 locale 翻译。
- [x] 检查移动端、长文本、loading 和可访问性。

### G. 验证与发布

- [x] 完成 service/controller/repository 单元测试。
- [x] 完成权限、重放、并发、计数器和跨工作区安全测试。
- [x] 完成公开分享、MCP、OAuth、密码、SSO、MFA 回归测试。
- [x] 运行 lint、typecheck、server/client tests 和 production build。（服务端 58/58 suites、客户端 8/8 files 全绿）
- [x] 使用 HTTPS 测试实例完成真实浏览器注册和登录。
- [x] 验证反向代理下 expected origin/RP ID。
- [x] 复盘所有 Todo 和缺陷清单后再允许发布。（20 个实施缺陷均已修复）

## 21. 缺陷复盘

实施中发现缺陷时按以下格式追加，禁止只在提交信息或对话中记录：

```text
- [状态] BUG-PASSKEY-001：问题摘要
  - 发现阶段：
  - 影响范围：
  - 根因：
  - 修复证据：
  - 回归测试：
```

- [x] BUG-PASSKEY-001：自定义版本 `26.06.20.0` 不是合法 SemVer，pnpm 10 无法解析内部依赖的 `workspace:*`，导致任何 Passkey 依赖安装失败。
  - 发现阶段：A. 设计与依赖。
  - 影响范围：根包和客户端依赖安装、lockfile 更新。
  - 根因：SemVer 数字段不允许前导零，pnpm workspace range 需要解析本地包版本。
  - 修复证据：保持产品版本不变，将内部 editor-ext 依赖改为等价的相对 `link:`。
  - 回归测试：重新执行 server/client 依赖安装及 `pnpm version:check`。
- [x] BUG-PASSKEY-002：设计要求 signature counter 异常时停用单个凭据，但原表设计缺少停用状态。
  - 发现阶段：B. 数据库与仓储。
  - 影响范围：克隆凭据风险隔离和用户其他登录方式可用性。
  - 根因：初版只设计了 counter 和审计事件，没有持久化凭据状态。
  - 修复证据：`user_passkeys` 增加 `disabled_at` 和分类 `disabled_reason`。
  - 回归测试：counter 异常测试必须证明单个凭据被拒绝且用户密码/SSO 不被锁定。
- [x] BUG-PASSKEY-003：Kysely 部分索引 builder 不能将非索引列作为类型化过滤列。
  - 发现阶段：B. 数据库与仓储首次编译。
  - 影响范围：`user_passkeys` 活跃凭据部分索引 migration 无法编译。
  - 根因：索引仅声明了 `credential_id`，类型系统不会接受直接引用 `disabled_at`。
  - 修复证据：按项目现有 migration 模式使用 `sql.ref('disabled_at')`。
  - 回归测试：服务端 TypeScript production build。
- [x] BUG-PASSKEY-004：当前 NestJS 11 版本未导出 `TooManyRequestsException`。
  - 发现阶段：C. 统一认证与安全加固首次编译。
  - 影响范围：登录冷却服务无法编译。
  - 根因：错误假设框架提供具名 429 异常类。
  - 修复证据：使用项目技术栈支持的 `HttpException` 和 `HttpStatus.TOO_MANY_REQUESTS`。
  - 回归测试：服务端 TypeScript production build 和 429 service test。
- [x] BUG-PASSKEY-005：Passkey 前端 service 重复声明了 HTTP `{data}` 包装，且直接把 SimpleWebAuthn 响应 Promise 强转为字典。
  - 发现阶段：F. 前端首次 TypeScript build。
  - 影响范围：全部 Passkey API 返回类型和 browser ceremony 编译。
  - 根因：未遵循项目 Axios interceptor 的既有解包类型约定，并跨越不兼容结构直接断言 Promise。
  - 修复证据：API 泛型改为最终 payload；先 await 官方响应，再通过 unknown 边界传给 JSON API。
  - 回归测试：客户端 TypeScript production build。
- [x] BUG-PASSKEY-006：运行时登录在本机请求 IP 为空字符串时向 PostgreSQL `inet` 写入 `''`，返回 500。
  - 发现阶段：G. 隔离环境 HTTP 登录回归。
  - 影响范围：密码及 Passkey 完成登录时创建 Session，审计日志也会写入非法 IP。
  - 根因：Fastify IP 插件可能返回空字符串，AuditContext 只处理 null，没有规范化空白值。
  - 修复证据：AuditContext 将空或纯空白 IP 统一为 null。
  - 回归测试：隔离环境密码登录返回 200、Session metadata 正确且审计不再报告 inet 错误。
- [x] BUG-PASSKEY-007：MFA 停用和恢复码重建界面收集了当前密码，但后端完全忽略，登录会话被窃取后可绕过前端提示修改恢复能力。
  - 发现阶段：C. 统一认证与安全加固复盘。
  - 影响范围：本地密码用户的 MFA 停用与恢复码重建。
  - 根因：Controller 未把 `confirmPassword` 传给 Service，Service 也没有服务端 step-up 校验。
  - 修复证据：Controller 传递 `confirmPassword`，Service 对本地密码用户执行服务端 bcrypt 校验。
  - 回归测试：错误密码不触发数据库更新，正确密码才允许停用；隔离运行环境验证通过。
- [x] BUG-PASSKEY-008：历史 MFA 恢复码只有 32 位随机量且明文存储，输入框还固定为 8 字符，无法安全升级到 128 位恢复码。
  - 发现阶段：C. 统一认证与安全加固复盘。
  - 影响范围：MFA 恢复登录、数据库泄露风险和升级兼容性。
  - 根因：生成、存储和前端输入长度均沿用早期占位实现。
  - 修复证据：新码为 16 随机字节的分组十六进制；数据库仅保存用途隔离 HMAC；TOTP seed 使用 AES-256-GCM；旧明文值成功使用后渐进升级。
  - 回归测试：密文防篡改、旧值兼容、128 位强度、原子消费和重复使用拒绝均通过。
- [x] BUG-PASSKEY-009：删除 Passkey 与刚完成验签的新会话创建并发时，定向撤销可能先执行，随后仍创建一个引用已删除凭据的会话。
  - 发现阶段：D. Passkey 后端并发复盘。
  - 影响范围：已删除或因 counter 异常停用的凭据关联会话。
  - 根因：删除事务只能撤销当时已存在的 session，JWT 校验未持续验证 session metadata 引用的凭据状态。
  - 修复证据：活跃 Session 查询持续校验 metadata 引用的 Passkey 仍存在、属于同一用户/工作区且未停用。
  - 回归测试：隔离环境中同一 JWT 删除凭据前返回 200，删除后立即返回 401。
- [x] BUG-PASSKEY-010：128 位恢复码初版使用带连字符分组的 base64url，但连字符本身属于 base64url 数据字符，规范化会破坏部分随机码。
  - 发现阶段：C. MFA 加固单元测试。
  - 影响范围：包含 `-` 随机字符的新恢复码可能无法验证。
  - 根因：展示分隔符与随机编码字符集重叠。
  - 修复证据：恢复码改为 16 随机字节的十六进制表示，再使用不属于十六进制字符集的 `-` 分组。
  - 回归测试：每个新码去分隔符后严格为 32 个十六进制字符并解码为 16 字节。
- [x] BUG-PASSKEY-011：服务端 Jest 缺少 `tsx` 转换和 `src/*` mapper，且旧 transform 会误处理编译后的 JavaScript，导致邮件模板及大量既有测试无法正确加载。
  - 发现阶段：E. 安全通知单元测试。
  - 影响范围：任何直接依赖 transactional email 模板的服务测试。
  - 根因：测试解析配置与服务端实际 TypeScript 文件类型、tsconfig baseUrl 不一致，正则边界过宽。
  - 修复证据：增加 `tsx` 扩展/transform、`src/*` mapper，并将 allowlist ESM JavaScript 交给 Babel 而非 ts-jest。
  - 回归测试：Passkey 邮件、Controller、Service、MFA 等新增测试均可加载；全量套件由 40 个既有套件通过。
- [x] BUG-PASSKEY-012：密码登录没有跳过 `FORGOT_PASSWORD_THROTTLER`，导致登录在 3 次失败后被错误地按“忘记密码”规则限流，账号分级冷却无法按设计工作。
  - 发现阶段：G. 隔离环境登录失败计数回归。
  - 影响范围：所有密码登录及第 5/8/10 次账号冷却策略。
  - 根因：AuthController 的类级 `SkipThrottle` 漏掉忘记密码专用限流器。
  - 修复证据：密码登录显式跳过忘记密码限流器，仍保留 Redis `AUTH_THROTTLER`。
  - 回归测试：隔离环境前 5 次错误密码返回统一 401，第 6 次由账号冷却返回 429；高频 IP 仍由 Redis 限流。
- [x] BUG-PASSKEY-013：前端路由离开/关闭弹窗没有取消 WebAuthn ceremony，强制 SSO 或无本地密码用户仍能点击不可能成功的添加入口，窄屏凭据表可能横向溢出。
  - 发现阶段：F. 前端交互和移动端复盘。
  - 影响范围：浏览器认证提示残留、SSO-only 用户体验、移动端与长凭据名布局。
  - 根因：首版只实现主流程，未接官方 AbortService、当前工作区登录策略和稳定表格宽度。
  - 修复证据：使用官方 AbortService 清理 ceremony；依据现有工作区/用户字段禁用不可能成功的管理；表格使用稳定最小宽度滚动，名称允许任意位置换行。
  - 回归测试：Passkey browser helper、82 项客户端测试、全部 locale 校验和 production build 通过。
- [x] BUG-PASSKEY-014：并发或重复注册同一 credential ID 时，数据库唯一约束错误会返回 500。
  - 发现阶段：D. 注册并发与错误边界复盘。
  - 影响范围：重复提交、并发 ceremony 和同一 RP 下的异常凭据冲突。
  - 根因：`user_passkeys.credential_id` 全局唯一约束正确，但 Service 未将 PostgreSQL `23505` 转换为稳定业务错误。
  - 修复证据：Service 将 PostgreSQL `23505` 转换为不泄露约束信息的统一 400。
  - 回归测试：重复注册测试证明不写创建审计、不发送安全邮件，服务端 production build 通过。
- [x] BUG-PASSKEY-015：Passkey 审计已经保存安全的 `metadata.name`，但通用资源 fallback 不读取该字段，资源列仍显示空值。
  - 发现阶段：E. 审计展示复盘。
  - 影响范围：Passkey 创建、重命名、删除事件的资源可识别性，尤其是删除后无法再查数据库的事件。
  - 根因：`getAuditFallbackName` 只读取变更对象中的 name 和 metadata.title。
  - 修复证据：通用 fallback 读取 `metadata.name`，生成仅含内部资源 ID、类型和用户命名的展示对象。
  - 回归测试：AuditRepo 与 AuditService 共 6 项通过，删除后的 Passkey 资源名测试通过。
- [x] BUG-PASSKEY-016：工作区强制 MFA 且用户尚未配置时，登录只发 `mfaToken`，但 setup/enable 只接受正式 Session；`validate-access` 还错误返回 `isTransferToken=false`，首次设置流程无法完成。
  - 发现阶段：C. Passkey 进入强制 MFA setup-required 流程复盘。
  - 影响范围：密码或 Passkey 主认证后的首次强制 MFA 配置。
  - 根因：前端已区分 `isRequired`，后端却没有受限 pending setup API，且 token 类型标记与真实 Cookie 不一致。
  - 修复证据：新增只接受 5 分钟 `mfaToken` 的 pending setup/enable；普通 setup 仍要求 JWT Session；启用后清 pending Cookie，不创建正式 Session。
  - 回归测试：隔离环境依次证明 requiresSetup、`isTransferToken=true`、普通 setup 401、pending setup/enable 200、全站 API 401、旧 pending token 400、重新登录并完成 MFA 后全站 API 200。
- [x] BUG-PASSKEY-017：SSO 密文防篡改测试把末字符替换成 `x`，随机密文本身以 `x` 结尾时没有发生修改；Jest 同时漏掉明确的 ESM 依赖 `lib0`。
  - 发现阶段：G. 服务端全量测试基线复盘。
  - 影响范围：SSO 安全测试偶发失败、协作相关测试无法加载。
  - 根因：测试篡改操作不保证改变字节，ESM allowlist 与实际依赖不一致。
  - 修复证据：确定性翻转密文段首字符，并将 `lib0` 交给现有 Babel transform。
  - 回归测试：SSO secret、page/comment 相关测试及全量服务端基线复跑。
- [x] BUG-PASSKEY-018：MFA 临时 JWT 只依赖客户端清 Cookie，同一令牌和当前 TOTP 在 5 分钟有效期内可被并发重放并创建多个正式 Session。
  - 发现阶段：G. Passkey 与 MFA 组合认证安全复盘。
  - 影响范围：密码、Passkey 或 SSO 主认证后进入 MFA 的全部登录流程。
  - 根因：临时 JWT 没有随机 `jti`，服务端也没有一次性消费状态。
  - 修复证据：令牌增加随机 `jti`；MFA 校验成功后、创建正式 Session 前使用 Redis `SET NX EX` 原子消费；缺失、过期或已消费的令牌统一拒绝。
  - 回归测试：原子消费首次成功、重放失败、无效/过期 claims 不访问 Redis；真实 HTTP 并发返回一个 200、一个 401，活跃 Session 只增加 1 条。
- [x] BUG-PASSKEY-019：发布前生产依赖审计发现 19 个 high，包括 Nest Fastify 尾斜杠中间件绕过和多项网络/解析链漏洞。
  - 发现阶段：G. 最终依赖安全复盘。
  - 影响范围：认证中间件、MCP 解析、HTTP/WebSocket、邮件、路由、数据库 JSON path 与编辑器链接解析。
  - 根因：lockfile 固定在漏洞披露前版本，根级 override 也阻止了部分传递依赖自动获得补丁。
  - 修复证据：升级 Nest、Kysely、React Router、Undici、Nodemailer、ws；传递依赖使用精确 override，覆盖 MCP、Azure、编辑器、遥测和构建链已披露漏洞。
  - 回归测试：`pnpm audit --prod --audit-level low` 返回 `No known vulnerabilities found`；普通与尾斜杠 Passkey 管理路径匿名请求均返回 401；专项测试、客户端测试、两端 build 和 HTTPS browser ceremony 通过。
- [x] BUG-PASSKEY-020：服务端全量 Jest 有 13 个 suite 失败，掩盖真实回归并使发布验证无法全绿。
  - 发现阶段：G. 最终全量测试复盘。
  - 影响范围：12 个 Controller/Service 构造测试和 PageService 的 8 个页面同步行为测试。
  - 根因：旧 Nest 测试模板递归构造完整生产依赖图却没有 mock；PageService 将真实 `src/*` 模块错误标记为 virtual mock，导致实际加载 collaboration extensions 时 `UniqueID` 为空。
  - 修复证据：12 个单元测试使用 Nest `useMocker` 隔离非被测依赖；PageService mock 交由现有 `src/*` module mapper 解析真实模块路径。
  - 回归测试：原失败集合 13/13 suites、20/20 tests 通过；服务端全量 58/58 suites、324/324 tests 通过。

## 22. 验证记录

- PostgreSQL 18 隔离库：历史 migration + Passkey migration 全量向上成功；新 migration down/up 循环成功；约束和索引由 `\d` 核对。
- 服务端 Passkey/MFA 专项：Service、Controller、Repository、origin、登录计数、密钥存储、安全邮件、MFA 一次性令牌和资源审计共 52 项通过。
- 兼容回归：MCP、OAuth、SSO、Session Guard、Token、审计共 42 项通过。
- 客户端：Vitest 8 个文件、82 项全部通过；TypeScript + Vite production build 通过；SimpleWebAuthn 保持独立动态 chunk（gzip 约 1.05 KB）。
- 运行验证：密码前 5 次失败统一 401、第 6 次账号冷却 429；MFA seed 为 AES-GCM 密文；10 个 128 位恢复码只保存 HMAC；消费后 9 个且重复码 401。
- 运行验证：强制 MFA 首次配置只允许 pending setup/enable；该 Cookie 不能访问全站 API，启用后立即失效，重新登录并完成 TOTP 后才建立正式 Session。
- 运行验证：匿名分享 API 返回业务 404 而不是鉴权 401；公开分享 HTML 未附加 Passkey 限制；OAuth metadata 正常；Passkey API/登录页附加 frame、Permissions-Policy 和 no-store 保护。
- 运行验证：未知凭据 challenge 首次消费后归零，重放仍返回统一 401，且不增加业务审计；Passkey Session 删除凭据前 200、删除后 401。
- HTTPS 浏览器验证：Chromium CDP 虚拟认证器经前端完成 discoverable credential 注册；清除全部 Cookie 后使用通行密钥登录至 `/home`，`/api/users/me` 返回 200；审计与 Session metadata 均正确记录 `source/primaryAuth=passkey`。
- 前端视觉验证：1440x1000 桌面与 390x844 移动端截图内容完整；移动端 document/body scrollWidth 均为 390，凭据表仅在自身容器横向滚动，无整页溢出或控件重叠。
- 反向代理配置测试：`https://docs.example.test:23000` 解析为同 origin，RP ID 为 `docs.example.test`，不读取内部应用端口。
- 服务端全量 Jest：58/58 suites、324/324 tests 通过；原有 12 个 Nest DI 空壳测试和 1 个 editor mock 解析问题已修复。
- lint：0 errors、13 个仓库既有 warnings，本次新增文件无 warning；server/client production build 与版本同步检查通过。
- 依赖安全：production audit 从 55 个（19 high、28 moderate、8 low）降为 0；Nest 尾斜杠路径运行验证未绕过 Passkey 管理鉴权，最终依赖版本下的 HTTPS 注册/登录再次通过。
