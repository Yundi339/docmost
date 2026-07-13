# 目录隐私与协作同步状态设计

## 1. 目标与结论

本文档只覆盖两项能力：

1. 成员目录隐私：普通成员不应通过搜索、提及或选择器无条件枚举全工作区成员和邮箱。
2. 协作同步状态：用户应能区分连接中、已同步、离线、本地待同步和错误，并在刷新新版本前获得明确警告。

必要性结论：

| 能力 | 是否需要修改 | 证据 | 优先级 |
| --- | --- | --- | --- |
| 目录隐私 | 需要 | `POST /api/search/suggest` 当前向具有 REST read 权限的调用者返回全工作区用户的 `email`，且用户/群组候选缺少业务上下文。 | P0 隐私止损，P1 完整策略 |
| 同步状态 | 需要 | 客户端已有 Hocuspocus/Yjs/y-indexeddb 事件，但只在连接中断 5 秒后显示一个无线网警告；`Ctrl/Cmd+S` 无反馈，新版本刷新不检查本地待同步变更。 | P1 |

不在本次范围：OIDC、全文搜索结果权限、工作区成员管理页、MCP 成员管理工具和伪“强制保存”。

## 2. 现状调用面

### 2.1 目录调用面

`SearchService.searchSuggestions()` 同时承担了页面、用户和群组三种搜索。页面结果已做空间会员和页面级权限过滤，用户和群组则只按 `workspaceId` 过滤。

| 前端调用者 | 实际业务上下文 | 必要的服务端校验 |
| --- | --- | --- |
| 页面/评论 `@` 提及 | 当前页面 | 操作者可查看页面；候选用户可访问页面 |
| 页面权限选择器 | 受限页面 | 操作者可管理页面权限；候选遵守目录策略 |
| 空间成员选择器 | 目标空间 | 操作者具有 `Manage Member`；候选遵守目录策略 |
| 页面验证人选择器 | 当前页面 | 操作者可管理验证；候选至少可访问页面 |
| 数据库 Person 字段 | 数据库所在页面 | 操作者可编辑页面；候选遵守目录策略 |
| 链接/移动目标选择器 | 页面结果 | 保留现有页面权限过滤，不进入成员目录策略 |
| 工作区成员管理 | 管理员列表 | 保留完整邮箱，继续要求 `Manage Member` |
| MCP `list_workspace_members` | 管理员工具 | 保留完整管理结果，继续要求服务端 `Manage Member` |

风险不只是“前端显示了邮箱”。邮箱已进入 TanStack Query cache，且 API key/OAuth 调用者可直接请求接口，因此必须在 SQL 选择列和候选范围阶段处理，不能只在 React 中隐藏。

### 2.2 同步事件面

主页面编辑器和嵌入数据库记录编辑器都创建了：

- `IndexeddbPersistence` 的 `synced` 事件；
- `HocuspocusProvider` 的 `onStatus` 和 `onSynced` 事件；
- provider 内置的 `onUnsyncedChanges({ number })`，可区分本地待服务端确认的更新；
- 现有 token 过期刷新和 socket 重连逻辑。

`onSynced` 只代表首次同步握手，不能单独表示所有本地更新已持久化。“已同步”必须同时满足连接已建立、本地 IndexedDB 已就绪、远端已握手且 `unsyncedChanges === 0`。

## 3. 目录隐私设计

### 3.1 模块边界

在 `apps/server/src/core/directory` 增加独立 `DirectoryModule`：

- `directory-visibility.policy.ts`：解析工作区策略、操作者角色和查询上下文。
- `directory-query.service.ts`：唯一的用户/群组候选查询入口，在 SQL 中限制列、工作区和候选范围。
- `directory.types.ts`：强类型 context、visibility 和最小返回 DTO。

`SearchService` 继续管理页面建议，用户/群组分支委托给 `DirectoryQueryService`。工作区成员管理和 MCP 不经过普通目录服务，避免误伤管理能力。

### 3.2 策略值与兼容

工作区 `settings.directory.visibility` 支持：

- `workspace`：候选名称和头像可在工作区内发现，不返回邮箱。
- `context`：普通成员只看到能访问当前目标空间/页面的候选。无可验证上下文时只返回当前用户。
- `admins-only`：只有 workspace owner/admin 可模糊浏览完整候选；普通成员在提及场景仍可选择能访问当前页面的人，管理选择器只允许服务端验证后的精确匹配。

