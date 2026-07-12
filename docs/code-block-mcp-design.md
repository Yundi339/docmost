# 代码块增强与 MCP 维护工具设计

> 状态：已在 `feat/native-database-fusion` 分支的 `efba9a38` 提交中实现并验证。
> 稳定的待办清单和实现复盘保留在
> [`forkmost-integration.md`](./forkmost-integration.md) 中。

## 1. 目标

本次交付按以下顺序完成三个目标：

1. 在不改变现有代码块和 Mermaid 行为的前提下，增加代码块标题、自动换行显示和源码下载功能。
2. 从会话服务中拆分 MCP 工具声明与执行逻辑，同时保持原有 20 个工具的外部契约不变。
3. 通过 `trash_page` 和 `restore_page` 增加可逆的页面维护能力。

不在本次范围内：

- 不为代码块显示偏好引入私有 Markdown 语法。
- 不通过 MCP 永久删除页面。
- 本次不支持删除评论。当前评论删除操作是硬删除，需要单独设计保留与恢复机制。
- 不新增前端、后端、校验、状态管理或图标库。

## 2. 仓库隐私要求

仓库内容不得包含个人身份信息或私有部署信息。测试和文档只能使用 `example.test`、
RFC 5737 地址和通用路径。

禁止提交：

- 私有域名、IP 地址、端口、SSH 目标或服务器目录结构；
- 证书、密钥的路径或内容；
- API 密钥、OAuth 令牌、镜像仓库凭据或环境变量值；
- 包含上述数据的部署日志。

每次提交前，应扫描已跟踪的变更和最终代码树，检查私有部署标记及常见密钥格式。
部署专用说明应保存在本地忽略的 skill 或服务器端配置中，不应写入项目文档。

## 3. 代码块设计

### 3.1 数据模型

扩展现有 `codeBlock` 节点，增加以下属性：

| 属性    | 类型             | 默认值  | HTML 表示方式      |
| ------- | ---------------- | ------- | ------------------ |
| `title` | `string \| null` | `null`  | `data-title`       |
| `wrap`  | `boolean`        | `false` | `data-wrap="true"` |

标题规范化会移除控制字符和换行符、清理首尾空白，并将长度限制为 120 个字符。
不包含这些属性的历史 JSON 和 HTML 仍会按默认值正常解析。

### 3.2 界面行为

现有 React NodeView 仍是唯一的代码块界面：

- 编辑模式：提供标题输入、语言选择、自动换行开关；Mermaid 还提供源码切换；同时提供复制和下载操作；
- 只读或分享模式：显示可选标题，并提供复制和下载操作；
- 标题保持单行并在过长时省略，避免长标题改变代码块尺寸；
- 自动换行只改变显示方式，绝不修改源码文本；
- Mermaid 预览与源码切换、双击行为保持不变；
- 移动端控件在尺寸稳定的工具栏内换行，不遮挡代码内容。

按钮继续使用项目现有的 Mantine 和 Tabler 组件，并提供工具提示。除现有 Mermaid
外部点击监听器外，不增加全局事件监听器。

### 3.3 下载安全

下载完全在浏览器本地通过 `Blob` 和对象 URL 完成，不调用 API，也不上传内容。

文件名辅助方法会：

- 移除路径分隔符、控制字符、点路径穿越内容和保留名称；
- 将完整文件名限制为 120 个字符；
- 保留安全的显式扩展名；
- 没有显式扩展名时，将已知代码语言映射为对应扩展名；
- 无法识别时使用 `code-block.txt`。

对象 URL 和临时锚点使用后始终释放。源码以 UTF-8 文本下载，不会执行或渲染。

### 3.4 兼容性

- JSON、HTML、Yjs 和协同撤销会保留 `title` 与 `wrap`。
- 标准 Markdown 只导出语言和源码围栏。由于 CommonMark 没有可移植的等价语法，
  `title` 和 `wrap` 会按设计降级丢失。
