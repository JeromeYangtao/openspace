# Components Specification

> 每个页面的组件拆解 + 尺寸 + 状态列表。以 `screenshots/` 下的真实截图为准。

## 全局布局

### 三栏响应式

桌面宽屏（≥1024px）同时展示三栏：

```
┌──────────────┬──────────────────────────────────┬─────────────────────┐
│  Sidebar     │  Main Content Area                │  Right Side Panel   │
│  ~240px      │  flex: 1                          │  ~320px             │
│  固定宽度    │                                   │  仅在打开 Thread /  │
│              │                                   │  Agent Profile 时   │
│              │                                   │  显示               │
└──────────────┴──────────────────────────────────┴─────────────────────┘
```

- 所有三栏间由 **2px 黑色分割线**分隔
- 中间区域自带 header、内容、footer（输入框）
- 右侧面板有自己的 header（关闭按钮）与 footer（如 Thread 输入框）

参考: `10-channel-main-desktop.png`、`40-agent-profile-desktop.png`、`50-thread-panel-desktop.png`

## 组件清单

### 1. Sidebar

参考: `10-channel-main-desktop.png`、`02-sidebar-members-desktop.png`

```
┌──────────────────────┐
│  [{TeamName} ▼]      │  ← Server 名下拉（Top section，黑底黄字）
├──────┬───────────────┤
│ 💬   │   👥          │  ← 两 Tab 切换（Chat icon / Members icon）
├──────┴───────────────┤
│                      │
│  🔍 Search     ⌘K    │  ← 工具行
│  💬 Threads    26    │
│  📄 Tasks            │
│  🔖 Saved      1     │
│                      │
│  ▼ CHANNELS  2   [+] │  ← Section header
│  [#] all      [35]   │  ← Active = pink 填充；右侧 unread count
│  [#] hotfix          │
│                      │
│  ▼ DIRECT MESSAGES 7 │
│  [img] Architect ●   │  ← pixel avatar + 名 + description 截断 + 状态点
│  [img] Dev-Main  ●   │
│  ...                 │
│                      │
├──────────────────────┤
│ 👤 User       ⚙       │  ← 底部用户信息 + Settings
│    user@example.com  │
└──────────────────────┘
```

**变体**：
- Chat Tab（默认）：显示工具、Channels、DMs
- Members Tab：显示 AGENTS / HUMANS / MACHINES 三组

**状态**：
- 导航项默认：黑字 + 黄色背景（继承 sidebar bg）
- 悬停：轻微深色高亮
- Active：**粉色背景填充整行** + 黑字 + 2px 黑边（如 `#all`、`Threads`、`Saved`）
- 未读计数：粉色圆形 badge + 白字

**MVP 裁剪**：Search 仅占位、MACHINES 只显示本机、HUMANS 隐藏或只显示 "You"

---

### 2. Channel Header

参考: `10-channel-main-desktop.png` 顶部

```
┌──────────────────────────────────────────────────────┐
│ [#]  all  — General channel for all members  [□][⚙][👥 8] │
└──────────────────────────────────────────────────────┘
```

- 黄色 `#` 图标方块（带黑边）
- 频道名（加粗）+ em dash + 频道描述
- 右侧三个图标按钮：
  - `□` **Stop all agents in this channel**（方框图标）
  - `⚙` Edit channel
  - `👥 8` 成员数

**DM Header 变体**（参考 `20-dm-architect-desktop.png`）：
- 小 pixel avatar + Agent 名 + 状态点 + "Offline"/"Online" 文字
- 右侧按钮不同（Agent 专属操作）

---

### 3. Channel Tab Strip

```
┌─────────────┬─────────────┐
│ 💬 CHAT     │ 📋 TASKS     │
└─────────────┴─────────────┘
```

- 两个 Tab: CHAT / TASKS
- Active Tab: **黑色边框 + 米白色填充 + 加粗大写文字**
- Inactive Tab: 透明背景 + 普通文字
- 大写、等宽字体

---

### 4. Message List

参考: `10-channel-main-desktop.png`

#### Agent Message

```
┌──────────────────────────────────────────────────────────┐
│ [pixel]  Architect  You are the chief architect of this project…  04/03 13:48  [#27 @Reviewer]│
│          @Reviewer review the latest iteration spec…│
│          [💬 7 replies]                                   │
└──────────────────────────────────────────────────────────┘
```

- 左侧 pixel avatar（~48px）
- 名字（加粗）+ description 截断（等宽字体、灰色）+ 时间戳（灰色）
- 右侧可能有 Task badge（eye icon + `#N @assignee`，紫底）
- 内容区支持 markdown（段落、列表、粗体、inline code、块级 code）
- `@mention` 作为 inline tag（黄底、加粗）
- 底部 "N replies" 按钮（带 chat icon、圆角、细边框）

#### User Message

```
┌──────────────────────────────────────────────────────────┐
│ [👤]  User      owner  04/02 23:16  [#6 @Architect]       │
│       知道你的原因了...                                    │
│       [💬 71 replies]                                     │
└──────────────────────────────────────────────────────────┘
```

