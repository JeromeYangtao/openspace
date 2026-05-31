# Technical Decisions & Defaults

> OpenSpace 项目的默认技术决策与常量。开发中遇到本文档覆盖的问题时，以此为准；发现不合理时通过 PR 修改本文档 + 关联代码。
>
> 所有决策编号为 `D-N`，可以在代码注释和 commit message 中引用（例 "Fix D-4 budget overflow"）。

## 对齐 `product-brief.md` v1.0.1

本文档是战略文档 [`product-brief.md`](product-brief.md) v1.0.1 的**实现层映射**。每条 `D-N` 要么是 product-brief 里某条核心决策的**技术细节补充**（常量、默认值、schema），要么是 product-brief 未覆盖的**纯实现约束**（错误 UI / 启动方式 / token 预算等）。

| D-N | 对齐的 product-brief 章节 | 性质 |
|-----|-----------------------|------|
| D-1 / D-2 | §D-7 多项目并发隔离（状态派生 per-channel） | 细节补充 |
| D-3 | §D-7（`agent_activity` schema） | 细节补充 |
| D-4 / D-5 | §5.1 ContextBuilder / spawn-per-message | 细节补充 |
| D-6 | §D-7 K-2（链式触发 per-thread 计数） | 细节补充 |
| D-7 | §D-5 Responsibility metadata 之一 | 细节补充 |
| D-8 | §D-8 OpenSpace 无 Agent 独立 workspace | 细节补充 |
| D-9 | §D-3 Goal 驱动的 Create Project 流程 | 细节补充 |
| D-10 / D-11 | 无对应战略条目（纯实现） | 纯实现 |
| D-12 | §C-1 Cursor Adapter 流式策略 | 细节补充 |
| **D-13** | §D-2 Server = Project | v1.0 新增锚点 |
| **D-14** | §D-3 Goal 是一等公民 | v1.0 新增锚点 |
| **D-15** | §6 System Agents | v1.0 新增锚点 |
| **D-16** | §D-4 Workflow 即甬道 | v1.0 新增锚点 |
| **D-17** | §D-5 Responsibility 即 Step × Agent | v1.0 新增锚点 |
| **D-18** | §D-7 多 Project 并发隔离六层契约 | v1.0 新增锚点 |
| **D-19** | §D-3 Team Architect 兜底三件套 | v1.0 新增锚点 |
| **D-20** | §5.3 四个运营闭环 | v1.0 新增锚点 |
| **D-21** | "Cursor 风格 open folder" 心智 | v1.1 新增（Per-Project Storage 重构）|
| **D-22** | §D-7 多项目隔离的物理实现 | D-21 衍生 |
| **D-23** | §D-3 / §D-7 协作友好的 git 入仓建议 | D-21 衍生 |
| **D-24** | §11 Schema 总清单 | D-21 衍生 |
| **D-25** | §D-2 Project lifecycle Q-11 决议 | D-21 衍生 |

**冲突规则**：本文档与 product-brief 冲突时，**以 product-brief 为准**。本文档只负责承载"实现细节"，不决定产品定位。

> **关于"目标状态" vs "当前实际状态"**：本文档描述的是**目标决策**。当前代码可能因为兼容旧版本仍处于过渡状态（例如 D-1 / D-8 描述了"已废除"但代码仍保留 v0 兼容字段）。实施进度以代码和 PLAN 为准，本文档不重复维护。

---

## D-1: Agent 状态机（重定义，适配 spawn-per-message 模型）

### 决策

使用以下 5 个状态替代原版的 `Online/Thinking/Working/Hibernating/Offline`:

| 状态 | 含义 | UI 状态点颜色 |
|------|------|---------------|
| `idle` | Agent 已配置、CLI 已检测可用、当前无进程 | 🟢 绿色 |
| `thinking` | 已 spawn 进程，正在消费 stdin 或等待首个事件 | 🟠 橙色 |
| `working` | 进程已产出 `text_delta` 或 `tool_started` | 🟠 橙色 |
| `error` | 上一次 spawn 失败/超时/非 0 退出 | 🔴 红色 |
| `stopped` | 用户显式 Stop，需手动 Start 才能再次响应 | ⚫ 灰色 |

### 存储方式（v1.0.1 修订）

**目标状态**：原 `agents.status` 单值字段**废除**（v0 设计的隔离缺陷 K-1）；状态改为 **per-channel 派生**：

- 新建 `agent_runs(id, agent_id, channel_id, status, started_at, ended_at)` 表记录每次 spawn
- 查询 Agent 在指定 channel 的当前状态：`SELECT status FROM agent_runs WHERE agent_id=? AND channel_id=? AND ended_at IS NULL`
- Sidebar 全局状态点派生自 "any active run"；DM Header 等精细位置显示 per-channel 状态
- 详见 `product-brief.md §D-7 K-1`

> **历史过渡说明**：`agent_runs` 表已写入并是 engine 端事实来源；旧版曾保留 `agents.status` 兼容前端。

### 理由

