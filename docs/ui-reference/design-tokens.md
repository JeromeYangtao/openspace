# Design Tokens

> 色值和 token 根据 `screenshots/` 下真实截图视觉分析得出（非 DevTools 精确抓取）。
> MVP 实现时以这些 token 为基准，允许 ±5% 偏差。

## 颜色

### 主干色

| Token | 十六进制 | 用途 |
|-------|---------|------|
| `--bg-sidebar` | `#f5d042` / 黄色系 | **侧边栏背景**（明亮黄，不是奶油色！） |
| `--bg-main` | `#faf5e6` / 奶油色 | 主内容区、Profile 面板、Thread 面板背景 |
| `--bg-card` | `#ffffff` | 卡片、对话框、弹窗背景 |
| `--bg-overlay` | `rgba(0,0,0,0.5)` | 弹窗遮罩层 |

### 文字

| Token | 十六进制 | 用途 |
|-------|---------|------|
| `--text-primary` | `#000000` | 正文、标题 |
| `--text-secondary` | `#7a7a7a` 左右 | 描述截断、metadata、时间戳 |
| `--text-muted` | `#a8a8a8` 左右 | 占位符、禁用状态 |
| `--text-inverse` | `#f5d042` | 黑色背景上的黄色强调文字（如 Server 名下拉） |

### 强调色（交互状态与标签）

| Token | 近似色 | 用途 |
|-------|--------|------|
| `--accent-pink` | `#ec5f92` | **主 CTA 按钮**（Send、Create Agent、+ New Task） |
| `--accent-pink-active` | `#ec5f92` | **Active 导航项**（Sidebar 中当前选中的 Channel/DM/Threads 等，整行粉色填充） |
| `--accent-yellow` | `#fbda4d` | Active Tab（CHAT 当前）、task 编号 inline 高亮（`#27`） |
| `--accent-green` | `#4bd156` | 在线状态点、"Start All" 按钮背景 |
| `--accent-orange` | `#ff9a4d` | Task `TODO` badge 背景 |
| `--accent-red` | `#eb3a3a` | Delete Agent 按钮、危险操作 |
| `--accent-teal` | `#8ed1d8` | `Runtime` 标签（Codex CLI、Cursor CLI 等已安装）、inline `@mention` 背景 |
| `--accent-purple` | `#c6b3ff` | `Model` 标签（GPT-5.4）、Task `IN REVIEW` badge |
| `--accent-cyan` | `#b3e5e5` | Task `IN PROGRESS` badge |

### 状态点（Agent / Machine）

| 状态 | 色值 | 位置 |
|------|------|------|
| Online（绿） | `#4bd156` | 小圆点（~8px 直径） |
| Thinking（橙） | `#ff9a4d` | 同上 |
| Working（橙） | `#ff9a4d` | 同上 |
| Hibernating（灰） | `#9a9a9a` | 同上 |
| Offline（深灰） | `#6b6b6b` | 同上 |

### 边框

- 标准边框：`2px solid #000000`（所有卡片、按钮、对话框、tab、侧边栏容器）
- 未选中 Tab 下方透明 → 选中 Tab 黑色下划线或整体黄色填充

## 字体

### Font Family

- **正文/UI**: 常见系统无衬线字体栈（`-apple-system, BlinkMacSystemFont, 'Inter', sans-serif` 推测）
- **等宽字体（代码 / Agent description 截断 / path 显示 / 按钮大写标签）**: `'SF Mono', Menlo, Monaco, Consolas, monospace`
  - 使用位置：侧边栏 Agent description 截断、Workspace 路径显示 `~/.slock/agents/{id}/`、按钮大写 Label（如 "CHAT" "PROFILE" "RUNTIME" 等 section header）、Create Agent 对话框中的大写标签

### Font Size

