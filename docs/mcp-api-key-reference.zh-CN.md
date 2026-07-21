# Docmost MCP API 密钥接入文档

本文档说明如何使用 Docmost API 密钥，通过 MCP Streamable HTTP 接口读取和维护
Docmost 中的空间、页面、附件、评论及成员信息。

本文档仅涉及 API 密钥鉴权，不包含 OAuth。

## 1. 接入信息

| 项目              | 值                                    |
| ----------------- | ------------------------------------- |
| 传输协议          | MCP Streamable HTTP                   |
| MCP 地址          | `https://docs.example.com/mcp`        |
| HTTP 方法         | `POST`、`GET`、`DELETE`               |
| 鉴权方式          | `Authorization: Bearer <API_KEY>`     |
| 内容类型          | `application/json`                    |
| Accept            | `application/json, text/event-stream` |
| 推荐 MCP 协议版本 | `2025-11-25`                          |

请将 `https://docs.example.com` 替换为实际 Docmost 公网地址。MCP 地址末尾必须包含
`/mcp`，不要写成 `/api/mcp`。

## 2. 前置条件

1. 工作区所有者已在管理设置中启用 MCP，并选择：
   - `read-only`：仅允许读取类工具。
   - `read-write`：允许读取和写入类工具。
2. 当前用户有权创建 MCP 密钥。
3. 在“账户 -> MCP 连接 -> MCP 密钥”中创建密钥，并选择需要的 MCP 权限和空间范围。
4. 创建后立即保存密钥。完整密钥只显示一次。
5. API 密钥未过期、未撤销，且创建密钥的用户未被删除或停用。

API 密钥始终代表创建它的 Docmost 用户。它不会获得比该用户更多的空间或页面权限。

REST API 密钥和 MCP 密钥是两种独立类型。REST API 密钥只能访问 `/api/...`，不能连接
`/mcp`；MCP 密钥只能连接 `/mcp`，不能调用 REST API。密钥创建后不能切换类型。

## 3. API 密钥权限范围

| Scope             | 用途                                           | 可调用工具         |
| ----------------- | ---------------------------------------------- | ------------------ |
| `mcp:read`        | 读取数据                                       | 所有读取类工具     |
| `mcp:write`       | 修改数据，同时隐含 `mcp:read`                  | 读取类和写入类工具 |
| `mcp:destructive` | 破坏性维护，同时隐含 `mcp:write` 和 `mcp:read` | 包含 `trash_page`  |

建议使用界面中的预设：

| 预设     | Scope                                      |
| -------- | ------------------------------------------ |
| MCP 只读 | `mcp:read`                                 |
| MCP 读写 | `mcp:read`, `mcp:write`                    |
| MCP 维护 | `mcp:read`, `mcp:write`, `mcp:destructive` |

`mcp:destructive` 不属于默认权限。只有确实需要通过 MCP 将页面移入回收站时才应启用。

即使密钥包含 `mcp:write`，当工作区 MCP 模式为 `read-only` 时，服务端仍会拒绝所有
写入操作。

## 4. 推荐：使用 MCP SDK

以下示例使用 TypeScript MCP SDK。SDK 会自动完成初始化、保存
`Mcp-Session-Id`、发送初始化通知并管理连接。

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcpUrl = process.env.DOCMOST_MCP_URL!;
const apiKey = process.env.DOCMOST_MCP_TOKEN!;

const client = new Client({
  name: "docmost-api-key-client",
  version: "1.0.0",
});

const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  },
});

await client.connect(transport);

const tools = await client.listTools();
console.log(tools.tools.map((tool) => tool.name));

const result = await client.callTool({
  name: "get_page",
  arguments: {
    pageId: "00000000-0000-4000-8000-000000000000",
    format: "markdown",
  },
});
console.log(result.content);

await transport.terminateSession();
```

环境变量示例：

```bash
export DOCMOST_MCP_URL="https://docs.example.com/mcp"
export DOCMOST_MCP_TOKEN="<API_KEY>"
```

不要把 API 密钥写入源码、提交到 Git，或输出到应用日志。

## 5. 原始 HTTP 调用

正常客户端应优先使用 MCP SDK。以下原始 HTTP 示例适合联调和排障。

### 5.1 初始化会话

```bash
curl -sS -i \
  -X POST "$DOCMOST_MCP_URL" \
  -H "Authorization: Bearer $DOCMOST_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": {
        "name": "curl-client",
        "version": "1.0.0"
      }
    }
  }'