- `spawn-per-message` 模型下没有"长期在线"的进程，删除 `Online`/`Hibernating` 避免误导
- `idle` 对应原版 "Online"（已注册可用）
- `thinking` / `working` 拆分保留，前端可据此切换加载图标
- per-channel 派生解决同一 Agent 并发在多个 channel 时状态互相覆盖问题

### 状态转移

```
              spawn
   idle  ─────────────►  thinking  ─────────────►  working  ─────────────►  idle
    ▲                        │                        │                       │
    │                        │ timeout / crash        │ timeout / crash       │
    │                        ▼                        ▼                       │
    │                      error  ────── retry ────►  thinking                │
    │                                                                         │
    │                                                                         │
    │                          user click Stop                                │
    └─────────── stopped ◄─────────────────────────────────────────────────────┘
                   │
                   │ user click Start
                   ▼
                 idle
```

---

## D-2: CLI 事件 → Agent 状态映射

| CLI 事件（Phase 0 统一后的 `CLIEvent`） | Agent 状态变更 |
|----------------------------------------|-----------------|
| `spawn 前` | `idle` → `thinking` |
| 首个 `text_delta` 或 `tool_started` | `thinking` → `working` |
| `tool_started` 后续（已在 working） | 保持 `working` |
| `done`（进程正常退出） | `working` → `idle` |
| `error`（非 0 退出 / 超时 / parse 失败） | 任意 → `error` |
| 用户点 Stop | 任意 → `stopped`（同时 kill 进程） |
| 用户点 Start（从 `stopped` 或 `error`） | → `idle` |

所有状态变更通过 WebSocket `agent_status` 事件广播，前端 `useAgentStore` 订阅更新。

---

## D-3: Activity 记录粒度

`agent_activity` 表用于 Profile → Activity Tab 实时日志。**不等同于消息流**，只记录"元事件"。

### Schema（v1.0.1 修订）

- 原 v0 schema 缺 `channel_id` 字段，UI 混展不同 channel 的活动（K-3）
- **v1.0.1 起** `agent_activity` 必须包含 `channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE`
- 索引：`idx_activity_agent_channel(agent_id, channel_id, created_at DESC)`
- Activity Tab 提供 "filter by channel" 下拉

### 记录规则

| 触发 | 写一条 activity | 示例 `detail` |
|------|-----------------|---------------|
| spawn 开始 | `type=thinking` | `"Spawning cursor with model=composer-2-fast"` |
| 首个 text/tool 事件 | `type=working` | `"Started generating response"` |
| 每个 `tool_started` | `type=working` | `"Shell: ls -la /path"` |
| 每个 `tool_completed` | `type=output` | `"Shell completed (exit=0)"` |
| `done`（正常结束） | `type=idle` | `"Completed in 12.3s"` |
| `error` | `type=error` | `"Timeout after 300s"` |

**不记录**：
- `text_delta`（每个字符/片段都记录会爆炸）
- 心跳事件
- 用户消息本身（那是 messages 表的事）

### 保留策略

- 每个 agent 保留最近 **500 条 activity**（全 channel 合并），超出从头删除
- Profile → Activity Tab 分页加载（每页 50 条）

---

## D-4: Token 预算默认值

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `MAX_CONTEXT_TOKENS` | `8000` | 单次 spawn 注入给 CLI 的总 token 上限（保守值，所有主流模型都 OK） |
| `DESCRIPTION_BUDGET` | `2000` | Agent `description` 占用的预算上限，超过截断 |
| `HISTORY_BUDGET` | `5500` | 对话历史占用预算，**按最近消息倒序填充直到用完** |
| `CURRENT_MESSAGE_BUDGET` | `500` | 当前触发消息占用预算（几乎不会超） |

### 截断策略

- Token 估算用 **"4 字符 ≈ 1 token"** 的粗估（不引入 tokenizer 依赖）
- 从最新消息往前累加字符数到 `HISTORY_BUDGET * 4`，超出就丢弃
- `description` 如果超限，从中间截断并用 `...` 代替（保留开头 + 结尾的职责说明）

### 可配置

上述常量写在 `packages/shared/src/constants.ts`，用户暂不在 UI 中配置。未来可加入 `Advanced Settings`。

---

## D-5: 并发控制

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `MAX_CONCURRENT_PROCESSES` | `3` | 同时运行的 CLI 进程数上限 |
| `PROCESS_TIMEOUT_MS` | `300000`（5 分钟） | 单次 spawn 的超时时间 |
| `QUEUE_STRATEGY` | `FIFO` | 超出并发时的等待队列策略 |
| `QUEUE_MAX_SIZE` | `20` | 队列最大长度，超出直接拒绝并返回 error |

### 行为

- 请求来时：并发 < 3 → 立刻 spawn；并发 = 3 → 进入队列；队列满 → 立刻返回 `agent_status = error, detail="queue_full"`
- 进程结束后：检查队列，FIFO 弹出下一个
- 用户点 Stop：从队列中移除（如果在队列中），或 kill 进程（如果已 spawn）

---

