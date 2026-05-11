# Group Conversation — Multi-Window Manual Test

> 验证多窗口并行运行组对话时的正确性。每个会话独立 focus，各自写入互不干扰。

## 前置条件

1. 至少有一个分组（如 "Edu"），包含 3 个成员项目
2. 三个项目都有实际目录路径
3. 启动开发模式：`bun dev`

## 测试用例

### TC1: 两个窗口独立运行不同 focus

1. 打开窗口 A，创建组对话 `[Edu, focus=project-1]`
2. 打开窗口 B，创建组对话 `[Edu, focus=project-2]`
3. 在窗口 A 发送：「读取 README.md 并写出项目名称」
   - 预期：AI 只读 project-1 的 README.md
4. 在窗口 B 发送：「在 src/ 下写一个 test-mw.txt，内容为 "window B"」
   - 预期：文件创建在 project-2/src/test-mw.txt
5. 验证：
   - project-1 的文件系统**没有** test-mw.txt
   - project-2/src/test-mw.txt 存在，内容为 "window B"

### TC2: 同一组三个窗口分别操作不同成员

1. 打开三个窗口，各自 focus 为 project-1 / project-2 / project-3
2. 在每个窗口写入一个独有的文件
3. 验证三个文件各自落在正确目录，互不污染

### TC3: switch focus 后 path-guard 生效

1. 窗口 A focus=project-1，窗口 B focus=project-2
2. 在窗口 A 切换 focus 到 project-2
3. 验证：窗口 A 顶部 focus-bar 更新为 project-2
4. 在窗口 A 发消息写入文件
5. 验证：文件落在 project-2，不是 project-1

### TC4: 改组成员后焦点 UI 同步

1. 窗口 A 运行组对话 `[Edu, focus=project-1]`
2. 在设置页从 Edu 组中移除 project-1
3. 检查窗口 A 的 focus-bar：
   - project-1 从列表中消失
   - 自动清除 focus（无高亮 chip）
   - 提示"写操作仅作用于当前焦点"
4. 点击另一个成员 chip 重新聚焦
5. 发消息 → AI 正常回复

## 期望结果

| 测试用例 | 预期行为                       |
| -------- | ------------------------------ |
| TC1      | 各窗口写操作仅作用于各自 focus |
| TC2      | 三个窗口互不干扰               |
| TC3      | switch 后 path-guard 即时更新  |
| TC4      | 组变更后 UI 即时反映           |

## 潜在问题排查

- 如果 AI 尝试在非 focus 项目写入 → path-guard deny 消息应清晰提示"属于组成员 xxx"
- 如果 focus 项目路径被删除 → focus-bar 显示红色警告，chip 置灰
- 如果两个窗口同时切换 focus → 各自独立，无竞态条件

## 记录模板

| 日期 | 测试者 | TC  | 结果 | 备注 |
| ---- | ------ | --- | ---- | ---- |
|      |        | TC1 |      |      |
|      |        | TC2 |      |      |
|      |        | TC3 |      |      |
|      |        | TC4 |      |      |