不采用“任意共同空间”作为强隔离条件，因为默认群组和默认空间可能使所有成员都满足该条件。

兼容策略：

- 所有工作区立即停止在普通建议响应中返回邮箱，这是安全修正，不受 visibility 影响。
- 历史工作区缺少设置时解析为 `workspace`，避免升级后选择器突然不可用。
- 新工作区显式写入 `context`。
- owner 可在现有工作区设置中修改策略；服务端将字段纳入 owner-only 校验。

### 3.3 API 契约

`POST /api/search/suggest` 保留，但当 `includeUsers` 或 `includeGroups` 为 true 时接受并校验：

```ts
type DirectoryContext =
  | "generic"
  | "mention"
  | "permission-picker"
  | "space-member"
  | "verification"
  | "database-person";
```

- `mention` / `permission-picker` / `verification` / `database-person` 必须提供 `pageId`。
- `space-member` 必须提供 `spaceId`。
- 上下文不能由前端声明后直接信任；服务端必须重新查找页面/空间并执行 CASL 与页面级权限校验。
- 未传 context 按 `generic` 处理，不会默认获得管理范围。
- 普通用户 DTO 固定为 `id`、`name`、`avatarUrl`；群组 DTO 固定为 `id`、`name`。
- 邮箱可用于服务端匹配，但不进入响应、Query cache、审计或安全日志。
- 目录建议使用按已登录用户计数的 Redis throttler，不记录每次正常查询。

### 3.4 权限与审计

- 目录策略更改：Session-only，owner-only，记录 `workspace.updated` 的 before/after。
- 普通建议：继续绑定调用者身份和 workspace；API key/OAuth 不能因 scope 获得比该用户更广的目录。
- 工作区成员管理页与 MCP：保留 `Manage Member` 服务端校验，不改用管理 DTO。
- 不审计每次搜索。限流命中或大量枚举只记分类安全事件，不记录原始查询。

### 3.5 查询和性能

- 先用 workspace、删除/停用状态、context 和候选访问关系缩小 SQL 结果，再执行模糊匹配和 `LIMIT`。
- 不允许先加载全工作区用户后在 Node.js 过滤。
- 页面提及使用递归祖先权限条件，候选用户必须通过所有受限祖先。
- 复用现有 `space_members(user_id)`、`space_members(group_id)` 和页面权限索引；在真实规模上运行 `EXPLAIN (ANALYZE, BUFFERS)` 后再决定是否加复合索引。

## 4. 协作同步状态设计

### 4.1 状态模型

在现有 editor feature 内增加强类型状态，不新增 API 或数据库：

```ts
type CollaborationSyncPhase =
  | "connecting"
  | "synced"
  | "pending"
  | "offline"
  | "error";

type CollaborationSyncState = {
  pageId: string;
  phase: CollaborationSyncPhase;
  localReady: boolean;
  remoteReady: boolean;
  unsyncedChanges: number;
  errorCode?: "authentication" | "timeout" | "connection";
  lastSyncedAt?: number;
};
```

状态优先级：`error` > `pending` > `synced` > `connecting` > `offline`。离线且有本地更新时显示 `pending`，tooltip 明确说明“已保存到本机，等待连接后同步”。

不把端口连接或首次 `onSynced` 称为“已保存”。只有 provider 报告 `unsyncedChanges === 0` 时才称为“已同步”。

### 4.2 模块和复用

- `collaboration-sync-state.ts`：纯函数状态派生、类型和 Jotai atom。
- `use-collaboration-sync.ts`：连接 Hocuspocus/y-indexeddb 事件，注册/清理页面状态和重试命令。
- 主页面编辑器和嵌入记录编辑器复用同一状态派生逻辑，不再分别猜测 7.5 秒超时。
- atom 按 `pageId` 存储，页面头部只读取当前路由页面；嵌入记录不能覆盖宿主页面状态。
- 全局新版本通知可检查任一活动编辑器的 `unsyncedChanges`。

### 4.3 前端行为