## D-6: 链式触发防护

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `MAX_CHAIN_DEPTH` | `10` | 一次链式触发最多传递多少层 |
| `MAX_AGENT_CONSECUTIVE_TRIGGERS` | `3` | 同一 agent 在**同一 thread** 内连续被触发次数上限 |
| `MAX_MENTIONS_PER_MESSAGE` | `5` | 单条消息 @mention 他人的上限（超出不触发后面的） |

### 计数维度（v1.0.1 明确）

所有计数**按 thread 作用域**，**不按 agent 全局**（K-2 修正）：

- `chain_depth` 沿 `messages.parent_id` 树累加，切换到不同 thread 时**重置为 0**
- `consecutive_triggers` 只在同一 thread 内累加，同一 Agent 在不同 thread 的触发互不相关
- 这保证：Agent 同时被两个 thread 各触发 2 次，**不会误伤**（只有单个 thread 里连续触发才计数）

### 行为

- 消息带 `chain_depth` metadata（从 0 开始）
- Message Router 在触发下一 Agent 前检查：
  - 当前 thread 消息数 >= `MAX_CHAIN_DEPTH` → 停止触发 + 发 system 消息 `"Chain depth limit reached"`
  - 同一 agent 在**当前 thread** 内连续被触发 >= 3 → 停止 + `"Possible infinite loop detected"`
- User 主动 @mention 不受 `consecutive` 限制（只防 Agent 间循环）

---

## D-7: `messages.metadata_json` 契约

TypeScript 类型（在 `packages/shared/src/types.ts` 中定义）:

```typescript
type MessageMetadata = {
  // 提及的 agent 列表（正则解析自 content）
  mentions?: Array<{ name: string; agent_id: string | null }>;

  // 关联的 task（当 Task 状态变更产生系统消息时）
  task_ref?: {
    id: number;
    title: string;
    status: 'todo' | 'in_progress' | 'in_review' | 'done';
    assignee_agent_id: string | null;
  };

  // 链式触发深度（0 = 用户首次发起）
  chain_depth?: number;

  // 链式触发中的"上游"消息 id
  triggered_by_message_id?: string;

  // CLI 工具调用记录（存在此消息的响应内）
  tool_calls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result?: string;
    success?: boolean;
    duration_ms?: number;
  }>;

  // 消息是否正在流式输出（未完成时为 true，完成后移除或置 false）
  streaming?: boolean;

  // Agent 响应的元信息（仅 sender_type=agent 时存在）
  agent_meta?: {
    runtime: string;        // "codex" / "claude" / "cursor"
    model: string;          // 实际使用的模型
    total_duration_ms: number;
    input_tokens_estimate?: number;
    output_tokens_estimate?: number;
  };

  // System 消息的事件类型（仅 sender_type=system 时存在）
  system_event?:
    | { type: 'task_created'; task_id: number; title: string }
    | { type: 'task_claimed'; task_id: number; agent: string }
    | { type: 'task_moved'; task_id: number; from: string; to: string; by: string }
    | { type: 'agent_error'; agent: string; message: string }
    | { type: 'chain_limit_reached'; detail: string };
};
```

### 规则

- metadata_json 字段非必需（`NULL` 合法）
- 插入时序列化 JSON；读取时按类型反序列化
- 前端渲染消息卡片时，根据 metadata 决定 task badge、@mention 样式等

---

## D-8: OpenSpace 不提供 Agent 独立 workspace（v1.0 修订 / 原决策作废）

### v0 设计（已作废，仅供对比）

v0 设计给每个 Agent 分配 `~/.openspace/agents/{agent_id}/` 作为 cwd 沙盒 + 记忆目录。该设计在 v1.0 **全面废弃**。

### v1.0 决策

OpenSpace **不提供** Agent 独立 workspace。原因：
1. 聚焦"编程协作" + 关闭"自主学习型 Agent" 口子后，Agent 的记忆通过其他机制承载（见下）
2. 原沙盒同时兼 cwd 和记忆职责，混淆了"当下工作目录"和"长期私人空间"
3. 多 Project 并发时沙盒成为共享 cwd，两 Project 会冲突（K-5）

### Agent cwd 的唯一来源

```typescript
// CLIRunner 构造 spawn 参数
const project = projectsRepo.byId(channel.project_id);
const cwd = project.workspace_path;  // 必填（D-13），不再有兜底
```

- `projects.workspace_path` 是 `NOT NULL`
- 不存在"纯聊天 Project"的回退路径（N-11）

> **历史过渡说明**：旧版 CLIRunner 在 channel 没有 project_id 时曾有 `~/.openspace/agents/{id}/` 兜底；当前运行时应以 `project.workspace_path` 为唯一 cwd 来源。

### Agent 记忆的承载机制

原本想让 workspace 承载的"Agent 长期记忆"，在 v1.0 通过以下机制分摊：

| 原职责 | v1.0 新归属 |
|-------|-----------|
| 跨对话对话历史 | OpenSpace `messages` 表 + ContextBuilder 注入（D-4）|
| Agent 人格（长期 description）| `agents.description` 字段；由 Coach 演化（§D-6 Evolution Loop）|
| 项目知识（team_rules）| `projects.team_rules` + `decisions` / `lessons` 表（D-20）|
| 项目级 Agent 约束 | CLI 原生的 `<workspace>/AGENTS.md` / `CLAUDE.md` / `.cursor/rules/`（OpenSpace 不插手）|

