# 代码块读取模式设计与实施清单

## 1. 目标

修复页面从编辑模式切换到读取模式后，代码块仍显示标题输入框、语言选择器和编辑操作栏的问题。
同时检查所有依赖编辑器可编辑状态的同类界面，避免它们在模式切换后继续保留编辑态控件。

本文既是设计文档，也是本次实施的唯一 Todo。完成一项后必须复盘验收条件再勾选；实施或测试中
发现的新缺陷，必须先追加到“缺陷复盘”，再修改代码。

## 2. 用户可见行为

| 场景                   | 预期行为                                                   |
| ---------------------- | ---------------------------------------------------------- |
| 编辑模式、无标题       | 显示标题输入框、语言、换行、源码、复制和下载控件           |
| 编辑模式、有标题       | 显示可编辑标题及完整工具栏                                 |
| 读取模式、无标题       | 不显示标题栏，不占用空白行；悬停或触屏时仍可复制、下载     |
| 读取模式、有标题       | 只显示已保存的标题文本及复制、下载，不显示输入框或编辑控件 |
| Mermaid 从编辑切到读取 | 强制收起编辑时打开的源码，只显示图表预览                   |
| 从读取切回编辑         | 恢复编辑工具栏，不修改代码、标题、语言或换行属性           |

这里的“标题”是用户主动保存的代码块元数据。读取模式只隐藏编辑器工具栏，不删除已有标题，
也不改变 JSON、HTML、Yjs 或 Markdown 的序列化规则。

## 3. 根因与修改必要性

页面和嵌入记录编辑器通过 Tiptap `editor.setEditable()` 在同一个编辑器实例上切换模式。
Tiptap 3.20.4 的实现会更新 editor options，并发出 `update` 事件；它不会为这次状态变化派发
ProseMirror transaction。

当前代码块 NodeView 在 React render 中直接读取可变的 `editor.isEditable`。NodeView 的节点没有
变化时，React 不会因为这个 getter 的返回值变化而自行重渲染。项目使用的 `useEditorState()` 也
不能解决这个场景，因为该版本的实现只订阅 `transaction`。因此初始只读测试能够通过，但
“编辑到读取”的真实操作会残留整个编辑工具栏。

官方 Editor API 明确说明 `setEditable(editable, emitUpdate)` 默认触发 update：
<https://tiptap.dev/docs/editor/api/editor#seteditable>。官方事件 API 支持对运行中的 editor 使用
`on`/`off` 绑定和解绑事件：<https://tiptap.dev/docs/editor/api/events>。

结论：有必要修改。单纯增加 CSS 选择器只能遮住截图中的元素，不能同步下载文件名、Mermaid
源码状态、双击编辑行为或其他 NodeView 控件，因此不采用 CSS 补丁。

## 4. 前端设计

### 4.1 共享状态 hook

在现有 `features/editor/hooks` 中增加 `useEditorEditable`：

- 使用 React 18 `useSyncExternalStore`，不增加状态库或第三方依赖；
- 订阅 Tiptap editor 的 `update` 事件，snapshot 只返回 `editor.isEditable`；
- 布尔值没有变化时 React 不重渲染，因此普通内容更新不会造成额外 UI render；
- editor 替换或组件卸载时解绑旧监听器，避免泄漏和跨页面状态污染；
- 服务端 snapshot 固定为 `false`，不在 SSR 阶段暴露编辑控件。

项目内调用 `setEditable` 必须保留默认的 `emitUpdate=true`。如果未来显式传入 `false`，调用方也
必须负责传播模式变化，否则任何事件订阅方案都无法观察到该变化。

### 4.2 接入范围

本次先接入两个页面编辑器和所有在 NodeView render 中直接依赖 `editor.isEditable` 的组件。
事件处理器仍可在执行时二次读取 `editor.isEditable`，但可见性、disabled、popover、resize 和
错误信息必须使用响应式值。

代码块额外在进入读取模式时收起 Mermaid 源码，避免编辑态局部 state 泄漏到读取视图。复制和
下载保留；下载在编辑模式使用输入框中的即时标题，在读取模式使用已保存标题。

### 4.3 测试策略

- hook 单元测试：初值、update 后切换、相同值不改变结果、解绑和 editor 替换；
- 代码块组件测试：初始只读、编辑到读取、读取到编辑、Mermaid 源码收起、有标题读取展示；
- 现有标题规范化、Escape、下载和换行测试保持通过；
- 客户端 TypeScript、ESLint 和相关 Vitest 通过后再完成 Todo。

## 5. 后端、数据库与安全边界

本次不新增或修改后端模块、API、DTO、数据库字段、迁移、鉴权或审计事件。

“读取模式”是拥有当前页面权限的用户在浏览器中的展示偏好，不是授权边界。页面写入仍由现有
会话、空间和页面权限以及协同服务验证。把这个修复放到后端会制造重复模式状态，且无法解决
已经挂载的 React NodeView。公开分享和无编辑权限页面仍按原有 `editable=false` 初始化。

安全检查重点：

- 读取模式不展示可写控件，也不保留 Mermaid 编辑源码开关；
- 不记录或上传代码、标题和页面内容；
- 测试只使用匿名示例数据；
- 文档和提交不得包含个人身份、私有域名、IP、端口、证书路径、令牌或服务器目录。

