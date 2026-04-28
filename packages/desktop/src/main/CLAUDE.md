[根目录](../../../../CLAUDE.md) > [packages](../../) > [desktop](../) > **main**

# Main 主进程

> Electron 主进程 (Node.js)。运行 IPC 服务器、管理 ACP 子进程、托管插件系统。

## 模块职责

- 应用生命周期管理（启动/退出/崩溃恢复）
- oRPC IPC 服务器（MessagePort 传输）
- Claude Agent SDK (ACP) 子进程管理
- 内置插件宿主（MainPlugin 接口）
- 窗口管理（BrowserWindow 创建/销毁/Mac 红绿灯）
- 持久化存储（electron-store, namespace 隔离）
- Deeplink 协议处理
- 远程控制平台集成（钉钉/Telegram/微信）
- 自动更新服务

## 入口与启动

| 文件 | 用途 |
|------|------|
| `index.ts` | **入口**。初始化所有服务、注册 IPC、启动应用 |
| `app.ts` | `MainApp` 类。生命周期：constructor → configContributions → activate → router → window |
| `router.ts` | 根 oRPC 路由。聚合 feature router + 插件 router，导出 `AppContext` 类型 |

**启动流程** (index.ts):
1. 创建 `ConfigStore`, `ProjectStore`（持久化状态）
2. 创建 `RequestTracker`, `PowerBlockerService`
3. 创建 `SessionManager`（ACP 会话核心）
4. 创建 `LlmService`（辅助 LLM）
5. 实例化 `MainApp` + 内置插件
6. 创建 `UpdaterService`, `PluginsService`, `SkillsService`
7. 创建 `RemoteControlService` + 平台适配器注册
8. `app.whenReady()` → `mainApp.start()` → 注册 MessagePort handler

**关闭流程**:
- `before-quit` 事件 → 依次释放: popupShortcut → menu → updater → powerBlocker → llm → remoteControl → sessionManager.closeAll() → mainApp.stop()

## 对外接口 (oRPC Contract)

所有 IPC 方法通过 `router.ts` 聚合，contract 定义在 `shared/contract.ts`。