### Agent Profile Tab 简化

原 3 Tab（PROFILE / WORKSPACE / ACTIVITY）改为 **2 Tab（PROFILE / ACTIVITY）**；FEEDBACK Tab 在 Sprint 5 上线作为第 3 个 Tab。

### 迁移操作

v0 → v1.0 升级时直接删除 `~/.openspace/openspace.db` 和 `~/.openspace/agents/`（见 `product-brief.md §11` 迁移策略）。

---

## D-9: Seed 数据（v1.0 修订）

### 决策

首次启动（`openspace.db` 不存在时）**不预置任何 Project / Channel / Agent**。

```
projects:        (空)
channels:        (空)
agents:          (空)
channel_agents:  (空)
messages:        (空)
tasks:           (空)
```

### 首次体验

- 前端检测 `/api/projects` 返回空 → 显示 **Welcome 页**
- Welcome 页引导用户点 `[+ New Project]` → Create Project 三步向导
- 第一步填 Name + Goal + Workspace
- 第二步由 Team Architect System Agent 自动推荐团队（D-15 / D-19）
- 用户 Approve 后才创建第一批数据

### 为什么不预置

- v0 预置的 `#general` + 默认 Assistant Agent 是"聊天室"心智的残留
- OpenSpace v1.0 定位是 **Programmable AI Team OS**，Project 是一等公民（D-13），必须由 Goal 驱动创建
- 任何预置都会误导用户理解 OpenSpace 的正确用法

### MVP Runtime 范围

MVP 只实装 Cursor 适配器。Create Agent / Team Architect 的 Runtime 下拉展示 6 个选项：

| Runtime | MVP 状态 |
|---------|---------|
| Cursor CLI | ✅ 可选，需本地安装 `cursor-agent` |
| Codex CLI | ❌ 标 "coming soon" 且 disabled |
| Claude Code | ❌ 标 "coming soon" 且 disabled |
| Kimi CLI | ❌ 标 "coming soon" 且 disabled |
| Copilot CLI | ❌ 标 "coming soon" 且 disabled |
| Gemini CLI | ❌ 标 "coming soon" 且 disabled |

### 如果本地没有 Cursor CLI？

- Welcome 页允许继续 Create Project（不阻断）
- Step 2 Team Architect 走兜底三件套（D-19）
- 黄色警告条提示安装 `cursor-agent` 后再配 Agent runtime

---

## D-10: 启动方式

### MVP 阶段

- 开发模式：`pnpm dev`（并发启动 web + server）
- 监听地址：`http://localhost:4178`（web） + `ws://localhost:4179`（server WebSocket）+ `http://localhost:4179`（server REST）
- 端口冲突自动降级到下一个可用端口

### 后续（Phase 4+）

- 打包为 Electron / Tauri 应用
- 单一可执行文件启动
- 系统托盘常驻

### 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `OPENSPACE_HOME` | `~/.openspace` | 数据目录 |
| `OPENSPACE_PORT_WEB` | `4178` | 前端端口 |
| `OPENSPACE_PORT_SERVER` | `4179` | 后端端口 |
| `OPENSPACE_LOG_LEVEL` | `info` | 日志级别 |
| `OPENSPACE_CLI_TIMEOUT_MS` | `300000` | 覆盖默认 CLI 超时 |

---

## D-11: Error / Loading / Empty 状态 UI 规范

### Error 状态

| 场景 | UI 表现 |
|------|---------|
| CLI spawn 失败 | 频道内产生 system 消息，红色文字："⚠ @Agent failed to start: {error_message}" |
| CLI 超时 | 频道内 system 消息："⏱ @Agent timed out after 5min" + Agent 状态点变红 |
| CLI parse error | 频道内 system 消息："🐛 @Agent output could not be parsed" |
| 网络断开（WS 掉线） | 全局 banner："⚠ Connection lost. Retrying..." |
| SQLite 写入失败 | Toast 通知："Failed to save message. Check disk space." |

### Loading 状态

| 场景 | UI 表现 |
|------|---------|
| Agent 正在 thinking（未出字） | 消息占位卡片 + 三点加载动画 "..."；Agent 状态点变橙色 |
| Agent 正在 working（tool_call） | 消息卡片显示当前工具 "🔧 Running: ls -la" |
| 初次加载频道历史 | 骨架屏（4-5 条消息占位） |
| 发送消息 | Send 按钮禁用 + 加载图标 |

### Empty 状态

| 场景 | UI 表现 |
|------|---------|
| 从未选择频道 | 欢迎页："Welcome to OpenSpace" + 使用指引 |
| 空频道（无消息） | "No messages yet. Start a conversation." |
| 空 Tasks | "No tasks in this channel. Click + New Task to create one." |
| 空 Threads 全局页 | "No threads yet." |
| 未安装任何 CLI | 引导安装："Install Codex / Claude Code / Cursor CLI to get started." |