```

从响应头保存 `Mcp-Session-Id`。后续请求必须携带相同 API 密钥和会话 ID。

```bash
export DOCMOST_MCP_SESSION="<Mcp-Session-Id>"
```

### 5.2 通知初始化完成

```bash
curl -sS \
  -X POST "$DOCMOST_MCP_URL" \
  -H "Authorization: Bearer $DOCMOST_MCP_TOKEN" \
  -H "Mcp-Session-Id: $DOCMOST_MCP_SESSION" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{
    "jsonrpc": "2.0",
    "method": "notifications/initialized"
  }'
```

### 5.3 获取工具列表

```bash
curl -sS \
  -X POST "$DOCMOST_MCP_URL" \
  -H "Authorization: Bearer $DOCMOST_MCP_TOKEN" \
  -H "Mcp-Session-Id: $DOCMOST_MCP_SESSION" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

### 5.4 调用工具

```bash
curl -sS \
  -X POST "$DOCMOST_MCP_URL" \
  -H "Authorization: Bearer $DOCMOST_MCP_TOKEN" \
  -H "Mcp-Session-Id: $DOCMOST_MCP_SESSION" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search_pages",
      "arguments": {
        "query": "部署手册",
        "limit": 20
      }
    }
  }'
```

### 5.5 关闭会话

```bash
curl -sS \
  -X DELETE "$DOCMOST_MCP_URL" \
  -H "Authorization: Bearer $DOCMOST_MCP_TOKEN" \
  -H "Mcp-Session-Id: $DOCMOST_MCP_SESSION" \
  -H "MCP-Protocol-Version: 2025-11-25"
```

## 6. 通用请求与响应

工具调用请求：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_page",
    "arguments": {
      "pageId": "00000000-0000-4000-8000-000000000000",
      "format": "markdown"
    }
  }
}
```

成功结果通常是 MCP 文本内容，其中 `text` 是 JSON 字符串或普通文本：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"id\":\"...\",\"title\":\"部署手册\",\"content\":\"# 部署手册\"}"
      }
    ]
  }
}
```

