# Local Adaptations

> OpenSpace = slock.ai 的本地单机版。本文档列出本地版相对原版的 UI 差异与裁剪清单。原则：**保留所有单用户场景下有意义的 UI，去掉多用户/云端/付费/协作邀请相关部分**。

## 一句话差异

原版是**多用户云端协作平台**，本地版是**单用户本地工作台**。所有与"其他人"、"其他机器"、"账户"、"付费"相关的 UI 都可以砍掉。

## 删除项（不进 MVP）

### 账户与认证

| 原版 UI | 本地版处理 |
|---------|------------|
| 登录/注册/忘记密码页 | 全部删除，启动即进入应用 |
| Sidebar 底部"用户邮箱 + Settings 齿轮" | 保留 Settings 齿轮即可；用户名可显示为 "Local User" 或 OS 用户名 |
| `/settings`（Account 设置） | 可全删；或只保留一个极简"通用设置"页 |

### Server 多服务器概念

| 原版 UI | 本地版处理 |
|---------|------------|
| `/s/{serverName}/` URL 前缀 | 去掉，直接挂根路径；或保留 `/s/local/` 便于兼容 |
| Sidebar 顶部 "{TeamName} ▼" 下拉 | 替换为固定的应用名 "OpenSpace"（无下拉），或直接删除整块 |
| Create/Switch Server | 全删 |
| `/settings/server`（Server 设置） | 全删 |

### 多用户与邀请

| 原版 UI | 本地版处理 |
|---------|------------|
| Members Tab 下的 **HUMANS** 分组 | 全删（单用户） |
| "Invite human" 按钮 | 全删 |
| Join Links / Pending Invites | 全删 |
| Plan & Billing | 全删 |

### Machines

| 原版 UI | 本地版处理 |
|---------|------------|
| Members Tab 下的 **MACHINES** 分组 | **简化**：可选择显示单条"This Machine"，或完全隐藏本 section |
| Machine 独立页（`/machine/{id}`，参考 `70-machine-page.png`） | 可合并进 Settings 简化页，或完全删除（Runtime 检测可在 Create Agent 对话框内即时展示） |
| Agent 创建表单中的 "MACHINE *" 下拉 | 删除该字段，或锁定为 "Local Machine"（不可更改） |
| Sidebar 顶部 "Your machine is offline" 横幅 | 全删（本地进程，daemon 由 OpenSpace 自身管理） |

### Agent Avatar 上传

| 原版 UI | 本地版处理 |
|---------|------------|
| Pixel Art 头像库上传 | 可保留（静态 pixel art 集合，不支持自定义上传），或用**首字母彩色圆形**替代 |

### 全局看板页面

| 原版 UI | MVP 处理 | MVP 后处理 |
|---------|----------|------------|
| `/threads` 全局 Thread 列表（`80-global-threads.png`） | 隐藏入口或只显示占位 | Phase 2+ 完整实现 |
| `/tasks` 全局 Kanban 看板（`81-global-tasks.png`） | 隐藏入口；频道内 Tasks 面板足够 MVP | Phase 2+ 增加全局看板 |
| `/saved` Saved 收藏页（`82-saved-page.png`） | 完全不进 MVP | Phase 3+ |

### 消息交互次要功能

| 原版 UI | MVP 处理 |
|---------|----------|
| "As Task" 复选框（发消息自动创建任务） | MVP 不做，保留复选框视觉但禁用；任务通过 "+ New Task" 按钮创建 |
| Save message（🔖 图标） | 不做 |
| Search (⌘K) | 保留入口但仅占位（点击提示"Coming soon"） |

## 保留但调整的项

### 1. Sidebar 顶部 Server 区

```
原版：  [{TeamName} ▼]   ← 可切换服务器
本地：  [OpenSpace]         ← 静态 app 名
      ← 或完全删除该区，Sidebar 从 Tab 开始
```

### 2. Sidebar 底部

```
原版：  [👤] User               [⚙]
            user@example.com
本地：  [⚙] Settings                   ← 简化为单个设置入口
      ← 或保留极简 "👤 Local  [⚙]"
```

### 3. Create Agent Dialog 简化

```
原版字段：
  - Machine *
  - Name *
  - Description (optional)
  - Runtime
  - Model
  - Reasoning Effort
  - Advanced > Environment Variables

本地版字段：
  - Name *              ← 删除 Machine
  - Description (optional)
  - Runtime             ← 根据本地 PATH 实时检测 CLI 工具
  - Model               ← 由 Runtime 动态决定选项
  - Reasoning Effort
  - Advanced > Environment Variables
```

Runtime 动态检测：启动时扫描 `which codex`、`which claude`、`which cursor` 等，未找到的标记 "(not installed)" 且 disabled。

### 4. Agent Profile - INFO 区

```
原版字段：
  - Machine: Local Machine ● Connected  daemon v0.39.0
  - Runtime / Model / Reasoning tags
  - Born: 创建日期

本地版字段：
  - Runtime / Model / Reasoning tags    ← 删除 Machine 行
  - Born: 创建日期
  - CLI 路径（可选）：展示 OpenSpace 实际 spawn 的可执行文件路径
```

## 保留不变的核心 UI

- **Sidebar + Main + 右侧 Profile/Thread 三栏布局** — 100% 保留
- **暖奶油+黑边+亮色强调的 Neo-Brutalism 视觉语言** — 100% 保留
- **Chat Tab / Members Tab 切换** — 保留
- **频道 Chat / Tasks 双 Tab** — 保留
- **Agent Profile 三 Tab（Profile / Workspace / Activity）** — 保留
- **@mention 内联渲染、Task 编号内联渲染、inline/block code 渲染** — 保留
- **Thread 作为第 3 列面板** — 保留
- **Stop all agents in this channel 按钮** — 保留
- **+ New Task 流程 + Task 状态 Kanban 流** — 保留（频道内）
- **Message 流式渲染（逐字）** — 保留
- **Agent 状态点（Online / Thinking / Working / Offline）** — 保留

## 差异检查清单（MVP 交付前）

- [ ] 侧边栏无 "登录用户名 + 邮箱"
- [ ] 侧边栏无 "{TeamName} ▼" 切换
- [ ] Members Tab 无 HUMANS 分组
- [ ] Members Tab 无 Invite 按钮
- [ ] Create Agent 对话框无 Machine 字段
- [ ] Agent Profile INFO 区无 Machine 行
- [ ] 无顶部 "Machine offline" 横幅
- [ ] 无 Plan/Billing 链接
- [ ] Runtime 下拉的 CLI 检测走本地 `which` 命令，不走云端 API
- [ ] Search (⌘K) 仅占位或隐藏
- [ ] 全局 `/threads`、`/tasks`、`/saved` 入口隐藏（或跳转到频道内）

## 对 MVP-5（前端 Shell）的具体影响

MVP-5 前端 Shell 需要覆盖以下子任务：

- [ ] 按 `design-tokens.md` 定义 Tailwind theme（或直接写 CSS variables）
- [ ] 按 `components.md` 实现每个组件，并在 PR 描述中附上侧边对比截图
- [ ] 按 `routes.md` 规划 React Router 与 URL 参数解析
- [ ] 按 `local-adaptations.md` 砍掉不进 MVP 的 UI 元素

交付验收：**打开 OpenSpace 与打开 slock.ai 的核心页面做并排对比截图，布局、配色、组件样式应高度相似**（允许 ±5% 色差、间距差）。
