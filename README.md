<div align="center">
<img src="https://mdn.alipayobjects.com/huamei_9rin5s/afts/img/0uIJQaelzccAAAAAQCAAAAgADiB8AQFr/original" alt="Neovate Logo" width="60" />
<br />
<br />
<img src="https://mdn.alipayobjects.com/huamei_9rin5s/afts/img/UdphTJIBImUAAAAAQKAAAAgADiB8AQFr/original" alt="Neovate Logo Text" width="160" />

### Desktop

---

[![](https://github.com/neovateai/neovate-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/neovateai/neovate-desktop/actions/workflows/ci.yml)
[![](https://img.shields.io/github/license/neovateai/neovate-desktop)](https://github.com/neovateai/neovate-desktop/blob/master/LICENSE)
[![](https://img.shields.io/badge/platform-macOS-blue)](https://github.com/neovateai/neovate-desktop)

**Neovate Desktop** is a native desktop app for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), with other code agents coming soon — a feature-rich environment for AI-assisted development with built-in editor, terminal, git, and code review.

**Neovate Desktop** 是面向 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 的原生桌面应用（更多代码 Agent 即将支持）—— 集成编辑器、终端、Git、代码评审的 AI 辅助开发环境。

> 🛠️ This repository is a fork of [neovateai/neovate-desktop](https://github.com/neovateai/neovate-desktop) for secondary development. It tracks upstream while introducing custom features, performance optimizations, and experimental changes. All credits to the original authors — see [LICENSE](./LICENSE) (MIT).
>
> 🛠️ 本仓库基于 [neovateai/neovate-desktop](https://github.com/neovateai/neovate-desktop) 进行二次开发，在跟随上游的同时引入定制功能、性能优化与实验性改动。原作者版权完整保留，详见 [LICENSE](./LICENSE) (MIT)。

</div>

![](https://pic.sorrycc.com/proxy/1774535548107-815850794.png)

## Quick Start / 快速开始

Prerequisites: macOS, [Bun](https://bun.sh/) >= 1.3.9

环境要求：macOS，[Bun](https://bun.sh/) >= 1.3.9

```bash
git clone https://github.com/neovateai/neovate-desktop.git
cd neovate-desktop
bun install
bun dev
```

## Contributing / 参与贡献

Contributions are welcome! Please read the [CONTRIBUTING.md](./CONTRIBUTING.md) file for guidelines on setting up the development environment, running tests, and submitting pull requests.

欢迎贡献代码！请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解开发环境搭建、测试运行与 Pull Request 提交规范。

## Credits / 致谢

Neovate Desktop is built on the shoulders of these open source projects:

Neovate Desktop 站在以下开源项目的肩膀上：

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) / [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) — AI agent backbone / AI Agent 核心
- [Vercel AI SDK](https://github.com/vercel/ai) — chat UI primitives (partial port of `AbstractChat` and stream processing) / 聊天 UI 原语（`AbstractChat` 与流式处理的部分移植）
- [VS Code](https://github.com/microsoft/vscode) — shell environment resolution and plugin lifecycle patterns / Shell 环境解析与插件生命周期模式
- [Electron](https://github.com/electron/electron) / [electron-vite](https://github.com/alex8088/electron-vite) — desktop app framework and build tooling / 桌面应用框架与构建工具链
- [xterm.js](https://github.com/xtermjs/xterm.js) / [node-pty](https://github.com/microsoft/node-pty) — terminal emulator / 终端模拟器
- [Streamdown](https://github.com/nicepkg/streamdown) — streaming markdown rendering / 流式 Markdown 渲染
- [Shiki](https://github.com/shikijs/shiki) — syntax highlighting / 语法高亮
- [shadcn/ui](https://github.com/shadcn-ui/ui) — component primitives / 组件原语
- [CodePilot](https://github.com/op7418/CodePilot) — multi-provider architecture reference / 多 Provider 架构参考
- [cc-viewer](https://github.com/weiesky/cc-viewer) — network feature reference / 网络监控功能参考
- [wechatbot](https://github.com/corespeed-io/wechatbot) — WeChat adapter reference (iLink Bot protocol, error recovery patterns) / 微信适配器参考（iLink Bot 协议、错误恢复模式）
- [RTK](https://github.com/rtk-ai/rtk) — token-optimized CLI proxy / Token 优化 CLI 代理
- [Bun](https://github.com/oven-sh/bun) — JavaScript runtime / JavaScript 运行时

## License / 开源协议

[MIT](./LICENSE) — original copyright © Ant UED, retained per MIT terms. Secondary-development modifications in this fork are also released under MIT.

[MIT](./LICENSE) —— 原始版权 © Ant UED，依据 MIT 条款完整保留。本 fork 的二次开发修改同样以 MIT 协议发布。
