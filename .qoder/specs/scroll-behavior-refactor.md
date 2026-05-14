# 滚动行为重构：简化 scrollend 重固定逻辑

## Context

当前 AI 聊天的滚动跟随系统（`usePinnedState`）有一个 `DOWN_INTENT_WINDOW_MS = 250ms` 的"向下意图门"，要求用户在 scrollend 前 250ms 内必须有向下滚动输入（wheel/touch/keyboard）。这导致：

- **滚动条拖拽到底部** → 无 wheel 事件 → 无向下意图 → 不会重固定
- **慢速滚动到底部** → 超过 250ms → 不会重固定
- 结果：用户到底了但 auto-follow 没恢复，新消息到达时不跟随 → 体验混乱

`HEIGHT_SHRINK_MASK_MS` 已经足够防止浏览器 scrollTop-clamp 的误重固定，向下意图门是多余的二级安全网，却造成了更严重的 UX 问题。

## 方案：移除向下意图门，增大掩码窗口

### `onScrollEnd` 从三条件简化为两条件

**之前**：不在掩码窗口 + 250ms 内有向下意图 + 几何底部
**之后**：不在掩码窗口 + 几何底部

同时 `HEIGHT_SHRINK_MASK_MS` 从 350ms 增大到 600ms，提供更充分的安全边界。

## 修改文件

### 1. `packages/desktop/src/renderer/src/components/ai-elements/use-pinned-state.ts`

**删除：**

- `DOWN_INTENT_WINDOW_MS = 250` 常量及 JSDoc
- `lastUserDownIntentAtRef` ref
- `markDownIntent()` 函数
- `onWheel` 的 `deltaY > 0` 分支（`markDownIntent()`）
- `onTouchMove` 的 `dy < 0` 分支（`markDownIntent()`）
- `onKeyDown` 的 `PageDown/ArrowDown` 分支（`markDownIntent()`）
- `onScrollEnd` 的 `lastUserDownIntentAtRef` 检查行

**修改：**

- `HEIGHT_SHRINK_MASK_MS`：350 → 600
- `onScrollEnd`：删除意图检查，只保留掩码 + 几何底部
- 顶部 JSDoc：更新 Flip ON 说明，移除"向下意图"相关描述
- `notifyHeightShrink` JSDoc：`~350ms` → `~600ms`

### 2. `packages/desktop/src/renderer/src/components/ai-elements/__tests__/use-pinned-state.test.ts`

**删除测试：**

- "scrollend without a recent downward intent does NOT flip pin"（意图门已移除）
- "PageDown/ArrowDown count as downward intent for scrollend gating"（不再有意图追踪）

**更新测试：**

- "scrollend at geometric bottom flips pin ON" → 简化，不再需要先发 wheel 事件
- "wheel down + scrollend at bottom flips pin ON" → 简化，不再需要 wheel 事件
- "scrollend after a height-shrink mask is IGNORED" → 注释中 350ms → 600ms

**新增测试：**

- "scrollend at bottom without prior wheel event re-pins (scrollbar thumb)" — 核心修复场景
- "scrollend at bottom after height-shrink mask expires re-pins" — 掩码过期后正常重固定

### 3. `packages/desktop/src/renderer/src/components/ai-elements/conversation.tsx`

仅注释更新：`notifyHeightShrink` JSDoc 中 `~350ms` → `~600ms`

## 不需要修改的文件

- `conversation.tsx` 逻辑（followOutput、atBottomStateChange、按钮不变）
- `reasoning.tsx`（useDeferredUntilPinned + notifyHeightShrink API 不变）
- `use-assistant-message-summary-collapse.ts`（同上）
- `use-deferred-until-pinned.ts`（仅读 isPinnedRef，语义不变）
- `agent-chat.tsx`（session 切换 key remount 不变）

## 验证

```bash
bun test:run   # 单元测试通过
bun check      # 类型检查 + lint
bun ready      # 完整预推送检查
```

手动测试：

1. AI 流式输出时手动向上滚动 → auto-follow 停止
2. 用滚动条拖拽到底部 → auto-follow 恢复（核心修复）
3. 触控板慢速滚动到底部 → auto-follow 恢复（核心修复）
4. Reasoning block 自动折叠 → 不 yank 用户回底部
5. 点击 scroll-to-bottom 按钮 → auto-follow 恢复
6. Session 切换 → 自动滚到底 + auto-follow