---

## 待执行阶段决策（非阻塞）

以下决策等到具体 Phase 时再定：

### O-1: 前端组件库选型（v0 MVP 已落地 Tailwind + Radix）

**推荐**：Tailwind + Radix UI Primitives（无样式 accessibility 原语，样式全自写）

理由：slock.ai 的 Neo-Brutalism 风格（2px 黑边 + 硬阴影 + 零渐变 + 粉黄强色）与 shadcn/ui 默认风格冲突严重，深度定制 shadcn 的成本 ≥ 自写；但完全裸写需要自行处理 a11y（Focus trap、Dialog、Menu 等）。Radix 是最佳中间方案。

### O-2: UI 对比验收方式（v0 MVP 已采用并排截图方案）

**推荐**：**组件清单逐项核验** + **关键页面并排截图**

理由：Playwright 视觉回归太重；纯人工太主观。折中：每个组件在 PR 描述中附上 before/after 截图，对照参考截图做肉眼检查。关键 3-5 个页面（Channel Main / DM / Profile / Create Dialog / Thread）做并排对比。

### O-3: CLI 适配器具体字段映射（Phase 0 完成后）

待 Phase 0 跑完后根据实际 JSON 输出更新 `docs/cli-event-format.md`。

### O-4: Electron/Tauri 打包选型（Sprint 8+ 远期）

不在 v1.0 MVP（Sprint 1~7）范围，列入 `product-brief §7 R-23`。

---

## D-12: Cursor CLI 流式策略（v0 MVP 已落地）

### 决策

Cursor CLI **不启用** `--stream-partial-output`，即 `CursorAdapter.capabilities.supportsTextDelta = false`。

### 为什么

Cursor 的 `--stream-partial-output` 会产生两阶段输出：
1. 多条 `assistant` chunk（模型实时 draft，片段化）
2. 最后 1 条 `assistant` 完整 replay（**经 Composer 重新整理过**，与前面累加的 chunks 内容不完全相同）
3. `result` 事件（`result.result` = 最终版 = 最后那条 assistant）

这导致前端会看到"流式显示了一段 draft → 突然被覆盖为整理后的最终版"的跳动，UX 不好。

关闭后的实际表现：
- `thinking.delta` 事件仍然流式（用户看到"思考过程"实时更新）
- `assistant` 事件一次性给出完整文本，emit 为 `text.completed`
- 前端在 thinking 阶段显示灰色思考动画，切换到 final answer 时一次性展示

### 权衡

- **TTFB**：5-15s（见 Phase 0 基线），但 thinking 阶段 4.5s 就开始流式反馈
- **未来优化方向**：Runner 层加"伪流式"切片 emit（固定间隔把 text.completed 分段 emit 为 text.delta），可获得打字机效果而不引入 replay 风险

---

## v1.0 新增决策（D-13 ~ D-20）

这一组决策对应 product-brief v1.0.1 的 6 层架构 / 4 Loop / 6 System Agents。**每条都是锚点**，详细产品语义以 `product-brief.md` 为准；此处只承载"实现层约束"。

---

## D-13: Project 是一等公民

对齐：`product-brief.md §D-2 Server = Project`

### Schema

```sql
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,        -- URL slug (lowercase, dash/underscore only)
  display_name    TEXT,
  workspace_path  TEXT NOT NULL,               -- 必填！绝对路径
  goal            TEXT NOT NULL,               -- 必填！详见 D-14
  team_rules      TEXT,                        -- 可选团队协作规则
  color           TEXT,
  created_at      INTEGER NOT NULL
);

ALTER TABLE channels ADD COLUMN project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE agents   ADD COLUMN project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE;
```

### URL 结构

```
/p/{projectName}/channel/{channelId}
/p/{projectName}/dm/{dmId}
/p/{projectName}/tasks
/p/{projectName}/intelligence       (Sprint 4 新增)
```

### 全局跨 Project 视图

暂不做（见 `product-brief §7 R-19`，Sprint 8+）。

---

## D-14: Goal 字段

对齐：`product-brief.md §D-3 Goal 是一等公民`

### 约束

- **必填**：Create Project 无 Goal 则拒绝
- **长度上限 500 字符**（Q-3 决议）：UI 显示字符计数，超出截断并提示
- **注入位置**：ContextBuilder 将 Goal 放在 prompt 最顶部（高于 description 和 team_rules）

### prompt 注入样例

```
[Project Goal]
<project.goal>

[Team Rules]
<project.team_rules>

[Your Role]
<agent.description>

...
```

---

## D-15: System Agents 架构

对齐：`product-brief.md §6 System Agents`

### 6 个内置 System Agent

| Agent | Sprint | 职责 | 实现 |
|-------|--------|------|------|
| **Team Architect** | Sprint 1 | Goal → 推导 Team | 复用 CursorAdapter + 特殊 description（OpenSpace 内置，不暴露）|
| **Scribe** | Sprint 4 | 沉淀 decisions / lessons | 同上 |
| **Evaluator** | Sprint 5 | 定期评估 Agent 产出 | 后台 cron 触发 |
| **Coach** | Sprint 5 | 提 description 修改建议 | 依赖 Evaluator 输出 |
| **Onboarder** | Sprint 6 | 分析 codebase 生成 onboarding 包 | Project 创建时触发 |
| **Facilitator** | Sprint 7 | 主持 Workflow Design Session | 多轮对话，产出 YAML |