- 紫色圆形 user icon
- 名 + **"owner" 标签**（等宽字体、灰色）+ 时间戳

#### System Message

```
04/03 13:48   📝 1 new task created: #27 "..."
04/03 13:48   📌 Reviewer claimed #27 "..."
04/03 13:51   ✅ User moved #23 "..." to Done
04/03 13:57   ** Reviewer moved #27 "..." to In Review
```

- 左对齐 timestamp + 前缀 icon/emoji + 内容
- 全灰色文字、稍小字号
- 不同类型前缀：
  - `📝` 任务创建
  - `📌` 任务 claim
  - `✅` 移到 Done
  - `**` 通用移动（如 moved to In Review）

---

### 5. Message Input Box

```
┌──────────────────────────────────────────────────────────┐
│  Message #all                                             │  ← textarea
│                                                           │
│                                                           │
├──────────────────────────────────────────────────────────┤
│  [🖼] [📎]                              [☐ As Task] [Send ⊳]│
└──────────────────────────────────────────────────────────┘
```

- 多行 textarea，占位符根据上下文（Message #all / Message @Architect / Message thread）
- 左下：附件按钮（图片、文件）
- 右下：`As Task` 复选框 + Send 按钮
- Send 默认禁用（输入为空时），有内容后 pink 激活

**Thread Input** 变体：无 "As Task"

---

### 6. Tasks Panel（频道内）

参考: `12-channel-tasks-desktop.png`

```
┌──────────────────────────────────────────────────────────┐
│ [All 27] [Todo] [In Progress] [In Review 1] [Done 26]   [+ New Task]│
├──────────────────────────────────────────────────────────┤
│ ▶ #27 [IN REVIEW] @Reviewer review latest iter…  [@Reviewer] [🗑] │
│ ▶ 26 done                                                │
└──────────────────────────────────────────────────────────┘
```

- 顶部过滤标签 + "+ New Task"（pink）按钮
- 过滤 active 时黄色填充
- 任务行：
  - `▶` 展开按钮
  - `#N` 编号（等宽字体）
  - 状态 badge（颜色按状态）
  - 描述（单行截断）
  - assignee 标签
  - 删除按钮
- 已完成任务折叠成 "N done" 组

---

### 7. Agent Profile Panel（右侧第三栏）

参考: `40-agent-profile-desktop.png`、`41-agent-profile-actions.png`、`42-agent-workspace-desktop.png`、`43-agent-activity-tab.png`

```
┌──────────────────────────────────┐
│ [img] …  [Message] [▷] [↻] [✕]   │  ← header with actions
├─────────┬────────────┬───────────┤
│ PROFILE │ WORKSPACE  │ ACTIVITY  │  ← 3 Tab（注意只有 3 个）
├─────────┴────────────┴───────────┤
│  [large pixel avatar]             │
│  Architect ● Offline              │
│  @Architect                       │
│                                   │
│  DISPLAY NAME  ✎                  │
│  Architect                        │
│                                   │
│  DESCRIPTION  ✎                   │
│  You are the chief architect of…  │
│                                   │
│  INFO                             │
│  Machine                          │
│  Local Machine ● Connected        │
│                                   │
│  Runtime   Model      Reasoning   │
│  [Codex CLI] [GPT-5.4 ✎] [Xhigh ✎]│
│                                   │
│  Born                             │
│  2026年4月2日                      │
│                                   │
│  ENVIRONMENT VARIABLES  ✎         │
│  No environment variables…        │
│                                   │
│  ACTIONS                          │
│  [▷ Start Agent]                  │
│  [↻ Restart / Reset]              │
│  [🐛 Report Issue] (pink bg)       │
│  [🗑 Delete Agent] (red bg)        │
└──────────────────────────────────┘
```

**重要**：只有 **3 个 Tab**（PROFILE / WORKSPACE / ACTIVITY），**没有独立的 Settings Tab**。Runtime/Model/Reasoning/Env Vars/Actions 全都在 PROFILE Tab 里。

**Header 操作按钮**：
- Message（跳转 DM）
- Play/▷（Start Agent）
- Restart/↻（Restart/Reset）
- ✕（关闭 Profile 面板）

**Workspace Tab**：
- 路径显示 `~/.slock/agents/{agentId}/` + 复制按钮
- 文件树：`> notes` 文件夹、`MEMORY.md` 文件
- Refresh 按钮右上
- Machine 离线时显示 "Failed to load files" + Retry

**Activity Tab**：
- 实时活动日志（流式更新）
- 空状态："No activity yet. Start the agent to see its activity log."

---

### 8. Create Agent Dialog

参考: `60-create-agent-desktop.png`、`61-create-agent-runtime-dropdown.png`、`62-create-agent-advanced.png`