- `synced`：页头保持安静，不长期占用标题空间。
- `connecting`：超过短延时后显示中性加载图标。
- `pending`：显示云同步图标，tooltip 区分在线待确认和离线本地待同步。
- `offline` / `error`：显示警告图标，点击执行现有 socket reconnect/provider forceSync，不调用页面 REST 覆盖保存。
- `Ctrl/Cmd+S`：阻止浏览器保存，显示当前同步结果；非 `synced` 时同时触发重试。
- 服务器版本更新：无待同步更新时直接刷新；有待同步更新时先弹确认警告，取消后可等待自动同步或手动重试。
- 页面卸载：有待同步更新时注册 `beforeunload` 浏览器原生保护，不自定义无法保证显示的文案。

### 4.4 错误和隐私

- UI 只显示分类错误，不显示 collab token、WebSocket URL 查询或服务器原始错误。
- token 刷新成功后清除 authentication 错误；刷新失败保留可重试状态。
- 每页卸载时，已同步状态直接移除；待同步状态保留为不含重试回调的离线记录，防止新版本刷新遗漏已进入 IndexedDB 但未发往服务端的更新，同时避免闭包持有旧 token/provider。
- 本地同步状态不进入服务端审计；它是瞬时 UI 状态，写审计会造成高频写放大。

## 5. 测试与发布门槛

### 5.1 目录隐私

- 单元测试：visibility 解析、角色例外、context 必填 ID、最小 DTO、停用/删除用户。
- 服务测试：不同策略下的模糊/精确匹配，页面受限祖先，群组间接权限，跨 workspace ID，伪造 context。
- Controller 测试：owner-only 策略更改，API key/OAuth 不越权，限流 guard 启用。
- 前端测试：所有选择器发送完整 context，查询 key 包含 context/pageId/spaceId，结果类型不再依赖 email。
- 性能：真实规模 `EXPLAIN ANALYZE`，并验证限制在 SQL 而非 Node.js 内存执行。

### 5.2 同步状态

- 纯函数测试：状态优先级、在线/离线 pending、错误清理、页面卸载。
- 组件测试：安静 synced、延时 connecting、点击重试、`Ctrl/Cmd+S` 反馈。
- 更新通知测试：pending 时不直接 reload，确认后可 reload，无 pending 保持原行为。
- 集成场景：断网编辑、恢复连接、切页、双标签、token 过期、服务器发版、嵌入记录不覆盖宿主状态。

## 6. Todo 与实施复盘

### 6.1 目录隐私

- [x] `DIR-001` 盘点 search、mention/comment、permission picker、space member、verification、database person、admin 和 MCP 调用面。
- [x] `DIR-002` 定义 visibility、强类型 context、最小 DTO、兼容和审计策略。
- [x] `DIR-003` 实现 `DirectoryModule`、`DirectoryVisibilityPolicy` 和 SQL 级 `DirectoryQueryService`。
- [x] `DIR-004` 普通目录响应移除 email/description，排除删除和停用用户。
- [x] `DIR-005` 为 suggestion DTO 增加 context/pageId，并在服务端校验上下文权限。
- [x] `DIR-006` 将提及候选限制为能访问当前页面的身份。
- [x] `DIR-007` 接入页面权限、空间成员、验证人和数据库 Person 选择器。
- [x] `DIR-008` 增加 owner-only 工作区目录策略 UI、Session 校验、审计和翻译。
- [x] `DIR-009` 历史工作区缺省兼容为 `workspace`，新工作区显式使用 `context`。
- [x] `DIR-010` 增加用户级目录限流，确认正常搜索不产生审计写放大。
- [x] `DIR-011` 增加服务、Controller、前端 context、MCP `Manage Member` 不回归测试。
- [x] `DIR-012` 在匿名 1 万用户、200 群组、2000 页面、20 层祖先数据上运行真实 PostgreSQL 查询计划；复用现有索引，无需迁移。

### 6.2 协作同步状态