### 共享约束

- **Runtime**：Q-1 决议，全部用 Cursor Agent（复用 CLIAdapter 架构）
- **不出现在 Sidebar**：用户看不到它们作为"成员"，避免 @mention 触发
- **权限**：可写 System-owned 表（decisions / lessons / agent_feedback / project_onboarding），不可改用户的 agents / channels / messages 直接内容
- **token 配额**：Q-5 待决议（Sprint 4 启动前拍板），建议独立配额

---

## D-16: Workflow 声明式 YAML

对齐：`product-brief.md §D-4 Workflow 即甬道`

### Schema

```sql
CREATE TABLE workflows (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  trigger_command TEXT UNIQUE,               -- 如 "/new-feature"
  definition_yaml TEXT NOT NULL,             -- YAML 源码
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE workflow_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id),
  channel_id      TEXT NOT NULL REFERENCES channels(id),
  thread_id       TEXT,
  status          TEXT NOT NULL CHECK(status IN ('running','completed','aborted','failed')),
  current_step    TEXT,
  started_by      TEXT,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  state_json      TEXT
);
```

### YAML 字段约定

```yaml
name: feature-development
trigger:
  command: "/new-feature"
steps:
  - id: <string>
    owner: "@AgentName" | "local-user"
    action: "approve_or_reject" | omitted (执行步骤)
    on_complete: <next step id>
    on_approve: <next step id>
    on_reject: <next step id>
    input: <prev step id>             # 可选
    output: <string tag>              # 可选
```

- `origin` 字段**不保留**（N-14）——所有 Workflow 一视同仁
- Workflow YAML 版本控制（Q-4 待决议）建议靠 Export，不入 SQL

---

## D-17: Responsibilities = Step × Agent

对齐：`product-brief.md §D-5 Responsibility 即 Step × Agent`

### Schema

```sql
CREATE TABLE responsibilities (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id       TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_id           TEXT NOT NULL,
  agent_id          TEXT REFERENCES agents(id),     -- 可为 'local-user'
  role              TEXT NOT NULL CHECK(role IN ('executor','approver','reviewer','informed')),
  authority         TEXT CHECK(authority IN ('must_approve','optional_approve','no_authority')),
  created_at        INTEGER NOT NULL
);
```

### RACI 语义

- `executor` = R（责任人）
- `approver` = A（可一票否决）
- `reviewer` = C（可评论，不阻塞）
- `informed` = I（仅通知）

### 自动推导 vs 手动编辑

- Sprint 2 起：从 Workflow YAML 自动推导（`owner` → `executor`）
- Sprint 3 起：支持 UI 手动编辑 override
- Sprint 3 起：`'local-user'` 成为合法 agent_id，作为系统一等 "Agent"

---

## D-18: 多 Project 并发隔离六层契约

对齐：`product-brief.md §D-7 六层隔离模型`

### 层次表

| 层级 | 隔离 | 机制 |
|------|------|------|
| 进程层 | 完全 | spawn-per-message（每次独立 PID） |
| Channel 级（对话历史） | 完全 | `WHERE channel_id = ?` |
| Project 级（workspace / Tasks / Knowledge） | 完全 | 按 `channel.project_id` 路由 |
| Agent 身份（description） | 共享 | 设计如此，Agent 是"一个人"|
| CLI 原生记忆（AGENTS.md）| 项目级 | CLI 自管，按 cwd 查找 |
| 运行时副作用 | 部分隔离 | 见必须修正的坑（K-N）|

### 必须修正的坑（product-brief §D-7）

| # | 问题 | 对应 D-N |
|---|------|---------|
| K-1 | `agents.status` 单值冲突 | D-1 修订（per-channel 派生）|
| K-2 | 链式触发计数维度 | D-6 修订（per-thread）|
| K-3 | `agent_activity` 无 `channel_id` | D-3 修订 |
| K-4 | env_vars 只在 Agent 级 | 待 Sprint 2 新增 `project_agent_overrides` 表 |
| K-5 | `~/.openspace/agents/{id}/` 共享 cwd | D-8 v1.0 修订（废除沙盒）|
| K-6 | 并发池全局共享 | D-5 现状接受，Sprint 8+ 可加 per-Project 配额 |

---

## D-19: Team Architect 兜底三件套

对齐：`product-brief.md §D-3 兜底策略（Q-2 / Review 5）`

### 触发条件（任一）

- 未安装 `cursor-agent`（`cursor-agent --version` 失败）
- Team Architect spawn 超时（独立 30s 超时，不受 `PROCESS_TIMEOUT_MS` 300s 影响）
- 返回 JSON 解析失败

### 固定兜底内容

