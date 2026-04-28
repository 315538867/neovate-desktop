[根目录](../../../../CLAUDE.md) > [packages](../../) > [desktop](../) > **renderer**

# Renderer 渲染进程

> React 19 单页应用。所有 UI 在此实现。通过 oRPC over MessagePort 与主进程通信。

## 模块职责

- 全部 UI 渲染（聊天界面、会话列表、内容面板、设置等）
- AI 消息流式渲染（工具调用、推理链、代码块等）
- 用户输入管理（TipTap 编辑器、图片粘贴、@提及、斜杠命令）
- 应用布局（可拖拽面板系统、活动栏、侧边栏）
- 主题系统（亮色/暗色 + 多种样式变体）
- 国际化 (i18next)
- 插件 UI 扩展（RendererPlugin 接口）
- 埋点追踪 (Analytics)
- 关键词导航

## 入口与启动

| 文件 | 用途 |
|------|------|
| `main.tsx` | **入口**。创建 `RendererApp` 实例，注册插件 |
| `core/app.tsx` | `RendererApp` 类。React root 挂载、Provider 层级、插件激活 |
| `orpc.ts` | oRPC 客户端初始化。创建 MessageChannel，导出 `client` |
| `App.tsx` | 主窗口根组件。活动栏 + 侧边栏 + 聊天面板 + 内容面板 |

**启动流程** (core/app.tsx → start()):
1. 加载配置 (`useConfigStore.load()`)
2. 初始化 i18n + 插件 i18n 命名空间
3. 刷新项目列表 (`project.refresh()`)
4. 收集窗口贡献 (插件注册的窗口类型)
5. 仅主窗口: 收集视图贡献 → 初始化 Workbench → 水合 ContentPanel → 注册 Deeplink
6. 激活所有插件
7. React 渲染 (StrictMode → ThemeProvider → ToastProvider → lazy(App))

**Provider 层级**:
```
StrictMode
└── RendererAppContext.Provider (app 实例)
    └── PluginContextReact.Provider (orpcClient + llm + app)
        └── ThemeProvider (next-themes: class 策略)
            └── ToastProvider
                ├── ThemeSync / StyleSync / FontSizeSync
                ├── MenuCommandHandler
                └── Suspense → AppComponent
```

## 对外接口 (oRPC Client)

`orpc.ts` 创建 `@orpc/client` 的 `RPCLink` (MessagePort 传输):

```typescript
import { client } from "../../orpc";
// 调用方式:
client.agent.claudeCode.createSession({ cwd: "/path" });
client.project.list();
client.config.get({ key: "theme" });
client.storage.set({ namespace: "x", key: "y", value: data });
```

所有方法类型安全，由 `shared/contract.ts` 推导。

## 应用布局

布局系统基于 `components/app-layout/`：

```
┌──────────────────────────────────────────────────┐
│ ActivityBar │ PrimarySidebar │ ChatPanel │ ContentPanel │
│   (图标)    │  (会话列表)     │  (聊天)    │  (Tab面板)   │
│             │                │           │              │
│   - 搜索    │  - 项目树      │  - 消息流  │  - 终端      │
│   - Git     │  - 会话列表    │  - 输入框  │  - 文件      │
│   - 文件    │                │  - 工具渲染 │  - 编辑器   │
│   - 插件    │                │           │  - Diff      │
└──────────────────────────────────────────────────┘
```

可拖拽调整面板宽度。布局状态持久化。支持最大化内容面板。

### 关键状态 Store

| Store | 文件 | 职责 |
|-------|------|------|
| `useConfigStore` | `features/config/store.ts` | 应用配置（主题/语言/字体/开发者模式） |
| `useProjectStore` | `features/project/store.ts` | 活动项目 + 项目列表 |
| `agentStore` | `features/agent/store.ts` | 会话列表、消息、流式状态（最复杂） |
| `layoutStore` | `components/app-layout/store.ts` | 面板宽度/折叠状态（persist） |
| `contentPanelStore` | `features/content-panel/store.ts` | Tab 状态 |
| `settingsStore` | `features/settings/store.ts` | 设置面板显示/隐藏 |
| `commandPaletteStore` | `features/command-palette/store.ts` | 命令面板状态 |
| `providerStore` | `features/provider/store.ts` | Provider 配置 + Benchmark |