业务错误可能以 MCP 工具错误返回：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Page not found"
      }
    ],
    "isError": true
  }
}
```

调用方应同时检查：

1. HTTP 状态码。
2. JSON-RPC 顶层 `error`。
3. 工具结果中的 `isError`。

## 7. 通用参数规则

| 规则     | 说明                                                                |
| -------- | ------------------------------------------------------------------- |
| ID       | 除 `get_page` 兼容页面 UUID 或 10 位页面短 ID 外，建议始终使用 UUID |
| `limit`  | 默认 50，最小 1，最大 200；超出范围会被服务端限制                   |
| 搜索文本 | 去除首尾空格后长度为 1 至 256 个字符                                |
| 页面内容 | 最大 500,000 个字符                                                 |
| 评论内容 | 最大 500,000 个字符，必须是 ProseMirror JSON 字符串                 |
| 页面格式 | `json`、`markdown` 或 `html`                                        |
| 更新方式 | `replace`、`append` 或 `prepend`                                    |

页面格式说明：

- `json`：Docmost 内部 ProseMirror JSON，适合无损读取和高级编辑。
- `markdown`：由内部富文本重新序列化得到，不保证与最初导入的 Markdown 源文件逐字一致。
- `html`：由内部富文本转换得到的 HTML。
- `get_page` 未传 `format` 时返回内部 JSON。
- `create_page` 和 `update_page` 未传 `format` 时按 Markdown 处理。
- `update_page` 未传 `operation` 时使用 `replace`。

## 8. 工具总览

### 8.1 读取类工具

需要 `mcp:read`。

| 工具                     | 作用                             |
| ------------------------ | -------------------------------- |
| `get_page`               | 获取页面及内容                   |
| `list_pages`             | 列出空间根页面                   |
| `list_child_pages`       | 列出指定页面的直接子页面         |
| `search_pages`           | 搜索页面                         |
| `search_attachments`     | 搜索 PDF、DOCX 等附件文本        |
| `get_space`              | 获取空间信息                     |
| `list_spaces`            | 列出当前用户可访问的空间         |
| `get_comments`           | 获取页面评论                     |
| `list_workspace_members` | 列出工作区成员，需要成员管理权限 |
| `get_current_user`       | 获取 API 密钥绑定的当前用户      |

### 8.2 写入类工具

需要 `mcp:write`，且工作区 MCP 模式必须为 `read-write`。

| 工具                 | 作用                             |
| -------------------- | -------------------------------- |
| `create_page`        | 创建页面或子页面                 |
| `update_page`        | 更新页面标题或内容               |
| `duplicate_page`     | 在当前空间复制页面               |
| `copy_page_to_space` | 复制页面到其他空间               |
| `move_page`          | 在同一空间更换父页面或移到根目录 |
| `move_page_to_space` | 将页面移动到其他空间             |
| `restore_page`       | 从回收站恢复页面及其后代         |
| `create_space`       | 创建空间                         |
| `update_space`       | 更新空间                         |
| `create_comment`     | 创建页面级评论                   |
| `update_comment`     | 更新当前用户创建的评论           |

### 8.3 破坏性工具

需要 `mcp:destructive`，同时要求 `confirm: true`。

| 工具         | 作用                                                 |
| ------------ | ---------------------------------------------------- |
| `trash_page` | 将页面及其后代移入回收站，可通过 `restore_page` 恢复 |

MCP 当前不提供永久删除页面和删除评论工具。

## 9. 页面工具

### 9.1 `get_page`

获取一个有权查看的活动页面。

| 参数     | 类型   | 必填 | 说明                                      |
| -------- | ------ | ---- | ----------------------------------------- |
| `pageId` | string | 是   | 页面 UUID 或 10 位页面短 ID               |
| `format` | enum   | 否   | `json`、`markdown`、`html`；默认返回 JSON |

主要返回字段：

```json
{
  "id": "页面 UUID",
  "slugId": "页面短 ID",
  "title": "页面标题",
  "icon": "图标",
  "spaceId": "空间 UUID",
  "parentPageId": "父页面 UUID 或 null",
  "creatorId": "创建者 UUID",
  "content": "指定格式的内容",
  "createdAt": "创建时间",
  "updatedAt": "更新时间"
}
```

示例：

```json
{
  "name": "get_page",
  "arguments": {
    "pageId": "00000000-0000-4000-8000-000000000000",
    "format": "markdown"
  }
}
```

### 9.2 `create_page`

在空间根目录或指定父页面下创建页面。

| 参数           | 类型   | 必填 | 说明                                        |
| -------------- | ------ | ---- | ------------------------------------------- |
| `spaceId`      | UUID   | 是   | 目标空间                                    |
| `title`        | string | 否   | 页面标题                                    |
| `content`      | string | 否   | 页面内容                                    |
| `format`       | enum   | 否   | `json`、`markdown`、`html`；默认 `markdown` |
| `parentPageId` | UUID   | 否   | 父页面；必须属于同一空间                    |

返回：

```json
{
  "id": "新页面 UUID",
  "slugId": "新页面短 ID",
  "title": "页面标题"
}
```

创建子页面示例：

```json
{
  "name": "create_page",
  "arguments": {
    "spaceId": "00000000-0000-4000-8000-000000000001",
    "parentPageId": "00000000-0000-4000-8000-000000000002",
    "title": "部署检查表",
    "format": "markdown",
    "content": "# 部署检查表\n\n- [ ] 构建\n- [ ] 健康检查"
  }
}
```

### 9.3 `update_page`

更新页面标题、内容，或同时更新两者。

| 参数        | 类型   | 必填 | 说明                                           |
| ----------- | ------ | ---- | ---------------------------------------------- |
| `pageId`    | UUID   | 是   | 页面 ID                                        |
| `title`     | string | 否   | 新标题                                         |
| `content`   | string | 否   | 新增或替换的内容                               |
| `format`    | enum   | 否   | `json`、`markdown`、`html`；默认 `markdown`    |
| `operation` | enum   | 否   | `replace`、`append`、`prepend`；默认 `replace` |

返回：

```json
{
  "id": "页面 UUID",
  "title": "更新后的标题"
}
```

追加 Markdown 示例：

```json
{
  "name": "update_page",
  "arguments": {
    "pageId": "00000000-0000-4000-8000-000000000000",
    "format": "markdown",
    "operation": "append",
    "content": "\n\n## 验证结果\n\n部署成功。"
  }
}
```

页面中受保护的看板块等业务资源仍会执行统一内容生命周期校验。不能通过
`replace` 绕过正常删除确认或页面关系约束。

### 9.4 `list_pages`

列出一个空间中的根页面。

| 参数      | 类型   | 必填 | 说明              |
| --------- | ------ | ---- | ----------------- |
| `spaceId` | UUID   | 是   | 空间 ID           |
| `limit`   | number | 否   | 默认 50，最大 200 |

返回当前用户有权查看的根页面数组。

### 9.5 `list_child_pages`

列出指定页面的直接子页面，不递归读取后代。

| 参数      | 类型   | 必填 | 说明                      |
| --------- | ------ | ---- | ------------------------- |
| `spaceId` | UUID   | 是   | 空间 ID                   |
| `pageId`  | UUID   | 是   | 父页面 ID，必须属于该空间 |
| `limit`   | number | 否   | 默认 50，最大 200         |

### 9.6 `duplicate_page`

在原空间复制页面及允许复制的后代。

| 参数     | 类型 | 必填 | 说明      |
| -------- | ---- | ---- | --------- |
| `pageId` | UUID | 是   | 源页面 ID |

调用者必须能够编辑源页面，并有权在原空间创建页面。

### 9.7 `copy_page_to_space`

将页面复制到另一个空间，源页面保持不变。

| 参数      | 类型 | 必填 | 说明        |
| --------- | ---- | ---- | ----------- |
| `pageId`  | UUID | 是   | 源页面 ID   |
| `spaceId` | UUID | 是   | 目标空间 ID |

调用者必须能够编辑源页面，并有权在目标空间创建页面。

### 9.8 `move_page`

在同一空间内更换父页面。

| 参数           | 类型 | 必填 | 说明                             |
| -------------- | ---- | ---- | -------------------------------- |
| `pageId`       | UUID | 是   | 要移动的页面                     |
| `parentPageId` | UUID | 否   | 新父页面；省略时移动到空间根目录 |

服务端会拒绝跨空间父页面、自身后代循环、无权编辑的父页面，以及受看板等扩展策略
限制的移动。

### 9.9 `move_page_to_space`

将页面移动到另一个空间。

| 参数      | 类型 | 必填 | 说明         |
| --------- | ---- | ---- | ------------ |
| `pageId`  | UUID | 是   | 要移动的页面 |
| `spaceId` | UUID | 是   | 目标空间     |

调用者需要源空间和目标空间的相应编辑权限。受看板管理的工作项等页面可能禁止跨空间
移动。

### 9.10 `trash_page`

将页面及其后代移入回收站。

| 参数      | 类型    | 必填 | 说明          |
| --------- | ------- | ---- | ------------- |
| `pageId`  | UUID    | 是   | 页面 ID       |
| `confirm` | literal | 是   | 必须为 `true` |

要求：

- API 密钥包含 `mcp:destructive`。
- 工作区 MCP 模式为 `read-write`。
- 用户有权编辑该页面。
- 页面扩展策略允许该操作。

返回：

```json
{
  "id": "页面 UUID",
  "title": "页面标题",
  "spaceId": "空间 UUID",
  "trashed": true
}
```

### 9.11 `restore_page`

恢复回收站页面及其后代。

| 参数     | 类型 | 必填 | 说明                  |
| -------- | ---- | ---- | --------------------- |
| `pageId` | UUID | 是   | 已进入回收站的页面 ID |

恢复仍会重新检查空间权限、页面权限、父子关系和扩展业务约束。

## 10. 搜索工具

### 10.1 `search_pages`

| 参数      | 类型   | 必填 | 说明                      |
| --------- | ------ | ---- | ------------------------- |
| `query`   | string | 是   | 搜索文本，1 至 256 个字符 |
| `spaceId` | UUID   | 否   | 限定空间                  |
| `limit`   | number | 否   | 默认 50，最大 200         |

搜索结果只包含当前用户有权查看的页面。

### 10.2 `search_attachments`

| 参数    | 类型   | 必填 | 说明              |
| ------- | ------ | ---- | ----------------- |
| `query` | string | 是   | 附件文本搜索词    |
| `limit` | number | 否   | 默认 50，最大 200 |

用于搜索已建立文本索引且当前用户有权访问的附件，例如 PDF、DOCX。

## 11. 空间工具

### 11.1 `get_space`

| 参数      | 类型   | 必填 | 说明    |
| --------- | ------ | ---- | ------- |
| `spaceId` | string | 是   | 空间 ID |

用户需要该空间的设置读取权限。

### 11.2 `list_spaces`

无参数。返回当前 API 密钥用户有权访问的空间，单次最多 100 个。

### 11.3 `create_space`

| 参数          | 类型   | 必填 | 说明                  |
| ------------- | ------ | ---- | --------------------- |
| `name`        | string | 是   | 2 至 100 个字符       |
| `slug`        | string | 是   | 2 至 100 个字母或数字 |
| `description` | string | 否   | 空间描述              |

用户需要工作区的空间管理权限。

### 11.4 `update_space`

| 参数          | 类型   | 必填 | 说明    |
| ------------- | ------ | ---- | ------- |
| `spaceId`     | UUID   | 是   | 空间 ID |
| `name`        | string | 否   | 新名称  |
| `description` | string | 否   | 新描述  |

用户需要该空间的设置管理权限。

## 12. 评论工具

### 12.1 `get_comments`

| 参数     | 类型   | 必填 | 说明              |
| -------- | ------ | ---- | ----------------- |
| `pageId` | UUID   | 是   | 页面 ID           |
| `limit`  | number | 否   | 默认 50，最大 200 |

### 12.2 `create_comment`

创建页面级评论。

| 参数      | 类型   | 必填 | 说明                         |
| --------- | ------ | ---- | ---------------------------- |
| `pageId`  | UUID   | 是   | 页面 ID                      |
| `content` | string | 是   | ProseMirror 文档 JSON 字符串 |

最小内容示例：

```json
{
  "name": "create_comment",
  "arguments": {
    "pageId": "00000000-0000-4000-8000-000000000000",
    "content": "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"已完成检查。\"}]}]}"
  }
}
```

### 12.3 `update_comment`

| 参数        | 类型   | 必填 | 说明                         |
| ----------- | ------ | ---- | ---------------------------- |
| `commentId` | UUID   | 是   | 评论 ID                      |
| `content`   | string | 是   | ProseMirror 文档 JSON 字符串 |

只能修改当前 API 密钥用户自己创建的评论。

## 13. 成员工具

### 13.1 `list_workspace_members`

| 参数    | 类型   | 必填 | 说明              |
| ------- | ------ | ---- | ----------------- |
| `limit` | number | 否   | 默认 50，最大 200 |

除 `mcp:read` 外，用户还必须具备工作区成员管理权限。普通成员即使持有 API 密钥也不能
通过该工具枚举成员。

### 13.2 `get_current_user`

无参数。返回 API 密钥所绑定的用户：

```json
{
  "id": "用户 UUID",
  "name": "用户名称",
  "email": "用户邮箱",
  "role": "owner | admin | member",
  "avatarUrl": "头像地址或 null"
}
```

## 14. 权限判定顺序

一次工具调用至少经过以下检查：

1. Bearer Token 是否存在且签名有效。
2. Token 中的工作区是否与当前访问域名解析出的工作区一致。
3. API 密钥是否存在、未撤销、未过期。
4. API 密钥创建者是否仍是有效用户。
5. 工作区是否启用 MCP。
6. 工作区 MCP 模式是否允许读取或写入。
7. API 密钥是否具备工具要求的 MCP scope。
8. 用户是否具有目标空间的角色权限。
9. 用户是否具有目标页面的页面级权限。
10. 页面是否受到看板或其他扩展业务策略限制。

API 密钥 scope 只是权限上限，不会绕过后续任何权限检查。

## 15. HTTP 状态码与常见错误

| 状态码 | 常见原因                                             | 处理方式                         |
| ------ | ---------------------------------------------------- | -------------------------------- |
| `400`  | JSON-RPC、协议版本或输入格式无效                     | 检查请求体和 DTO 约束            |
| `401`  | 缺少、无效、过期或被撤销的 API 密钥                  | 重新创建或更换密钥               |
| `403`  | MCP 未启用、scope 不足、只读模式、空间或页面权限不足 | 检查工作区设置、scope 和用户权限 |
| `404`  | MCP 会话不存在，或目标资源不存在                     | 重新初始化会话或核对资源 ID      |
| `429`  | 活跃 MCP 会话过多                                    | 关闭旧会话并稍后重试             |

常见服务端消息：

| 消息                                                   | 含义                             |
| ------------------------------------------------------ | -------------------------------- |
| `A bearer token is required`                           | 未提供 `Authorization`           |
| `Invalid bearer token`                                 | Token 格式或签名无效             |
| `Invalid API key`                                      | 密钥被撤销、过期或记录不存在     |
| `Workspace does not match`                             | 密钥所属工作区与访问域名不一致   |
| `MCP is not enabled for this workspace`                | 工作区未启用 MCP                 |
| `MCP is enabled in read-only mode`                     | 当前工作区禁止写入工具           |
| `Missing API key scope: mcp:read`                      | 缺少读取 scope                   |
| `Missing API key scope: mcp:write`                     | 缺少写入 scope                   |
| `Missing API key scope: mcp:destructive`               | 缺少破坏性 scope                 |
| `Session not found`                                    | 会话过期、服务重启或会话 ID 错误 |
| `MCP session permissions changed. Reconnect required.` | 会话期间 mode 或 scope 发生变化  |
| `Too many active MCP sessions`                         | 达到服务端会话上限               |

## 16. 会话行为

默认配置下：

| 项目                    | 默认值 |
| ----------------------- | ------ |
| 全局最大会话数          | 500    |
| 每个 API 密钥最大会话数 | 30     |
| 空闲超时                | 5 分钟 |

这些值可以由服务端环境变量调整：

- `MCP_MAX_SESSIONS`
- `MCP_MAX_SESSIONS_PER_CREDENTIAL`
- `MCP_SESSION_IDLE_TTL_SECONDS`

会话保存在服务端内存中。服务重启后客户端必须重新初始化。多实例部署需要粘性会话或共享
会话存储，否则同一 `Mcp-Session-Id` 被路由到其他实例时会返回 404。

## 17. 审计

服务端会记录：

- MCP 鉴权失败。
- MCP 会话创建、关闭和空闲过期。
- 每次工具调用的用户、认证类型、API 密钥 ID、工具名、读写级别、成功状态、目标资源、
  IP、User-Agent 和错误摘要。
- 页面或空间等资源的可读名称和路径快照。

审计不会保存：

- API 密钥原文。
- 页面或评论全文。
- 附件正文。

用户可以在账户中的“MCP 活动”查看自己的调用记录；工作区所有者可以在审计日志中查看
工作区范围的记录。

## 18. 安全建议

1. 优先创建仅含 `mcp:read` 的专用密钥。
2. 不要为普通问答客户端授予 `mcp:destructive`。
3. 为每个客户端创建独立密钥，使用清晰名称并设置较短有效期。
4. 不要在浏览器前端、移动端包或公开仓库中嵌入密钥。
5. 仅通过 HTTPS 暴露 `/mcp`。
6. 反向代理必须转发 `Authorization`、`Mcp-Session-Id`、
   `MCP-Protocol-Version` 和流式响应。
7. 怀疑泄露时立即在“账户 -> API 密钥”撤销密钥。
8. 定期检查“MCP 活动”和所有者审计日志。

## 19. 联调检查表

- [ ] 公网地址使用 HTTPS，且 `/mcp` 可访问。
- [ ] 工作区 MCP 模式不是 `off`。
- [ ] API 密钥包含所需 `mcp:*` scope。
- [ ] 请求使用 `Authorization: Bearer <API_KEY>`。
- [ ] 初始化请求包含受支持的 MCP 协议版本。
- [ ] 后续请求携带初始化响应中的 `Mcp-Session-Id`。
- [ ] 反向代理没有移除 Authorization 或 MCP 请求头。
- [ ] API 密钥用户可以在网页中访问同一空间和页面。
- [ ] 客户端同时处理 HTTP、JSON-RPC 和 `isError` 三类错误。
- [ ] 使用结束后主动关闭会话。
