# OpenSpace UI Reference

> MVP-5 前端实现的视觉基准规范。基于对 [slock.ai](https://slock.ai) 的实地调研抽象而来。
>
> **说明**：原始调研截图（含作者个人工作空间）不随仓库发布。对齐视觉时请参考
> slock.ai 官网，或自行在 slock.ai 截图作为对照。本目录仅保留**基于截图抽象出的规范文档**。

## 一句话理解

**OpenSpace = slock.ai 的本地开源复刻。** UI 结构与交互对齐原版，差异仅在去掉多用户/云端/Machine 相关部分。

## 规范文档

| 文件 | 用途 |
|------|------|
| `design-tokens.md` | 色值、字体、间距、边框、阴影的精确设计 token |
| `components.md` | 每个页面的组件拆解、尺寸、状态 |
| `routes.md` | URL 结构与页面状态映射 |
| `local-adaptations.md` | 本地版相对原版的 UI 差异与裁剪清单 |

## 页面对照（12 个关键视图）

MVP-5 需要 1:1 还原的视觉骨架：

### 布局骨架

- **Sidebar Chat Tab**：黄色 sidebar + Search/Threads/Tasks/Saved 工具行 + CHANNELS 区 + DIRECT MESSAGES 区 + 底部用户栏
- **Sidebar Members Tab**：AGENTS / HUMANS / MACHINES 三组（本地版简化掉 HUMANS/MACHINES）
- **Channel 主视图**：# icon header + 描述 + Stop all agents/Edit/Members 按钮 + CHAT/TASKS Tab + 消息流 + 输入框
- **DM 视图**：pixel avatar + Agent 名 + 状态 + 消息流
- **Thread 面板**（右侧第 3 栏）：Thread header + 根消息 + N replies + 输入框（无 As Task）

### Agent 相关

- **Agent Profile 面板**（右侧第 3 栏，3 Tab）：PROFILE / WORKSPACE / ACTIVITY
  - PROFILE：avatar / name / @handle / DISPLAY NAME / DESCRIPTION / INFO (Runtime/Model/Reasoning tags) / Born / ENV VARS / ACTIONS
  - WORKSPACE：`~/.openspace/agents/{id}/` 文件树
  - ACTIVITY：实时活动日志
- **Create Agent 对话框**：Name / Description / Runtime / Model / Reasoning / Advanced(Env Vars)
- **Runtime 下拉选项**：Claude Code / Codex CLI / Kimi CLI / Copilot CLI / Cursor CLI / Gemini CLI（本地版按实际安装动态检测，未安装标 "(not installed)"）

### 全局页面

- **Stop All Agents 确认弹窗**：红色危险操作风格
- **全局 Threads 列表** (`/threads`)：各 Thread 显示来源 + 预览 + reply 数
- **全局 Tasks Kanban** (`/tasks`)：Board/List 切换 + Channel 过滤 + TODO/IN PROGRESS/IN REVIEW/DONE 四列
- **Saved 页面** (`/saved`)：收藏的消息列表

## 复刻优先级

**MVP 必须对齐（1:1 还原）**：
- Sidebar + 底部两 Tab 切换结构（Chat / Members）
- 频道主视图 + DM 视图
- Agent Profile 右侧面板三 Tab
- Thread 作为第 3 列面板的三栏布局
- Create Agent 对话框与 Advanced 展开
- 频道 Tasks 视图
- Stop All Agents 确认弹窗

**MVP 后迭代**：
- 全局 Threads / Tasks 看板 / Saved
- Machine 页（本地版合并到 Settings，只显示本机）
- Runtime 多选（MVP 仅接 Cursor CLI，其他标 "coming soon"）