## 6. 性能、兼容与回滚

- 每个相关组件增加一个轻量 `update` 监听器；snapshot 是布尔值，内容编辑产生的 update 不会在
  值未变化时触发 React 重渲染；
- 不重建 Editor、NodeView 或 Mermaid 实例，不改变协同、撤销、序列化和导出；
- 兼容现有 Tiptap 3.20.4、React 18、Mantine 和 Vitest 技术栈；
- 无数据迁移。回滚只需恢复前端 hook 和组件引用，不影响已有文档。

## 7. Todo

### 7.1 调研与设计

- [x] `READ-DESIGN-001` 核对截图、页面模式切换、代码块 NodeView、样式和现有测试。
- [x] `READ-DESIGN-002` 核对 Tiptap 3.20.4 本地源码和官方 `setEditable`/事件约定。
- [x] `READ-DESIGN-003` 完成前后端、数据库、安全、性能、兼容和回滚边界设计。
- [x] `READ-DESIGN-004` 建立本文、稳定 Todo ID 和缺陷复盘规则。

### 7.2 实现

- [x] `READ-IMPL-001` 实现并测试响应式 `useEditorEditable` hook。
- [x] `READ-IMPL-002` 修复代码块编辑/读取工具栏、下载标题和双击行为的状态同步。
- [x] `READ-IMPL-003` 进入读取模式时收起 Mermaid 源码，并补动态模式测试。
- [x] `READ-IMPL-004` 将同类页面编辑器和 NodeView 可编辑态展示接入统一 hook。
- [x] `READ-IMPL-005` 更新原代码块设计文档中的读取模式约束和实现位置。

### 7.3 验证

- [x] `READ-VERIFY-001` 运行 hook、代码块及受影响组件测试。
- [x] `READ-VERIFY-002` 运行客户端 TypeScript 和 ESLint。
- [x] `READ-VERIFY-003` 复核编辑、读取、公开/无权限只读和 Mermaid 行为矩阵。
- [x] `READ-VERIFY-004` 检查最终 diff、Todo、文档和敏感信息，不混入无关工作区改动。

## 8. 缺陷复盘

### `BUG-READ-001`：模式切换事件未被订阅

- [x] 修复代码块和页面级 UI 只读取可变 getter、未订阅 `setEditable` update 的问题。
- 发现阶段：读取模式根因分析。
- 影响：编辑工具栏、标题输入和部分浮层在切换到读取模式后可能残留。

### `BUG-READ-002`：Mermaid 编辑源码状态跨模式残留

- [x] 进入读取模式时强制关闭 `showSource`，并以动态切换测试锁定行为。
- 发现阶段：代码块局部状态复盘。
- 影响：用户在编辑模式打开源码后切换读取，原局部 state 不会自动重置。

### `BUG-READ-003`：状态标签编辑浮层跨模式残留

- [x] 进入读取模式时关闭已打开的状态标签编辑浮层，避免切回编辑后意外重开。
- 发现阶段：同类 NodeView 可编辑态审计。
- 影响：浮层的本地 `opened` 状态不依赖 editor，模式往返后会恢复旧编辑界面。

### `BUG-READ-004`：Mermaid 源码可能在模式切换时短暂闪现

- [x] 读取模式的 render 直接隐藏 Mermaid 源码，不等待 effect 重置局部状态。
- 发现阶段：最终渲染时序复盘。
- 影响：从已打开源码的编辑态切换时，effect 执行前理论上可能保留一帧源码。

## 9. 实施复盘

实施完成后在这里记录实际变更、测试结果、新发现缺陷和遗留风险；只有对应验收条件全部满足，
Todo 才能从 `[ ]` 更新为 `[x]`。

### 2026-07-14：响应式读取模式实现

- 完成 Todo：`READ-IMPL-001` 至 `READ-IMPL-005`、`BUG-READ-001` 至 `BUG-READ-004`。
- 用户可见变化：点击“读取”后，已挂载代码块立即移除标题输入和编辑工具栏；无标题时不占标题行，
  已保存标题仍以文本显示；Mermaid 编辑源码自动收起。
- 前端实现与兼容：新增一个基于 React `useSyncExternalStore` 和 Tiptap `update` 的共享 hook，页面、
  嵌入记录、代码块、Mermaid、附件、PDF、嵌入、链接、公式和状态 NodeView 共用。
- 后端、鉴权与数据库：无变更。读取模式继续是客户端展示状态，写权限仍由现有服务端边界负责。
- 性能与安全：snapshot 仅为布尔值，内容 update 在值不变时不触发 React render；不采集页面内容，
  不增加网络请求、全局监听器、依赖或敏感信息。
- 测试：新增 hook 生命周期和代码块动态模式测试；客户端全量 27 个测试文件、156 项测试、
  TypeScript、ESLint、Prettier 和 production build 通过。ESLint 保留 12 条仓库既有 warning、
  无 error；构建保留既有大 chunk 提示，与本次状态同步逻辑无关。
- 最终复盘：编辑、读取、公开/无权限初始只读、有/无标题、Mermaid 源码和模式往返矩阵均已覆盖；
  diff 检查与敏感信息扫描通过，未包含工作区中的无关更新日志改动。