```typescript
const FALLBACK_TEAM: TeamSuggestion = {
  agents: [
    { name: 'Architect', role: 'Architect', description: '...', runtime: '', model: '', reasoning: 'medium' },
    { name: 'Dev',       role: 'Developer', description: '...', runtime: '', model: '', reasoning: 'medium' },
    { name: 'Reviewer',  role: 'Reviewer',  description: '...', runtime: '', model: '', reasoning: 'medium' },
  ],
  rationale: 'Default team (Team Architect unavailable). Please configure runtime/model for each agent before use.',
};
```

### UI 表现

- Create Project Step 2 仍展示三张 Agent 卡片
- 顶部黄色警告条：`"Team Suggestion unavailable, showing default team. Please configure runtime per agent after approval."`
- 安装引导链接：`Install cursor-agent` 指向 Cursor 官网 / IDE 内的 "Install CLI" 菜单
- 用户 Approve 后进入 Agent Profile 必须手动选 runtime（字段为空不可 spawn）

---

## D-20: 四个运营闭环（锚点）

对齐：`product-brief.md §5.3 四个运营闭环`

### 四个 Loop 速查

| Loop | 触发 | 产出 | Sprint 落地 |
|------|------|------|-----------|
| Onboarding | Create Project | `project_onboarding` | Sprint 6 |
| Delivery | Workflow Run 结束 | `decisions` / `lessons` | Sprint 4 |
| Evolution | 周期性（每 24h） | `agent_feedback` | Sprint 5 |
| Reuse | Agent spawn 前 | ContextBuilder 注入 | Sprint 4（与 Scribe 同步）|

### 关键表（Sprint 4~6 陆续落地，此处只列字段锚点）

```sql
-- Sprint 4
CREATE TABLE decisions (...);
CREATE TABLE lessons (
  id, project_id, kind, title, body, audience, tags_json,
  source_message_id, recorded_by, confidence, review_status, use_count, ...
);

-- Sprint 5
CREATE TABLE agent_feedback (
  id, agent_id, period_start, period_end,
  observations, suggested_description, diff_summary,
  applied, applied_at, approved_by, ...
);

-- Sprint 6
CREATE TABLE project_onboarding (
  project_id PRIMARY KEY, overview, tech_stack_json, conventions, ...
);
CREATE TABLE agent_skills (
  agent_id, project_id, skill_key, touch_count, last_touched, ...
);
```

详细字段与行为约束见 `product-brief §11 Schema 总清单` 和各 Sprint 启动前拍板的 Q-N。

---

## D-21: Per-Project Storage 架构

对齐：`docs/per-project-storage-design.md` v0.3（Q-10 ~ Q-14 决议）

### 决策

项目级数据从**中央 `~/.openspace/openspace.db`** 迁移到 **每个 workspace 的 `<path>/.openspace/`** 目录：

```
<workspace>/
└── .openspace/
    ├── project.json        ← 元数据（id / name / display_name / goal / team_rules / color / created_at）
    ├── openspace.db            ← 该 project 的全部业务数据（channels / agents / messages / tasks / workflows / decisions / lessons / observations / feedback / onboarding / skills / sessions）
    ├── openspace.db-wal
    ├── openspace.db-shm
    ├── knowledge/
    │   ├── decisions.jsonl  ← 仅 review_status='approved' 同步到 jsonl（Q-13），便于入 git
    │   └── lessons.jsonl
    ├── observations/        ← reserved；evaluator 过程数据，默认 ignore
    ├── .gitignore           ← 默认配置 openspace.db* / observations/ 不入 git
    └── README.md            ← 自动生成的目录说明
```

中央 `~/.openspace/projects.json` 仅维护 recent list（id / path / lastOpened），**不存任何业务数据**。

### 配套机制

- **DB Handle Pool**（`db/index.ts`）：LRU max=20，30min idle close；`openProjectDb(workspacePath)` 懒加载。
- **资源反查**：`findDbByResource('channels'|'agents'|...)` 跨 open db 反查，避免改 URL 形态。
- **Warm-up**：server 启动期 openProjectDb 全部 recent project，让 `/api/threads`、`/api/saved` 等全局视图能聚合。
- **全局事件**（D-21 + WS）：`hub.broadcastGlobal({ type: 'project_list_changed' | 'knowledge_updated' })` 推送到所有 socket，前端 sidebar / inbox 自动 refresh。

### 兼容策略

**开发阶段不向前兼容**（Q-12）：旧 `~/.openspace/openspace.db` 启动期检测到时仅 warn，不迁移；用户手动 `mv` 即可释放磁盘。

---

## D-22: 多项目隔离的物理边界

对齐：`product-brief.md §D-7 多项目隔离六层契约` + D-21

### 决策

D-21 把项目隔离从**逻辑层（WHERE project_id = ?）** 升级到 **物理层（独立 SQLite 文件）**：