| Contract Key | Router 文件 | 职责 |
|---|---|---|
| `ping` | router.ts (内联) | 连通性检查 |
| `agent` | features/agent/router.ts | ACP 会话：创建/发送/订阅/关闭/加载/分叉/回退/计划 |
| `config` | features/config/router.ts | 应用配置读写 |
| `deeplink` | features/deeplink/router.ts | Deeplink 事件订阅 |
| `electron` | features/electron/router.ts | Electron 原生操作 |
| `llm` | features/llm/router.ts | 辅助 LLM 查询 |
| `remoteControl` | features/remote-control/router.ts | 远程控制：链接管理/命令执行 |
| `project` | features/project/router.ts | CRUD: 项目列表/激活/创建/删除 |
| `provider` | features/provider/router.ts | AI Provider 配置 |
| `rules` | features/rules/router.ts | 规则文件管理 |
| `plugins` | features/claude-code-plugins/router.ts | Claude Code 插件市场集成 |
| `skills` | features/skills/router.ts | 技能安装/配置 |
| `storage` | features/storage/router.ts | 通用键值存储 |
| `updater` | features/updater/router.ts | 自动更新状态/操作 |
| `utils` | features/utils/router.ts | 文件搜索等工具 |
| `window` | router.ts (内联) | 窗口操作: ensureWidth, open |
| `git/changes` 等 | plugins/*/router.ts | 插件贡献的路由 |

### 核心 Contract: agent

最复杂的契约模块，管理 ACP 会话全生命周期：

- **Session CRUD**: `createSession`, `loadSession`, `closeSession`, `forkSession`, `listSessions`, `renameSession`
- **消息流**: `send` (发送消息), `subscribe` (流式事件订阅), `dispatch` (权限审批/工具操作)
- **版本管理**: `rewindToMessage`, `rewindFilesDryRun`, `archiveSessionFile`, `deleteSessionFile`
- **Model**: `setModelSetting` (session/project/global scope 切换)
- **网络检查**: `network.listRequests`, `network.getRequestDetail`, `network.getInspectorState`, `network.subscribe`
- **生命周期事件**: `subscribeSessionLifecycle` — 跨窗口会话状态同步

## 关键依赖与配置

### 内部依赖

| 模块 | 用途 |
|------|------|
| `@anthropic-ai/claude-agent-sdk` | ACP 子进程管理与消息协议 |
| `@orpc/server` | oRPC 服务端 |
| `electron-store` | JSON 文件持久化 |
| `electron-updater` | 自动更新 |
| `simple-git` | Git 操作 |
| `debug` | 日志 (命名空间 `neovate:*`) |

### Context 对象 (AppContext)

所有 oRPC handler 接收的 context 类型（定义在 `router.ts`）:

```typescript
type AppContext = {
  sessionManager: SessionManager;
  requestTracker: RequestTracker;
  configStore: ConfigStore;
  llmService: LlmService;
  projectStore: ProjectStore;
  pluginsService: PluginsService;
  skillsService: SkillsService;
  stateStore: StateStore;
  remoteControlService: RemoteControlService;
  updaterService: UpdaterService;
  mainApp: IMainApp;
  storage: StorageService;
}
```

## 核心服务

### SessionManager (`features/agent/session-manager.ts`)

管理所有 ACP 会话实例。每个会话运行一个独立的 Claude Agent SDK 子进程。

- `createSession(cwd, model?, providerId?)` → 启动 ACP 子进程
- `sendMessage(sessionId, message)` → 发送消息到 ACP
- `subscribe(sessionId)` → 返回 AsyncIterator 流式事件
- `closeSession(sessionId)` → 关闭 ACP 子进程
- `loadSession(sessionId, cwd)` → 恢复已有会话
- `forkSession(sessionId, cwd)` → 分叉会话
- `closeAll()` → 退出时关闭所有会话

### PluginManager (`core/plugin/plugin-manager.ts`)

主进程插件系统。MainPlugin 接口:

```typescript
interface MainPlugin {
  name: string;
  enforce?: "pre" | "post";
  configContributions?(ctx: PluginContext): PluginContributions;
  activate?(ctx: PluginContext): void;
  deactivate?(): void;
}
```

插件可贡献: oRPC router, agent 配置, deeplink handler

### StorageService (`core/storage-service.ts`)

基于 electron-store 的 namespace 隔离存储:
- `scoped(namespace)` → 返回独立的 Store 实例
- 路径安全检查（防止目录遍历攻击）
- 数据目录: `~/.neovate-desktop/` (生产) / `~/.neovate-desktop-dev/` (开发)

### BrowserWindowManager (`core/browser-window-manager.ts`)

应用窗口全生命周期管理: 主窗口创建、弹出窗口管理、窗口退出确认、Mac 全屏事件、最小宽度约束。

## 远程控制平台

`features/remote-control/` 实现通过即时通讯平台远程控制 AI 会话:

| 平台 | 实现路径 | 特性 |
|------|----------|------|
| Telegram | `platforms/telegram/` | Bot 命令、Markdown 渲染、Inline keyboard |
| 钉钉 | `platforms/dingtalk/` | 流式回调、消息去重、媒体消息 |
| 微信 | `platforms/wechat/` | 公众号 API、CDN 上传、消息同步 |

## 测试与质量

| 位置 | 内容 |
|------|------|
| `__tests__/app.test.ts` | MainApp 实例化与生命周期 |
| `__tests__/router.test.ts` | oRPC 路由集成测试 |
| `core/__tests__/` | 核心服务单元测试 (BWM, shell, storage) |
| `core/deeplink/__tests__/` | Deeplink 服务测试 |
| `core/plugin/__tests__/` | 插件管理器测试 |
| `features/agent/__tests__/` | Agent 功能测试（含真实 ACP 流数据 snapshot） |
| `features/storage/__tests__/` | 存储路由测试 |
| `features/updater/__tests__/` | 更新服务测试 |

- 测试框架: vitest
- 测试环境: node
- 命名规约: `*.test.ts`, colocated `__tests__/`

## 常见问题 (FAQ)

**Q: 如何添加新的 IPC 方法？**
A: 1) 在 `shared/features/<domain>/contract.ts` 定义 oRPC contract + Zod schema；2) 在 `main/features/<domain>/router.ts` 实现 handler；3) 在 `shared/contract.ts` 注册 contract；4) 在 `main/router.ts` 注册 router；5) renderer 通过 `client.<domain>.<method>()` 调用。

**Q: 如何添加新的主进程插件？**
A: 实现 `MainPlugin` 接口 → 在 `main/index.ts` 的 `mainApp` 构造中注册 → 插件可通过 `configContributions` 返回 oRPC router。

**Q: ACP 会话崩溃如何处理？**
A: `index.ts` 中有崩溃循环检测 (`projectStore.checkCrashLoop()`)，连续崩溃会清空 activeProjectId。每个 SDK 会话也有独立的子进程。

**Q: 如何调试主进程？**
A: 设置环境变量 `ELECTRON_CDP_PORT` 启用 Chrome DevTools 远程调试。日志使用 `debug("neovate:*")` 命名空间。

## 相关文件清单

```
src/main/
├── index.ts                          # 入口
├── app.ts                            # MainApp 类
├── router.ts                         # 根路由 + AppContext
├── core/
│   ├── index.ts
│   ├── app-paths.ts                  # 数据路径
│   ├── browser-window-manager.ts     # 窗口管理
│   ├── disposable.ts                # 资源释放工具
│   ├── logger.ts                    # 日志初始化
│   ├── menu.ts                      # 应用菜单
│   ├── power-blocker-service.ts     # 电源管理
│   ├── shell-service.ts            # Shell 环境
│   ├── storage-service.ts          # 持久化存储
│   ├── types.ts                    # IMainApp 等接口
│   ├── deeplink/
│   │   ├── deeplink-service.ts
│   │   └── types.ts
│   └── plugin/
│       ├── index.ts
│       ├── contribution.ts
│       ├── contributions.ts
│       ├── plugin-manager.ts
│       └── types.ts               # MainPlugin 接口
├── features/
│   ├── agent/                       # ACP 会话管理（核心）
│   │   ├── index.ts
│   │   ├── router.ts
│   │   ├── session-manager.ts
│   │   ├── claude-code-utils.ts
│   │   ├── claude-settings.ts
│   │   ├── sdk-message-transformer.ts
│   │   ├── request-tracker.ts
│   │   ├── pushable.ts
│   │   ├── interceptor/
│   │   │   ├── credential-mask.ts
│   │   │   ├── fetch-interceptor.ts
│   │   │   └── stream-assembler.ts
│   │   └── utils/
│   ├── claude-code-plugins/        # 插件市场集成
│   ├── config/                     # 配置存储
│   ├── deeplink/                   # Deeplink 路由
│   ├── electron/                   # Electron 原生
│   ├── llm/                        # 辅助 LLM
│   ├── popup-window/               # 弹出窗口快捷键
│   ├── project/                    # 项目管理
│   ├── provider/                   # Provider 管理
│   ├── remote-control/             # 远程控制
│   ├── rules/                      # 规则管理
│   ├── skills/                     # 技能安装
│   ├── state/                      # 全局状态
│   ├── storage/                    # 键值存储
│   ├── updater/                    # 自动更新
│   └── utils/                      # 工具
└── plugins/                         # 内置插件
    ├── browser/
    ├── changes/
    ├── editor/
    ├── files/
    ├── git/
    └── terminal/
```

## 变更记录 (Changelog)

| 日期 | 变更 |
|------|------|
| 2026-04-28 | 初始化：完善模块文档，添加入口/接口/核心服务/FAQ/文件清单 |
| (之前) | 原有简短 CLAUDE.md |
