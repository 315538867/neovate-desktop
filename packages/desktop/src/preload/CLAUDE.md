[根目录](../../../../CLAUDE.md) > [packages](../../) > [desktop](../) > **preload**

# Preload 预加载脚本

> Electron preload 脚本。在渲染进程加载前运行，提供 context bridge 和 MessagePort 转发。

## 模块职责

- oRPC MessagePort 转发（渲染进程 ↔ 主进程）
- 通过 contextBridge 暴露安全 API 到渲染进程
- Electron IPC 事件监听转发
- 提供用户主目录路径

## 入口文件

| 文件 | 用途 |
|------|------|
| `index.ts` | 唯一入口。MessagePort 转发 + contextBridge API 暴露 |
| `index.d.ts` | 全局类型声明 (`window.api`, `window.electron`) |

## MessagePort 转发机制

```
[renderer/orpc.ts]
    │ new MessageChannel() → port1 (client), port2 (server)
    │ window.postMessage("start-orpc-client", "*", [serverPort])
    ▼
[preload/index.ts]
    │ window.addEventListener("message", ...)
    │ 收到 "start-orpc-client" → 提取 serverPort
    │ ipcRenderer.postMessage("start-orpc-server", null, [serverPort])
    ▼
[main/index.ts]
    │ ipcMain.on("start-orpc-server", ...)
    │ RPCHandler.upgrade(serverPort, { context: appContext })
    │ serverPort.start()
```

## Context Bridge API

暴露到 `window.api` 的安全 API:

```typescript
window.api = {
  homedir: string,                    // 用户主目录路径
  isDev: boolean,                     // 是否为开发环境
  onOpenSettings(callback): () => void,   // 菜单打开设置事件
  onPopupWindowShown(callback): () => void,  // 弹出窗口显示事件
  onFullScreenChange(callback): () => void,   // 全屏切换事件
}
```

暴露到 `window.electron` 的 electronAPI:
- 由 `@electron-toolkit/preload` 提供标准 Electron API

## 安全考虑

- 使用 `contextBridge.exposeInMainWorld` 安全暴露 API
- 在 `contextIsolated` 环境下工作
- 不支持 contextIsolation 时回退到直接赋值（带 `@ts-ignore`）

## 注意事项

- **极简模块**: preload 应尽可能精简，仅做桥接转发
- **不要在此添加业务逻辑**: 所有业务逻辑应在 main 或 renderer 中
- **修改需谨慎**: preload 中的变更影响所有渲染窗口
- **MessagePort 限制**: 端口一旦 transfer 就不能再使用，需在正确时机转发

## 相关文件清单

```
src/preload/
├── index.ts       # MessagePort 转发 + API 暴露
└── index.d.ts     # 全局类型声明 (window.api, window.electron)
```

## 变更记录 (Changelog)

| 日期 | 变更 |
|------|------|
| 2026-04-28 | 初始化：创建 preload 模块文档，描述 MessagePort 转发机制和 API |