## 关键功能模块

### Agent (`features/agent/`) — 核心聊天模块

**数据流**:
```
用户输入 (TipTap)
  → agent/store.ts: sendMessage()
    → chat-manager.ts: 创建/加载 session
    → chat-transport.ts: oRPC 订阅流式事件
    → process-ui-message-stream.ts: 解析事件 → UI 消息
    → agent-chat.tsx: React 渲染
```

**关键文件**:
| 文件 | 用途 |
|------|------|
| `store.ts` | 会话 + 消息 Zustand store |
| `chat.ts` | 聊天编排逻辑 |
| `chat-manager.ts` | 会话创建/加载/切换 |
| `chat-transport.ts` | oRPC 传输层 |
| `chat-state.ts` | 聊天状态机 |
| `process-ui-message-stream.ts` | 流式事件 → UI 消息转换 |
| `navigate-session.ts` | 会话导航 |
| `deeplink.ts` | Deeplink → 会话跳转 |
| `components/agent-chat.tsx` | 聊天主组件 |
| `components/message-input.tsx` | TipTap 输入框 |
| `components/message-parts.tsx` | 消息片段渲染 |
| `components/tool-parts/` | 各工具调用 UI 渲染（20+ 种工具） |
| `hooks/` | useClaudeCodeChat, useLoadSession, useNewSession 等 |

**工具渲染组件** (tool-parts/):
agent, ask-user-question, bash, bash-output, edit, enter-plan-mode, enter-worktree, exit-plan-mode, generic-tool, glob, grep, multi-edit, notebook-edit, read, skill, slash-command, task, task-output, task-stop, todo-write, web-fetch, web-search, write

### Content Panel (`features/content-panel/`)

支持插件注册的 Tab 页面系统。View Context 模式管理生命周期。

### Settings (`features/settings/`)

设置面板包含子面板: General, Agents, Providers, Keybindings, Rules, Remote Control, About

## 组件库

### UI 组件 (`components/ui/`) — shadcn/ui

通过 `components.json` 配置的 shadcn/ui 组件库。**禁止手动编辑**，通过 `/coss-ui-sync` skill 同步。

现有组件: accordion, alert, alert-dialog, autocomplete, avatar, badge, breadcrumb, button, button-group, calendar, card, carousel, checkbox, checkbox-group, collapsible, combobox, command, context-menu, dialog, empty, error-boundary, field, fieldset, form, frame, group, hover-card, input, input-group, kbd, label, menu, meter, number-field, pagination, popover, preview-card, progress, radio-group, scroll-area, select, separator, sheet, sidebar, skeleton, slider, spinner, switch, table, tabs, textarea, toast, toggle, toggle-group, toggle-options, toolbar, tooltip

### AI Elements (`components/ai-elements/`)

AI 专用 UI 组件: agent, artifact, attachments, chain-of-thought, checkpoint, code-block, confirmation, context, conversation, inline-citation, markdown-base-components, message, plan, queue, reasoning, shimmers, sources, task, terminal, tool

### App Layout (`components/app-layout/`)

布局系统组件: activity-bar, app-layout (root), content-panel, content-panel-tabs, full-right-panel, panel-activity, primary-sidebar, resize-handle, secondary-sidebar

## 主题系统

- **引擎**: `next-themes` (class 策略)
- **模式**: 亮色 / 暗色 / 跟随系统
- **样式变体**: `default` (无 dataset) / 自定义 style (设置 `data-style` 属性)
- **主色调**: `#fa216e`
- **CSS**: Tailwind CSS 4 (CSS-first)，主入口 `assets/main.css`

