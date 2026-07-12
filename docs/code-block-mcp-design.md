# Code Block and MCP Maintenance Design

> Status: implemented and verified in `efba9a38` on
> `feat/native-database-fusion`.
> The stable Todo and implementation reviews remain in
> [`forkmost-integration.md`](./forkmost-integration.md).

## 1. Goals

This delivery has three ordered goals:

1. Add code block title, visual wrapping, and source download without changing
   existing code or Mermaid behavior.
2. Split MCP tool declaration and execution out of the session service without
   changing the external contract of the existing 20 tools.
3. Add reversible page maintenance through `trash_page` and `restore_page`.

Non-goals:

- No private Markdown syntax for code block display preferences.
- No permanent page deletion through MCP.
- No comment deletion in this delivery. The current comment operation is a hard
  delete and needs a separate retention and recovery design.
- No new frontend, backend, validation, state, or icon libraries.

## 2. Repository Privacy

Repository content must not contain personal identity data or private deployment
details. Tests and documentation use `example.test`, RFC 5737 addresses, and
generic paths only.

Never commit:

- private domains, IP addresses, ports, SSH targets, or server directory layouts;
- certificate/key paths or contents;
- API keys, OAuth tokens, registry credentials, or environment values;
- deployment logs containing the above data.

Before each commit, scan tracked changes and the resulting tree for private
deployment markers and common secret formats. Deployment-specific instructions
belong in local ignored skills or server-side configuration, not project docs.

## 3. Code Block Design

### 3.1 Data model

Extend the existing `codeBlock` node with:

| Attribute | Type             | Default | HTML representation |
| --------- | ---------------- | ------- | ------------------- |
| `title`   | `string \| null` | `null`  | `data-title`        |
| `wrap`    | `boolean`        | `false` | `data-wrap="true"`  |

Title normalization removes control characters and line breaks, trims the value,
and limits it to 120 characters. Existing JSON and HTML without these attributes
continue to parse with the defaults.

### 3.2 UI behavior

The existing React NodeView remains the only code block UI:

- editable mode: title input, language selector, wrap toggle, source toggle for
  Mermaid, copy, and download;
- read-only/shared mode: optional title plus copy and download controls;
- title is single-line and ellipsized so long values cannot resize the block;
- wrap changes presentation only and never modifies source text;
- Mermaid preview/source toggling and double-click behavior remain unchanged;
- mobile controls wrap within a stable toolbar without covering code.

Buttons use existing Mantine and Tabler components with tooltips. No global event
listener is added beyond the existing Mermaid outside-click listener.

### 3.3 Download safety

Download is entirely local through `Blob` and an object URL. It does not call an
API or upload content.

The filename helper:

- strips path separators, control characters, dot traversal, and reserved names;
- limits the complete filename to 120 characters;
- preserves a safe explicit extension;
- otherwise maps known code languages to an extension;
- falls back to `code-block.txt`.

Object URLs and temporary anchors are always released. The source is downloaded
as UTF-8 text without executing or rendering it.

### 3.4 Compatibility

- JSON, HTML, Yjs, and collaborative undo preserve `title` and `wrap`.
- Standard Markdown exports only the language and source fence. `title` and
  `wrap` intentionally degrade because CommonMark has no portable equivalent.
- Markdown imports and historical documents use `title=null` and `wrap=false`.
- Page history requires no migration because attributes live in ProseMirror JSON.

## 4. MCP Refactor Design

### 4.1 Module boundaries

`McpService` retains only protocol and session lifecycle. Tool behavior moves to:

- `McpToolRegistryService`: aggregates providers and registers descriptors;
- `McpToolExecutorService`: the only mode/scope/DTO/audit/error wrapper;
- `McpToolAccessService`: shared page lookup, pagination, CASL, and page-access
  helpers;
- `tools/page.tools.ts`;
- `tools/comment.tools.ts`;
- `tools/space.tools.ts`;
- `tools/search.tools.ts`;
- `tools/member.tools.ts`.

Each provider returns strongly typed `McpToolDescriptor` objects. A descriptor
declares name, description, schema, access class, DTO mapping, handler, and MCP
annotations. Registration is rejected if a tool omits DTO/no-DTO policy or if a
name is duplicated.

### 4.2 Existing contract baseline

The first refactor preserves these tools exactly:

| Provider | Tools                                                                                                   | Access and permission baseline                          |
| -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Search   | `search_pages`, `search_attachments`                                                                    | `mcp:read`; existing search/page filtering              |
| Page     | `get_page`, `list_pages`, `list_child_pages`                                                            | `mcp:read`; page/space view checks                      |
| Page     | `create_page`, `update_page`, `duplicate_page`, `copy_page_to_space`, `move_page`, `move_page_to_space` | `mcp:write`; existing edit/create checks                |
| Space    | `get_space`, `list_spaces`                                                                              | `mcp:read`; existing settings/membership checks         |
| Space    | `create_space`, `update_space`                                                                          | `mcp:write`; existing workspace/space management checks |
| Comment  | `get_comments`                                                                                          | `mcp:read`; page view check                             |
| Comment  | `create_comment`, `update_comment`                                                                      | `mcp:write`; comment permission and ownership checks    |
| Member   | `list_workspace_members`, `get_current_user`                                                            | `mcp:read`; member listing retains `Manage Member`      |

Contract tests snapshot tool names, descriptions, input schemas, annotations,
DTO policy, and access class. Existing handler tests continue to verify results,
workspace binding, page restrictions, and audit redaction.

### 4.3 Executor invariants

Every call passes one executor in this order:

1. workspace MCP mode;
2. API Key/OAuth scopes;
3. DTO transformation and `class-validator` validation;
4. provider handler and its CASL/page permission checks;
5. success/failure audit with sanitized target/result metadata.

Tool providers cannot bypass the executor. Write handlers call core services for
mutations; they do not write tables directly. Errors may include a bounded public
message but never document bodies, comments, credentials, or tokens.

## 5. Reversible Page Tools

### 5.1 Scope model

Add `mcp:destructive` to API Key and OAuth scope registries.

- It implies `mcp:write` and `mcp:read` during normalization.
- Existing keys, OAuth clients, grants, authorization codes, and refresh tokens do
  not gain it automatically.
- Default and “full access” API Key presets remain non-destructive.
- Owners explicitly enable destructive access for a key or OAuth client.
- Read-only workspace MCP mode still rejects it.

### 5.2 `trash_page`

Input:

```json
{ "pageId": "uuid", "confirm": true }
```

Requirements:

- `mcp:destructive` scope and read-write MCP mode;
- strict DTO and literal `confirm=true`;
- page belongs to the authenticated workspace and is not already deleted;
- existing `PageAccessService.validateCanEdit` succeeds;
- call the same core page lifecycle command used by the web controller;
- retain existing descendant trashing, share revocation, search/AI events, tree
  WebSocket event, and `page.trashed` audit.

MCP annotation uses `destructiveHint=true`. The result contains only page ID,
title, space ID, and `trashed=true`.

### 5.3 `restore_page`

Input:

```json
{ "pageId": "uuid" }
```

Requirements:

- `mcp:write` scope and read-write MCP mode;
- page belongs to the authenticated workspace and is currently deleted;
- existing space-edit and page-edit checks succeed;
- call the same core lifecycle command as the web controller;
- preserve descendant restoration, deleted-parent detachment, search/AI events,
  tree WebSocket event, and `page.restored` audit.

The result contains only page ID, title, space ID, and `restored=true`.

### 5.4 Audit and activity display

Both business events and `mcp.tool_called` are retained. MCP audit metadata includes
tool name, credential identity, page/space IDs, title/path snapshots when already
available, success, and bounded errors. It excludes page content and credentials.

## 6. Frontend Changes

- Code blocks gain title, wrap, and download controls in editable and read-only
  views.
- API Key custom scopes include `mcp:destructive`; a dedicated maintenance preset
  is explicit and not the default.
- Owner OAuth management adds an independent destructive-tools switch. Enabling
  read-only mode clears destructive access.
- OAuth consent and authorization tables display the destructive scope distinctly.
- All new user-facing strings are added to the existing 12 locale files.

No new page, settings section, state library, or design system is introduced.

## 7. Verification and Rollback

Verification:

- code block JSON/HTML/Markdown/Yjs/collaboration compatibility;
- filename/path traversal and Blob URL cleanup tests;
- exact 20-tool pre/post-refactor contract comparison;
- API Key/OAuth legacy scope normalization and grant non-escalation;
- trash/restore owner/member/restricted-page/cross-workspace/read-only/scope matrix;
- WebSocket/event and business/MCP audit assertions;
- full server/client/editor-ext tests, lint, and production build;
- tracked-tree privacy scan before commit.

Rollback requires no content or database migration. Older clients ignore unknown
code block attributes. Removing new MCP tools leaves trashed pages recoverable from
the existing web trash UI. Existing credentials remain valid with their old scopes.

## 8. Implementation Result

- Code blocks now persist `title` and `wrap`, expose title/wrap/copy/download
  controls, and preserve the existing Mermaid source/preview flow.