- Markdown 导入和历史文档使用 `title=null`、`wrap=false`。
- 属性存储在 ProseMirror JSON 中，页面历史不需要迁移。

## 4. MCP 重构设计

### 4.1 模块边界

`McpService` 只保留协议与会话生命周期。工具行为拆分到：

- `McpToolRegistryService`：聚合工具提供器并注册工具描述符；
- `McpToolExecutorService`：唯一的模式、作用域、DTO、审计和错误处理入口；
- `McpToolAccessService`：复用页面查询、分页、CASL 和页面访问辅助逻辑；
- `tools/page.tools.ts`；
- `tools/comment.tools.ts`；
- `tools/space.tools.ts`；
- `tools/search.tools.ts`；
- `tools/member.tools.ts`。

每个提供器返回强类型的 `McpToolDescriptor` 对象。描述符声明工具名称、说明、
schema、访问类型、DTO 映射、处理器和 MCP annotations。如果工具没有声明 DTO/
无 DTO 策略，或工具名称重复，注册过程会直接拒绝。

### 4.2 现有契约基线

第一次重构必须原样保留以下工具：

| 提供器 | 工具                                                                                                    | 访问与权限基线                                |
| ------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 搜索   | `search_pages`、`search_attachments`                                                                    | `mcp:read`；保留现有搜索与页面过滤            |
| 页面   | `get_page`、`list_pages`、`list_child_pages`                                                            | `mcp:read`；检查页面与空间查看权限            |
| 页面   | `create_page`、`update_page`、`duplicate_page`、`copy_page_to_space`、`move_page`、`move_page_to_space` | `mcp:write`；保留现有编辑与创建权限检查       |
| 空间   | `get_space`、`list_spaces`                                                                              | `mcp:read`；保留现有设置与成员关系检查        |
| 空间   | `create_space`、`update_space`                                                                          | `mcp:write`；保留现有工作区与空间管理权限检查 |
| 评论   | `get_comments`                                                                                          | `mcp:read`；检查页面查看权限                  |
| 评论   | `create_comment`、`update_comment`                                                                      | `mcp:write`；检查评论权限与所有权             |
| 成员   | `list_workspace_members`、`get_current_user`                                                            | `mcp:read`；成员列表继续要求 `Manage Member`  |

契约测试对工具名称、说明、输入 schema、annotations、DTO 策略和访问类型进行快照。
现有处理器测试继续验证返回结果、工作区绑定、页面限制和审计脱敏。

### 4.3 执行器不变量

每次调用都必须按以下顺序经过同一个执行器：

1. 检查工作区 MCP 模式；
2. 检查 API Key/OAuth 作用域；
3. 执行 DTO 转换及 `class-validator` 校验；
4. 调用提供器处理器及其 CASL/页面权限检查；
5. 使用脱敏后的目标与结果元数据记录成功或失败审计。

工具提供器不能绕过执行器。写操作处理器必须调用核心服务完成变更，不能直接写表。
错误可以包含长度受限的公开消息，但绝不能包含文档正文、评论、凭据或令牌。

## 5. 可逆页面工具

### 5.1 作用域模型

在 API Key 和 OAuth 作用域注册表中增加 `mcp:destructive`。

- 规范化时，该作用域隐含 `mcp:write` 和 `mcp:read`。
- 现有密钥、OAuth 客户端、授权、授权码和刷新令牌不会自动获得此作用域。
- API Key 的默认预设和“完全访问”预设仍不包含破坏性操作。
- owner 必须为 API Key 或 OAuth 客户端显式开启破坏性访问。
- 工作区 MCP 为只读模式时仍会拒绝此作用域。

### 5.2 `trash_page`

输入：

```json
{ "pageId": "uuid", "confirm": true }
```

要求：

- 具备 `mcp:destructive` 作用域，且 MCP 为读写模式；
- 通过严格 DTO 校验，并且 `confirm` 必须为字面值 `true`；
- 页面属于当前认证工作区，且尚未删除；
- 通过现有 `PageAccessService.validateCanEdit` 检查；
- 调用与 Web 控制器相同的核心页面生命周期命令；
- 保留现有的后代页面移入回收站、分享撤销、搜索/AI 事件、目录树 WebSocket
  事件和 `page.trashed` 审计。