## 插件系统 (RendererPlugin)

```typescript
interface RendererPlugin {
  name: string;
  enforce?: "pre" | "post";
  configViewContributions?(): PluginViewContributions;    // UI 扩展
  configContributions?(ctx: PluginContext): PluginContributions;  // 数据扩展
  configWindowContributions?(): WindowContribution[];      // 窗口类型
  configI18n?(): I18nContributions;                        // i18n namespace
  activate?(ctx: PluginContext): void;                     // 激活
  deactivate?(): void;                                     // 清理
}
```

内置插件: browser, changes, debug, editor, files, git, network, popup-window, providers, search, terminal

## 测试与质量

| 位置 | 内容 |
|------|------|
| `core/__tests__/` | 核心服务测试 (app, disposable, opener, plugin-manager, truncate, workbench-layout) |
| `features/agent/__tests__/` | Agent 功能测试 (store, process-ui-message-stream) |
| `features/agent/components/__tests__/` | 组件测试 (permission-dialog, message-parts, ask-user-question) |
| `features/agent/utils/__tests__/` | 工具函数测试 (insert-chat, keyboard) |
| `features/analytics/__tests__/` | 埋点测试 |
| `features/content-panel/__tests__/` | 内容面板测试 |
| `features/updater/__tests__/` | 更新提示测试 |
| `components/app-layout/__tests__/` | 布局逻辑测试 |
| `hooks/__tests__/` | hooks 测试 |
| `shared/__tests__/` | 共享代码测试 |

- 测试框架: vitest (jsdom 环境)
- 组件测试: @testing-library/react
- 命名规约: `*.test.ts` / `*.test.tsx`, colocated `__tests__/`

## 常见问题 (FAQ)

**Q: 如何添加新的 UI 组件？**
A: shadcn/ui 组件通过 `/coss-ui-sync` skill 添加（禁止手动编辑 `components/ui/`）。业务组件放在 `features/<name>/components/`。

**Q: 如何调用主进程方法？**
A: 通过 oRPC client: `import { client } from "../../orpc"` → `client.<domain>.<method>()`。不要直接 import electron。

**Q: 如何添加新的渲染进程插件？**
A: 实现 `RendererPlugin` 接口 → 在 `core/app.tsx` 的 `BUILTIN_PLUGINS` 或 `main.tsx` 中注册 → 可通过 `configViewContributions` 扩展 UI。

**Q: 如何调试渲染进程？**
A: 开发模式下自动开启 React DevTools。Chrome DevTools 通过 Electron 的 `ELECTRON_CDP_PORT` 环境变量连接。

**Q: 如何理解 agent store 的状态流？**
A: `sendMessage()` → `chat-manager` 创建 transport → `subscribe` → 流式事件 → `process-ui-message-stream` 解析 → 更新 `messages` 数组 → React 重渲染。会话通过 `sessionUtils` 管理列表排序/分组。

## 相关文件清单

关键文件结构（详见根 CLAUDE.md 完整树）:
- `main.tsx` — 入口
- `orpc.ts` — oRPC 客户端
- `App.tsx` — 主窗口根组件
- `core/app.tsx` — RendererApp + Provider 层级
- `core/plugin/` — 插件系统
- `core/i18n/` — 国际化
- `core/workbench/` — 工作台布局
- `features/agent/` — AI 聊天核心
- `features/content-panel/` — 内容面板
- `features/settings/` — 设置
- `components/ui/` — shadcn/ui 组件
- `components/ai-elements/` — AI 专用组件
- `components/app-layout/` — 布局系统
- `plugins/` — 内置渲染进程插件

## 变更记录 (Changelog)

| 日期 | 变更 |
|------|------|
| 2026-04-28 | 初始化：完善模块文档，添加入口/接口/布局/功能模块/组件库/FAQ |
| (之前) | 原有简短 CLAUDE.md |