| Token | 推测值 | 用途 |
|-------|--------|------|
| `--text-xs` | 11-12px | metadata、timestamp |
| `--text-sm` | 13-14px | 描述截断、辅助文字 |
| `--text-base` | 15-16px | 正文、输入框、频道/Agent 名 |
| `--text-lg` | 18-20px | 页面 heading（如 "Tasks"、"Threads"） |
| `--text-section` | 12-13px + uppercase + letter-spacing 0.05em | Section header（"CHANNELS" "DIRECT MESSAGES" "AGENTS" "INFO" "DESCRIPTION" 等） |

### Font Weight

- Regular: 400（正文）
- Medium: 500（Agent 名、频道名）
- Bold: 700（页面标题、加粗强调文字）

## 间距（推测）

按 4px 基准栅格：

| Token | 值 | 用途 |
|-------|----|----|
| `--space-1` | 4px | 极小间隙 |
| `--space-2` | 8px | 图标与文字间距 |
| `--space-3` | 12px | 列表项内垂直 padding |
| `--space-4` | 16px | 卡片 padding、对话框字段间距 |
| `--space-5` | 20px | Section 之间 |
| `--space-6` | 24px | 大区块之间 |
| `--space-8` | 32px | 对话框 padding |

## 圆角

- 按钮 / Tab / Tag / Badge：轻微圆角 **~6-8px**（`border-radius: 6px`）
- 对话框 / 卡片：**~10-12px**（`border-radius: 10px`）
- 状态点：完全圆形（`border-radius: 9999px`）
- 输入框：**~8px**

## 阴影

- 对话框/弹窗：**硬阴影**（偏移 4-6px，无模糊或极小模糊），强化 Neo-Brutalism 视觉
  - `box-shadow: 4px 4px 0 0 #000000` 近似
- 消息卡片、Tab active 等：无阴影或极轻阴影

## 按钮风格

所有按钮都有 **2px 黑色边框**，悬停/聚焦变化主要通过背景色：

| 类型 | 默认 | 悬停 |
|------|------|------|
| Primary CTA | `--accent-pink` + 黑字 | 略深 pink |
| Secondary | `#ffffff` + 黑字 | 浅灰填充 |
| Success | `--accent-green` + 黑字 | 略深 green |
| Danger | `--accent-red` + 黑字 | 略深 red |
| Icon Only | `#ffffff` + 黑图标 | 浅灰填充 |

## 头像

### Pixel Art Agent Avatar
- 方形，约 **32×32px**（侧边栏） / **48×48px**（消息） / **72×72px**（Profile 大头像）
- 蓝色/青色背景 + 像素角色轮廓（类似 Minecraft Steve 风格）
- 轻微圆角（~4px）或直角
- 2px 黑色边框

### User Avatar
- 紫色圆形背景 + 白色人形 icon
- 相同尺寸规格
- **MVP 本地版可用首字母替代**（放弃像素艺术上传功能）

## Unread Badge / Count

- 活跃 channel 行右侧小红圆：
  - 圆形背景 `--accent-pink`（如 "35"）
  - 白色或黑色数字
  - 直径 ~18px
- Sidebar Section 计数（Channels 2 / Threads 26）：普通文字，无背景

## Task 状态 Badge

| 状态 | 背景色 | 字色 | 文字 |
|------|--------|------|------|
| TODO | `--accent-orange` | 黑 | `TODO` |
| IN PROGRESS | `--accent-cyan` | 黑 | `IN PROGRESS` |
| IN REVIEW | `--accent-purple` | 黑 | `IN REVIEW` |
| DONE | `#b8e98c` 浅绿 | 黑 | `DONE` |

所有 badge 有 2px 黑边 + 小圆角 + 等宽大写字体。

## 关键交互视觉

- **@mention 内联**：黄色背景 + 黑字 + 2px 黑边 + 小圆角（例 `@Reviewer`）
- **task 编号内联**：等宽字体 + 黄底黑字 + 小圆角（例 `#27`）
- **inline code**：等宽字体 + 浅灰/米色背景 + 2px 黑边 + 小圆角（例 `spec_review`、`package.json`）
- **块级 code**：等宽字体 + 白色背景 + 2px 黑边 + 圆角 + padding，支持跨行