- The original 20 MCP tools are locked by a registration contract snapshot and
  implemented by page, comment, space, search, and member providers behind one
  executor.
- `trash_page` requires `mcp:destructive` and literal `confirm=true`;
  `restore_page` requires `mcp:write`.
- Web and MCP page lifecycle commands share `PageLifecycleService`, including
  workspace binding, page and space permissions, business audit, recursive page
  events, search/AI updates, and sidebar WebSocket updates.
- API Key defaults, OAuth defaults, existing credentials, and existing grants do
  not receive destructive access implicitly.
- Comment deletion remains intentionally deferred because the current operation
  is a hard delete and cannot satisfy reversible-deletion semantics.

## 9. Implementation Map

| Concern                       | Implementation                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Code block schema             | `packages/editor-ext/src/lib/custom-code-block/custom-code-block.ts`           |
| Code block UI                 | `apps/client/src/features/editor/components/code-block/code-block-view.tsx`    |
| Safe source download          | `apps/client/src/features/editor/components/code-block/code-block-download.ts` |
| MCP session transport         | `apps/server/src/ee/mcp/mcp.service.ts`                                        |
| Tool registration             | `apps/server/src/ee/mcp/mcp-tool-registry.service.ts`                          |
| Scope, DTO, audit, and errors | `apps/server/src/ee/mcp/mcp-tool-executor.service.ts`                          |
| Shared MCP page access        | `apps/server/src/ee/mcp/mcp-tool-access.service.ts`                            |
| Tool providers                | `apps/server/src/ee/mcp/tools/*.tools.ts`                                      |
| Shared trash/restore workflow | `apps/server/src/core/page/services/page-lifecycle.service.ts`                 |
| API Key scopes                | `apps/server/src/core/api-key/api-key-scopes.ts`                               |
| OAuth scopes                  | `apps/server/src/ee/oauth/oauth.constants.ts`                                  |

There is no database migration. Code block preferences are ProseMirror node
attributes, and the new MCP scope is stored in existing scope arrays.

## 10. Operator and User Flow

### 10.1 Code blocks

In edit mode, the code block toolbar contains the optional title field,
language selector, wrap toggle, copy action, and download action. Mermaid blocks
retain their source/preview toggle. Read-only pages show the title when present
and reveal copy/download actions without reserving an empty title row.

`wrap` only changes CSS presentation. Copy and download always use the original
source text. Standard Markdown export intentionally omits `title` and `wrap`.

### 10.2 Enabling reversible MCP maintenance

- API Key: choose the explicit `MCP maintenance` preset or add
  `mcp:destructive` as a custom scope.
- OAuth: an owner keeps access in read-write mode and enables
  `Destructive MCP tools` for the ChatGPT client.
- Existing OAuth authorizations are not expanded. A client must request the new
  scope and the user must complete authorization again.
- Scope or workspace-mode changes invalidate existing MCP sessions; reconnect
  before invoking tools with the new permission set.

Example tool inputs:

```json
{ "pageId": "00000000-0000-4000-8000-000000000000", "confirm": true }
```

```json
{ "pageId": "00000000-0000-4000-8000-000000000000" }
```

The first input is for `trash_page`; the second is for `restore_page`.
`trash_page` rejects missing or false confirmation. Neither tool permanently
deletes a page.

### 10.3 Audit behavior

Each successful maintenance operation produces:

1. the existing page business event (`page.trashed` or `page.restored`);
2. an `mcp.tool_called` event identifying the credential, tool, target page,
   result, and success state.

The audit resource resolver adds the space name, page path, and title when the
viewer is allowed to read the audit entry. Page content, comment content, API
keys, OAuth tokens, and authorization codes are not stored in MCP audit metadata.

## 11. Verification Record

| Verification               | Result                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Server Jest                | 69 suites, 372 tests passed                                                                                                   |
| Client Vitest              | 13 files, 106 tests passed                                                                                                    |
| MCP legacy contract        | 20 tools; names, order, descriptions, Zod types, optional flags, enum/literal values, scopes, and annotations snapshot passed |
| TypeScript                 | editor extension, server, and client passed                                                                                   |
| ESLint                     | no errors; existing client warnings remain                                                                                    |
| Production builds          | editor extension, server, and client passed                                                                                   |
| Nest dependency resolution | reached application database bootstrap without an unknown dependency error                                                    |
| Privacy                    | added lines and final tracked tree passed private deployment marker, server path, private key, and common token scans         |

The local production-start probe stopped at unavailable local database/cache
dependencies; it was not an end-to-end deployment test. Sidebar event behavior
is covered by the existing page lifecycle WebSocket listener tests.