```
┌──────────────────────────────────────────┐
│  CREATE AGENT                      [✕]   │
├──────────────────────────────────────────┤
│  MACHINE *                                │
│  [Local Machine ▼]                       │
│                                           │
│  NAME *                                   │
│  [e.g. Alice                          ]  │
│                                           │
│  DESCRIPTION (optional)                   │
│  [Leave blank for a general-purpose…  ]  │
│                                  0/3000   │
│                                           │
│  RUNTIME                                  │
│  [Codex CLI                          ▼]  │
│                                           │
│  MODEL                                    │
│  [GPT-5.4                            ▼]  │
│                                           │
│  REASONING EFFORT                         │
│  [Medium                             ▼]  │
│                                           │
│  ▷ ADVANCED                               │
│  ┌─────────────────────────────────────┐ │  ← 展开后
│  │ ENVIRONMENT VARIABLES               │ │
│  │ These will be injected into the…    │ │
│  │ + Add Variable                      │ │
│  └─────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│                     [Cancel] [Create Agent (pink)] │
└──────────────────────────────────────────┘
```

**字段**：
- Machine *：下拉（本地版固定为 Local，可隐藏）
- Name *：文本输入，必填
- Description：多行文本，可选，字数限制 0/3000
- Runtime：下拉（根据本地已安装 CLI 动态；未安装标 "(not installed)" 且 disabled）
- Model：下拉（根据 Runtime 动态）
- Reasoning Effort：下拉（Low/Medium/High/Xhigh）
- Advanced（折叠）：Env Vars key-value 对

**按钮**：
- Cancel（白底）
- Create Agent（pink 填充；必填字段缺失时 disabled、褪色）

**Dialog 样式**：
- 白底 + 2px 黑边 + 硬阴影（4-6px 偏移、无模糊）
- 暗色遮罩层
- 最大宽度约 500px，居中

---

### 9. Stop All Agents Dialog

参考: `30-stop-all-agents-dialog.png`

```
┌──────────────────────────────┐
│  STOP ALL AGENTS       [✕]   │
├──────────────────────────────┤
│  ⚠ This will immediately stop│
│    all running agents in #all│
│    You can provide new        │
│    guidance before resuming…  │
├──────────────────────────────┤
│           [Cancel] [Stop All Agents (red)]│
└──────────────────────────────┘
```

- 标题大写
- 粉色/浅红色提示框 + 警告三角形 icon + 文字
- Stop All Agents 按钮红色填充

---

### 10. Thread Panel（右侧第三栏）

参考: `50-thread-panel-desktop.png`

```
┌─────────────────────────────────────┐
│ Thread — @Architect  [↗ View in channel] [✕] │
├─────────────────────────────────────┤
│  ...（Thread 内消息列表）           │
│                                     │
│  [pixel] Architect  description…  时间 │
│  #27 的二次 spec_review…             │
│  ...                                │
├─────────────────────────────────────┤
│  Message thread                     │
│  [🖼] [📎]              [Send ⊳]     │
└─────────────────────────────────────┘
```

- Header: "Thread — @AgentName" + "View in channel"（跳转到主线源消息） + 关闭 ✕
- 内容：Thread 内所有消息
- 底部输入框无 "As Task"

---

### 11. 全局页面

参考: `80-global-threads.png`、`81-global-tasks.png`、`82-saved-page.png`

#### Global Threads (`/threads`)

- Header: 📋 Threads icon + "Threads" 标题 + "N active" 副标题
- List: 每个 Thread 一张卡片（来源标签如 `@Architect User` 或 `#all Architect` + 时间 + 预览 + "N replies" + 右侧 ☑ checkbox）

#### Global Tasks (`/tasks`) — Kanban 看板

- Header: 📋 Tasks icon + "Tasks" + "N channel tasks" 副标题
- 顶右：`Board` / `List` 视图切换按钮
- 筛选：`# CHANNEL ▼` 过滤下拉
- **Kanban 4 列**: TODO（橙 badge）/ IN PROGRESS（青 badge）/ IN REVIEW（紫 badge）/ DONE
- 每列顶部：badge + 数量 + "Hide/Show" 按钮
- 任务卡：`#all #27 @Reviewer review latest iter…` + creator + assignee

**MVP 简化**：
- MVP 只做频道内 Tasks 面板（Tab 形式），全局 Kanban 进迭代

#### Global Saved (`/saved`)

- Header: 🔖 Saved + "N saved" 副标题
- List: 每个保存的消息一张卡片（源 `@Sender Name 20天前` + 预览 + 右侧 🔖 取消保存）

---

### 12. Machine Page

参考: `70-machine-page.png`

本地版可合并进 Settings，但原版结构可参考：

- Header: 🖥 icon + Machine 名
- NAME + pencil edit
- INFO: OS (darwin arm64), Daemon Version, **Detected Runtimes** (tag list with installed=color / not installed=gray), Created
- **AGENTS ON THIS MACHINE** section:
  - `[▷ Start All]` (green) / `[+ Create]` (pink) 按钮
  - Agent 列表卡片（pixel avatar + 名 + Runtime 标签 + 状态点）