| 隔离维度 | v1.0（中央 db）| v1.1+（per-project db）|
|---------|---------------|---------------------|
| Channel ID 命名空间 | 全局唯一（nanoid） | per-db 唯一即可 |
| Agent name 命名空间 | per-project unique（应用层校验） | per-db 唯一（schema 层 UNIQUE）|
| 数据库文件 | 1 份共享 | N 份独立 |
| 备份/恢复粒度 | 整个 OpenSpace | 单个 project（拷贝目录即可） |
| 并发写入 | 单 db lock 串行化 | 各 project 独立 lock |
| 删除项目副作用 | DELETE CASCADE 大量行 | rm -rf .openspace/，无副作用 |

**资源反查约束**：因为 channel_id / agent_id 不再全局唯一，server 启动期必须 warm-up 所有 recent project；运行时未 warm-up 的资源（LRU 淘汰后未访问）通过下次访问 lazy 重新打开恢复。

---

## D-23: 团队共享 / git 入仓建议

对齐：`product-brief.md §D-3 协作场景`

### 决策

`<workspace>/.openspace/` 自动写入 `.gitignore` + `README.md`，明确推荐入仓边界：

| 文件 | git 策略 | 理由 |
|------|---------|------|
| `project.json` | **commit** | 团队对项目元数据（goal / team_rules）的共识 |
| `knowledge/*.jsonl` | **commit** | reviewed 决策 + 经验，跟代码 review 一起走 |
| `openspace.db*` | **ignore** | 个人对话历史；冲突合并不可行 |
| `observations/` | **ignore** | 实时 evaluator 噪声 |
| `README.md` | optional | 不强制；用户可自由扩展 |

### Knowledge JSONL 同步策略（v0 简化）

仅在 `review_status='approved'` 状态变化时整体重写 `decisions.jsonl` / `lessons.jsonl`（非增量 append）。代价是每次 approve 重写 100 行级别的小文件，IO 可忽略。**不双向同步**：用户手动改 jsonl 不会回写 db（Q-14）。

---

## D-24: per-project schema 简化

对齐：D-21 / D-22

### 决策

- **删除** `projects` 表（元数据迁移到 `project.json`）
- 所有 v1.0 的 `project_id` 列、FK、相关 INDEX 全部移除
- `agents.name UNIQUE` 自然变成 per-project 唯一（无需应用层校验）
- `workflows.trigger_command UNIQUE` 自然变成 per-project 唯一
- `project_onboarding` 改为 singleton（`id INTEGER PRIMARY KEY CHECK (id = 1)`）
- `agent_skills.UNIQUE(agent_id, skill_key)` 替换原 `UNIQUE(agent_id, project_id, skill_key)`

返回给前端的 `Project` / `Channel` / `Agent` 等 DTO 仍含 `project_id` 字段，由 server 端从 db handle 反查注入，前端不感知存储变化。

---

## D-25: Project Lifecycle — Open / Close / Delete 三态

对齐：Q-11 决议（`docs/per-project-storage-design.md`）

### 决策

| 操作 | 触发 | 副作用 | UI 入口 |
|------|------|--------|---------|
| **Open** | 用户选 workspace 路径 | 检测 `<path>/.openspace/`：存在则 reopen（读 project.json + open db），不存在则新建（写 project.json + 初始 db + .gitignore + README.md + #general channel） | Sidebar 顶部 "📂 Open project folder" / WelcomePage / OpenProjectDialog |
| **Close** | 用户从 Sidebar / Settings 选 Close | 仅从 `~/.openspace/projects.json` 移除 + 关闭 db handle；**保留磁盘文件** | Sidebar Switcher ⋯ → Close / Settings Danger Zone "Close project" |
| **Delete .openspace/** | 用户从 Settings 选 Delete + 输入项目名 slug 校验 | server 端 `confirm_name === project.name` 校验通过后 `rm -rf <path>/.openspace/` + 从 recent 移除；代码仓库本身不动；不可撤销 | Settings Danger Zone "Delete .openspace/ folder"（独立模态 + 文本输入校验）|

### API 形态

```
POST /api/projects/open                  → { project, is_new }
POST /api/projects/:id/close             → 204
POST /api/projects/:id/delete-storage    → body: { confirm_name }，匹配才执行；否则 400
```

旧 `POST /api/projects` 已废除；旧 `DELETE /api/projects/:id` 由 close + delete-storage 双按钮替代。

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v0 | ~2026-04-22 | 初版 D-1 ~ D-12 + O-1 ~ O-4，支撑 v0 MVP |
| v1.0.1 | 2026-04-23 | 对齐 `product-brief.md v1.0.1`：修订 D-1 (状态 per-channel)、D-3 (activity 加 channel_id)、D-6 (链式 per-thread)、D-8 (workspace 废除)、D-9 (seed 不预置)；新增 D-13 ~ D-20 (Project / Goal / System Agents / Workflow / Responsibilities / 隔离契约 / 兜底三件套 / 4 Loop) |
| **v1.1** | 2026-04-30 | **文档体系简化**：从本文档移出实施进度；D-1 / D-8 加"⚠ 当前过渡状态"标注（指向 TD-N） |
| **v1.2** | 2026-05-08 | **Per-Project Storage 重构落地**：新增 D-21 ~ D-25（开发阶段不向前兼容；rm 旧 db 即可）|