MCP annotation 使用 `destructiveHint=true`。结果只包含页面 ID、标题、空间 ID
和 `trashed=true`。

### 5.3 `restore_page`

输入：

```json
{ "pageId": "uuid" }
```

要求：

- 具备 `mcp:write` 作用域，且 MCP 为读写模式；
- 页面属于当前认证工作区，且当前处于已删除状态；
- 通过现有空间编辑和页面编辑权限检查；
- 调用与 Web 控制器相同的核心生命周期命令；
- 保留后代页面恢复、与已删除父页面解除关联、搜索/AI 事件、目录树 WebSocket
  事件和 `page.restored` 审计。

结果只包含页面 ID、标题、空间 ID 和 `restored=true`。

### 5.4 审计与活动展示

业务事件和 `mcp.tool_called` 都会保留。MCP 审计元数据包含工具名称、凭据标识、
页面/空间 ID、已有的标题与路径快照、成功状态和长度受限的错误信息，不包含页面正文或凭据。

## 6. 前端变化

- 编辑和只读视图中的代码块都增加标题、自动换行和下载控件。
- API Key 自定义作用域增加 `mcp:destructive`；专用的维护预设需要显式选择，且不是默认值。
- owner OAuth 管理增加独立的破坏性工具开关。切换为只读模式会清除破坏性访问权限。
- OAuth 同意页面和授权列表会单独展示破坏性作用域。
- 所有新增的用户可见文本均加入现有 12 个语言文件。

不新增页面、设置分区、状态管理库或设计系统。

## 7. 验证与回滚

验证范围：

- 代码块 JSON/HTML/Markdown/Yjs/协同编辑兼容性；
- 文件名路径穿越与 Blob URL 清理测试；
- 重构前后 20 个工具的精确契约对比；
- API Key/OAuth 历史作用域规范化和授权不提权；
- 移入回收站/恢复操作的 owner、成员、受限页面、跨工作区、只读和作用域矩阵；
- WebSocket/事件及业务/MCP 审计断言；
- 完整的服务端、客户端、editor-ext 测试、lint 和生产构建；
- 提交前扫描已跟踪代码树中的隐私信息。

回滚不需要内容或数据库迁移。旧客户端会忽略未知代码块属性。移除新增 MCP 工具后，
已移入回收站的页面仍可通过现有 Web 回收站界面恢复。现有凭据继续使用原有作用域。

## 8. 实现结果

- 代码块现在会持久化 `title` 和 `wrap`，并提供标题、自动换行、复制和下载控件，
  同时保留原有 Mermaid 源码与预览流程。
- 原有 20 个 MCP 工具由注册契约快照锁定，并通过同一个执行器后的页面、评论、空间、
  搜索和成员提供器实现。
- `trash_page` 要求 `mcp:destructive` 和字面值 `confirm=true`；
  `restore_page` 要求 `mcp:write`。
- Web 与 MCP 页面生命周期命令共用 `PageLifecycleService`，包括工作区绑定、页面与空间权限、
  业务审计、递归页面事件、搜索/AI 更新和侧边栏 WebSocket 更新。
- API Key 默认值、OAuth 默认值、现有凭据和现有授权都不会隐式获得破坏性访问。
- 评论删除仍按设计延期，因为当前操作是硬删除，不能满足可逆删除语义。

## 9. 实现位置

