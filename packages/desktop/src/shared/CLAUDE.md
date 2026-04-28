[根目录](../../../../CLAUDE.md) > [packages](../../) > [desktop](../) > **shared**

# Shared 共享代码

> 被 main 和 renderer 共同引用的类型定义、oRPC 契约、Claude Code 工具解析器。**这是唯一可以跨进程共享的代码路径**。

## 模块职责

- 定义所有 IPC 方法的 oRPC 契约 (contract)
- 提供 Zod 4 校验 schema
- Claude Code 工具调用的输出解析器（type-safe 渲染）
- 跨进程共享的类型定义
- 应用常量与平台检测

## 入口文件

| 文件 | 用途 |
|------|------|
| `contract.ts` | **根契约**。聚合所有 feature + plugin contract，导出顶层 `contract` 对象 |
| `constants.ts` | 编译时常量 (`APP_NAME`, `APP_ID`, `DEEPLINK_SCHEME`) |
| `platform.ts` | 平台检测 (`isWindows`, `isMac`, `isLinux`, `EXE_EXT`) |
| `i18n.ts` | 国际化工具 |
| `globals.d.ts` | 全局类型声明 |

## Feature 契约一览

| Feature | Contract 文件 | 主要方法 |
|---------|-------------|---------|
| **agent** | `features/agent/contract.ts` | createSession, send, subscribe, dispatch, loadSession, closeSession, forkSession, rewindToMessage, network.* |
| **analytics** | `features/analytics/events.ts` | 埋点事件定义 |
| **claude-code-plugins** | `features/claude-code-plugins/contract.ts` | 插件发现/安装/配置 |
| **config** | `features/config/contract.ts` | get/set 配置项 |
| **deeplink** | `features/deeplink/contract.ts` | subscribe deeplink 事件 |
| **electron** | `features/electron/contract.ts` | Electron 原生操作 |
| **llm** | `features/llm/contract.ts` | query/queryMessages 辅助 LLM |
| **project** | `features/project/contract.ts` | list/getActive/createProject/deleteProject/setActive |
| **provider** | `features/provider/contract.ts` | Provider 配置 CRUD + sync |
| **remote-control** | `features/remote-control/contract.ts` | 远程控制链接/platform 配置 |
| **rules** | `features/rules/contract.ts` | 规则文件读写 |
| **skills** | `features/skills/contract.ts` | 技能安装/列表 |
| **state** | `features/state/contract.ts` | 全局状态持久化 |
| **storage** | `features/storage/contract.ts` | 通用键值存储 (get/set/delete/has) |
| **updater** | `features/updater/contract.ts` | 更新状态/操作 |
| **utils** | `features/utils/contract.ts` | 工具方法 |

## Plugin 契约一览

| Plugin | Contract 文件 |
|--------|-------------|
| browser | `plugins/browser/contract.ts` |
| changes | `plugins/changes/contract.ts` |
| editor | `plugins/editor/contract.ts` |
| files | `plugins/files/contract.ts` |
| git | `plugins/git/contract.ts` |
| terminal | `plugins/terminal/contract.ts` |

## Contract 模式

每个 feature contract 遵循统一模式：

```typescript
import { oc, type } from "@orpc/contract";
import { z } from "zod";

export const xxxContract = {
  methodName: oc
    .input(z.object({ ... }))   // Zod 4 schema
    .output(type<ReturnType>()), // 类型标记（编译时）
  streamingMethod: oc
    .input(type<Input>())
    .output(eventIterator(type<Event>())),  // 流式输出
};
```

**关键约定**:
- 所有 input 使用 Zod 4 schema（运行时校验）
- 复杂类型使用 `type<T>()` 标记（编译时类型推导）
- 流式输出使用 `eventIterator(type<T>())` 包装

## Claude Code 工具解析器

`claude-code/tools/` 目录包含所有 ACP 工具调用的 type-safe 解析器：

| 工具 | 文件 | 用途 |
|------|------|------|
| agent | `agent.ts` | 子 agent 调用解析 |
| ask-user-question | `ask-user-question.ts` | 用户提问解析 |
| bash | `bash.ts` | 命令执行解析 |
| bash-output | `bash-output.ts` | 命令输出解析 |
| edit | `edit.ts` | 文件编辑解析 |
| enter-plan-mode | `enter-plan-mode.ts` | 计划模式进入解析 |
| enter-worktree | `enter-worktree.ts` | Worktree 进入解析 |
| exit-plan-mode | `exit-plan-mode.ts` | 计划模式退出解析 |
| glob | `glob.ts` | 文件匹配解析 |
| grep | `grep.ts` | 内容搜索解析 |
| multi-edit | `multi-edit.ts` | 多文件编辑解析 |
| notebook-edit | `notebook-edit.ts` | Notebook 编辑解析 |
| read | `read.ts` | 文件读取解析 |
| skill | `skill.ts` | 技能调用解析 |
| slash-command | `slash-command.ts` | 斜杠命令解析 |
| task | `task.ts` | 子任务调用解析 |
| task-output | `task-output.ts` | 子任务输出解析 |
| task-stop | `task-stop.ts` | 子任务停止解析 |
| todo-write | `todo-write.ts` | Todo 写入解析 |
| web-fetch | `web-fetch.ts` | 网页抓取解析 |
| web-search | `web-search.ts` | 网页搜索解析 |
| write | `write.ts` | 文件写入解析 |

这些解析器被 renderer 的 `tool-parts/` 组件用于类型安全地渲染工具调用结果。

## 契约注册流程

1. 在 `features/<name>/contract.ts` 或 `plugins/<name>/contract.ts` 定义 contract
2. 在 `contract.ts` 顶层 import 并合并到根 `contract` 对象
3. main 进程的 `router.ts` import contract 并用 `implement()` 实现
4. renderer 的 `orpc.ts` 用 `createORPCClient` 创建类型安全的 client

## 注意事项

- **修改 contract 影响双端**: 修改任何 contract 会导致 main 和 renderer 的类型检查都需要通过
- **向后兼容**: 修改 contract 时注意不要破坏现有 API 签名
- **Zod 版本**: 使用 Zod 4（非 Zod 3），API 有差异
- **类型导出**: 所有被 contract 引用的类型需要在各 feature 的 `types.ts` 中定义并导出
- **测试**: `shared/__tests__/` 和 `claude-code/tools/__tests__/` 有相关测试

## 相关文件清单

```
src/shared/
├── contract.ts                         # 根契约
├── constants.ts                        # 编译时常量
├── platform.ts                         # 平台检测
├── i18n.ts                             # 国际化工具
├── globals.d.ts                        # 全局类型
├── claude-code/
│   ├── paths.ts                        # Claude Code 路径
│   ├── types.ts                        # UI 消息/事件类型
│   └── tools/                          # 工具解析器（21 个工具）
│       ├── index.ts
│       ├── *.ts
│       └── __tests__/
├── features/
│   ├── agent/                          # Agent 契约 + 类型 + 请求类型
│   ├── analytics/
│   ├── claude-code-plugins/
│   ├── config/
│   ├── deeplink/
│   ├── electron/
│   ├── llm/
│   ├── project/
│   ├── provider/
│   ├── remote-control/
│   ├── rules/
│   ├── skills/
│   ├── state/
│   ├── storage/
│   ├── updater/
│   └── utils/
└── plugins/
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
| 2026-04-28 | 初始化：完善模块文档，添加契约一览表、工具解析器清单、开发模式说明 |
| (之前) | 原有简短 CLAUDE.md |