- [x] `SYNC-001` 盘点主编辑器、嵌入记录、Hocuspocus、Yjs、y-indexeddb、快捷键和版本通知事件。
- [x] `SYNC-002` 定义状态语义、优先级、重试和刷新保护契约。
- [x] `SYNC-003` 实现按 pageId 隔离的强类型 atom 和可测试状态派生函数。
- [x] `SYNC-004` 主页面和嵌入记录接入 `onUnsyncedChanges`，消除重复的超时猜测。
- [x] `SYNC-005` 在页面头部增加安静状态指示、tooltip 和点击重试。
- [x] `SYNC-006` `Ctrl/Cmd+S` 显示当前状态，非已同步时调用重试。
- [x] `SYNC-007` 版本刷新在待同步时弹确认，并增加 `beforeunload` 保护。
- [x] `SYNC-008` 补齐纯函数、组件、快捷键和版本通知测试。
- [x] `SYNC-009` 补齐 12 个 locale 的 17 个新增键，并以 Firefox BiDi 验证 1440px 与 390px 页头；断网重连状态按钮出现时不遮挡标题操作。
- [x] `SYNC-010` 完成真实 Hocuspocus 双客户端在线/断网/重连、token 过期恢复，以及切页、双 store、部署刷新和嵌入记录共享生命周期测试复盘。

### 6.3 发现缺陷

- [x] `BUG-DIR-001` 普通 suggestion 直接返回用户 email，且未排除 `deactivatedAt` 用户。
- [x] `BUG-DIR-002` 用户/群组 suggestion 没有可验证业务 context，任意 REST read 调用者可枚举全工作区目录。
- [x] `BUG-DIR-003` 修正策略优先级，防止 owner/admin 在提及和验证人场景跳过候选页面访问校验。
- [x] `BUG-SYNC-001` 嵌入记录编辑器可覆盖全局宿主页面连接状态。
- [x] `BUG-SYNC-002` 新版本刷新不检查 provider 本地待同步更新。
- [x] `BUG-SYNC-003` 确认强制刷新后设置一次性绕过标记，避免自定义确认后又出现浏览器 `beforeunload` 双重提示。
- [x] `BUG-SYNC-004` 页面卸载时保留不含 provider/token 回调的待同步状态，避免版本刷新遗漏 IndexedDB 中的未上传更新。
- [x] `BUG-SYNC-005` 用 `selectAtom` 按 pageId 订阅同步状态，避免任一嵌入记录更新导致所有编辑器重渲染。
- [x] `BUG-DIR-004` 普通目录不再按邮箱子串匹配，避免调用者通过命中结果反推成员邮箱；邮箱仅保留给策略限制下的服务端精确管理查找。
- [x] `BUG-DIR-005` 将祖先限制提升为查询级物化 CTE，并集合化计算空间/页面候选权限，避免逐用户相关子查询触发 PostgreSQL JIT；匿名 1 万用户规模从约 1.82 秒降到预热后 18–19 毫秒。
- [x] `BUG-SYNC-006` 断开或重连时清除上一连接的 `remoteReady`，避免 socket 建连后在新握手前误报已同步。
- [x] `BUG-SYNC-007` 统一可取消的重连控制器，页面卸载时清除延时任务，避免操作已销毁 provider 或重新写入旧页状态。
- [x] `BUG-SYNC-008` collab token 未就绪时不创建未认证 provider；请求失败显示分类连接错误，过期 token 刷新后复用统一重连流程。
- [x] `BUG-SYNC-009` 修复新增状态按钮可能导致的移动页头拥挤：移动端使用紧凑编辑/分享图标并隐藏目录、对齐快捷按钮。
- [x] `BUG-SYNC-010` 将刷新保护纯逻辑移出 React 组件模块，消除 Fast Refresh 导出告警，保持开发态热更新边界稳定。

每次实现后必须在本节勾选实际完成项，并在对应小节后追加复盘。如果实现或测试发现新缺陷，先在 6.3 新增 Todo，再修复。

本轮复盘：目录数据最小化、context 服务端校验、owner-only 策略、用户级限流和 MCP 管理权限回归已完成。真实 PostgreSQL 计划证明原逐用户权限子查询会触发约 698ms JIT，集合化后服务查询首次约 33ms、预热约 18–19ms，现有索引足够。同步状态已按页隔离并基于 provider 未同步计数；真实双客户端验证在线复制、离线待同步、重连补发和最终归零，过期 token 替换后恢复认证。12 个 locale、桌面和 390px 断网页头均完成验证，前后端全量测试、类型检查、ESLint 和生产构建通过，临时数据库、Redis、账户、测试页和截图已清理。