| 关注点                  | 实现位置                                                                       |
| ----------------------- | ------------------------------------------------------------------------------ |
| 代码块 schema           | `packages/editor-ext/src/lib/custom-code-block/custom-code-block.ts`           |
| 代码块界面              | `apps/client/src/features/editor/components/code-block/code-block-view.tsx`    |
| 安全的源码下载          | `apps/client/src/features/editor/components/code-block/code-block-download.ts` |
| MCP 会话传输            | `apps/server/src/ee/mcp/mcp.service.ts`                                        |
| 工具注册                | `apps/server/src/ee/mcp/mcp-tool-registry.service.ts`                          |
| 作用域、DTO、审计与错误 | `apps/server/src/ee/mcp/mcp-tool-executor.service.ts`                          |
| MCP 页面访问复用逻辑    | `apps/server/src/ee/mcp/mcp-tool-access.service.ts`                            |
| 工具提供器              | `apps/server/src/ee/mcp/tools/*.tools.ts`                                      |
| 回收站/恢复共用流程     | `apps/server/src/core/page/services/page-lifecycle.service.ts`                 |
| API Key 作用域          | `apps/server/src/core/api-key/api-key-scopes.ts`                               |
| OAuth 作用域            | `apps/server/src/ee/oauth/oauth.constants.ts`                                  |

不需要数据库迁移。代码块偏好属于 ProseMirror 节点属性，新增 MCP 作用域存储在现有作用域数组中。

## 10. 管理员与用户操作流程

### 10.1 代码块

编辑模式下，代码块工具栏包含可选标题字段、语言选择、自动换行开关、复制和下载操作。
Mermaid 代码块保留源码/预览切换。只读页面在标题存在时显示标题，并在不预留空标题行的
情况下提供复制和下载操作。

`wrap` 只改变 CSS 显示。复制和下载始终使用原始源码文本。标准 Markdown 导出按设计
不包含 `title` 和 `wrap`。

### 10.2 开启可逆 MCP 维护能力

- API Key：选择显式的 `MCP maintenance` 预设，或在自定义作用域中增加
  `mcp:destructive`。
- OAuth：owner 保持读写访问模式，并为 ChatGPT 客户端开启
  `Destructive MCP tools`。
- 现有 OAuth 授权不会自动扩权。客户端必须请求新增作用域，用户必须重新完成授权。
- 作用域或工作区模式变更会使现有 MCP 会话失效；使用新权限调用工具前需要重新连接。

工具输入示例：

```json
{ "pageId": "00000000-0000-4000-8000-000000000000", "confirm": true }
```

```json
{ "pageId": "00000000-0000-4000-8000-000000000000" }
```

第一个输入用于 `trash_page`，第二个用于 `restore_page`。`trash_page` 会拒绝缺失确认
或确认值为 `false` 的请求。两个工具都不会永久删除页面。

### 10.3 审计行为

每次成功的维护操作都会产生：

1. 现有页面业务事件（`page.trashed` 或 `page.restored`）；
2. 标识凭据、工具、目标页面、结果和成功状态的 `mcp.tool_called` 事件。

当查看者有权读取审计条目时，审计资源解析器会补充空间名称、页面路径和标题。
MCP 审计元数据不会存储页面正文、评论正文、API 密钥、OAuth 令牌或授权码。

## 11. 验证记录

| 验证项        | 结果                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------- |
| 服务端 Jest   | 69 个测试套件、372 个测试通过                                                               |
| 客户端 Vitest | 13 个测试文件、106 个测试通过                                                               |
| MCP 历史契约  | 20 个工具；名称、顺序、说明、Zod 类型、可选标记、枚举/字面值、作用域和 annotations 快照通过 |
| TypeScript    | editor extension、服务端和客户端通过                                                        |
| ESLint        | 无错误；仍保留已有的客户端警告                                                              |
| 生产构建      | editor extension、服务端和客户端通过                                                        |
| Nest 依赖解析 | 应用已运行到数据库引导阶段，未出现未知依赖错误                                              |
| 隐私检查      | 新增行和最终已跟踪代码树均通过私有部署标记、服务器路径、私钥及常见令牌格式扫描              |

本地生产启动探测因本地数据库/缓存依赖不可用而停止，不属于端到端部署测试。侧边栏事件行为由
现有页面生命周期 WebSocket 监听器测试覆盖。
