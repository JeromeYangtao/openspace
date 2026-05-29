# Cursor SDK Adapter 调研与引入清单

> **调研对象**：[cursor/cookbook](https://github.com/cursor/cookbook) + [`@cursor/sdk` TypeScript SDK](https://cursor.com/docs/api/sdk/typescript)（public beta）
> **调研日期**：2026-04-30
> **调研目的**：评估官方 Cursor SDK 能否替代 / 增强 OpenSpace 当前的 `cursor-agent` CLI 子进程方案，识别可引入条目
> **文档层级**：附加分析（非战略 / 非决策）
>
> **编号规则**：
> - `S-N` = SDK adoption item（可引入条目），避免与已有 `D-N` / `B-N` / `K-N` / `R-N` 冲突
> - 引用 OpenSpace 现有决策统一写 `D-1` / `K-5` / `R-23` 等
>
> **何时读**：
> - 决策是否在某个 Sprint 引入 SDK 时
> - `cursor-agent` 子进程出问题（兜底失败 / 解析报错）需要替代方案时
> - 远期评估 cloud runtime 解锁 OpenSpace 哪些路线时（`R-23` / `B-1`）

> **落地状态摘要（2026-04-30 更新）**：
>
> | 条目 | 状态 | 落地 commit / 说明 |
> |------|------|--------------------|
> | `S-1` CursorSdkAdapter 旁路 | ✅ 已落地（Sprint 4-ext） | `packages/server/src/agents/cursor-sdk-adapter.ts` + `adapter-factory.ts`，环境变量 `OPENSPACE_CURSOR_BACKEND=sdk\|cli` 切换 |
> | `S-2` SDK 标准 tool_call schema | ✅ 已落地（Sprint 4-ext） | `CursorSdkAdapter.mapSdkMessage()` 直接映射 `SDKToolUseMessage`；`CursorAdapter` 保留旧解析以兼容 cursor-agent 子进程 |
> | `S-3` summarizeToolArgs Activity 摘要 | ✅ 已落地（Sprint 4-ext） | `packages/server/src/agents/summarize-tool-args.ts` + `activity-recorder.ts` |
> | `S-4` Subagents 重构 System Agent | ⏸️ 暂缓 | 等 SDK GA + 与 D-1 per-channel 隔离 spike 后再评估 |
> | `S-5` agent-kanban grouping | 📐 仅设计参考 | Sprint 8+ R-19 落地时再迁移 |
> | `S-6` Project name 自动生成 | ⏸️ 暂缓 | 纳入 R-25 Project UX 打磨 |
> | `S-7` Cloud runtime opt-in | 🔒 远期 | Sprint 8+，必须 per-Project opt-in（合规约束）|
> | `S-8` Agent.resume 长任务 | 🔒 远期 | 依赖 `S-7` |
> | `S-9` Hooks 协同 ApprovalCard | 🔒 远期 | Sprint 8+ |

---

## 1. 一句话结论

> **Cursor SDK 是 OpenSpace 当前 `CursorAdapter` 的官方版超集** —— 同样的 spawn-per-message 心智，但是 TypeScript API（不再 `child_process.spawn cursor-agent`）+ 多 cloud runtime / Subagents / Resume / Artifacts / Hooks。
>
> OpenSpace 的 `CLIAdapter` 抽象（`packages/server/src/agents/types.ts`）当初就是为多 runtime 设计的，**SDK 是天然的下一个 adapter，不需要重写任何上层逻辑**。

---

## 2. cookbook 包含什么

仓库结构非常薄，4 个示例都围绕 `@cursor/sdk` 这个新包：

```
cursor/cookbook/
└── sdk/
    ├── quickstart/          # ~25 行，最简流式
    ├── coding-agent-cli/    # ⭐⭐⭐ 完整 CLI 包装：local/cloud + cancel + 模型选择 + TUI
    ├── agent-kanban/        # ⭐⭐ Linear 风看板：list/create/group cloud agents + artifacts
    └── app-builder/         # ⭐ 在线 Vite 脚手架：local agent + iframe live preview
```

**对 OpenSpace 价值最高的是 `coding-agent-cli`**：它的 `CodingAgentSession` 类（[`sdk/coding-agent-cli/src/agent.ts`](https://github.com/cursor/cookbook/blob/main/sdk/coding-agent-cli/src/agent.ts)）几乎是一份完整的 OpenSpace `CursorAdapter` 重写参考——包含 local/cloud 切换、cancel、模型管理、`replaceAgent` 优雅重建、`emitSdkMessage` 事件映射、`summarizeToolArgs` 工具参数摘要。

---

## 3. 维度对比表：OpenSpace CLI Bridge vs `@cursor/sdk`

| 维度 | OpenSpace 当前（`CursorAdapter` + `cursor-agent` 子进程） | `@cursor/sdk` | 谁更强 |
|------|------|------|------|
| 调用方式 | `child_process.spawn` + NDJSON 解析 | TypeScript `Agent.create` + `run.stream()` | **SDK** |
| Local runtime | ✅ | ✅（`local: { cwd }`，等价语义） | 平 |
| Cloud runtime | ❌ | ✅（VM 隔离 + `autoCreatePR` + `Agent.resume`） | **SDK** |
| 启动延迟 | ~4.5s（cursor-agent 子进程冷启动的历史测量值） | SDK 内部直接走 API（无 spawn 开销） | **SDK** |
| 流式事件 | 自定义 `CLIEvent`（`packages/shared/src/types.ts`） | 标准 `SDKMessage` + 细粒度 `InteractionUpdate` | **SDK**（schema 稳定） |
| Tool call 解析 | 手动拆 `xxxToolCall`（脆弱，依赖 Cursor 内部 schema） | 统一 `SDKToolUseMessage` + `truncated` 标记 | **SDK** |
| Cancel 取消 | 自实现 `process.kill` + `AbortSignal`（`/abort` 已落地，见 Sprint 3 CP3） | `run.cancel()`（local/cloud 通用） | **SDK**（覆盖更全） |
| Token usage | 从 `result.usage` 字段手动推（`cursor-adapter.ts` lines 173-186） | `turn-ended.usage` 标准化（含 cache read/write） | **SDK** |
| Subagents（多角色）| OpenSpace 自建（多 Agent 实体 + 多 CLIRunner 实例） | **原生** `agents: { 'reviewer': {...} }` 由主 agent 调度 | **SDK**（语义贴合 D-15）|
| 持久化 / Resume | spawn-per-message，进程结束即结束 | `Agent.resume(agentId)` 跨重启续 | **SDK** |
| 长任务保活 | 用户关 OpenSpace 即丢 | cloud agent survive disconnection | **SDK** |
| Artifacts | 无 | `listArtifacts` / `downloadArtifact`（cloud） | **SDK** |
| Hooks 拦截 | 无 | `.cursor/hooks.json` 文件级 | **SDK** |
| MCP servers | `D-13` 明确**不用** | 内建支持（**与 OpenSpace 决策冲突**） | 看场景 |
| 模型列表 | `cursor-agent --list-models` 文本解析 | `Cursor.models.list()` 结构化（含 parameters / variants） | **SDK** |
| 用户身份 | 无 | `Cursor.me()` 拿用户名 / 邮箱 | **SDK** |
| 数据本地化（`S-5`） | ✅（数据本地，API 调用 Cursor 后端） | local 模式 ✅ / cloud 模式 ❌（代码上云端 VM） | local 模式平；cloud 模式违反 |
| 心智模型 | "本地 CLI + 流式解析" | "API + 标准化对象" | SDK 更现代但 OpenSpace 现状已稳 |

**关键洞察**：SDK local 模式与 OpenSpace 当前 cursor-agent 子进程方案**等价于同一件事的两个 API 表面**——后端都走 Cursor 服务，差别在于一个 spawn 子进程拼参数 + 解析 NDJSON，一个直接调 TypeScript API。所以 local 模式不增加新的合规风险（仍符合 `S-5` "CLI 工具本身的 API 调用除外"）。

---

## 4. 可引入条目清单（S-N）

### 🔴 短期 / 立即可做（Sprint 4 顺手 1~2 天）

#### S-1：新增 `CursorSdkAdapter` 作为旁路 adapter（不替换 `CursorAdapter`）

**做什么**：实现 OpenSpace 现有 `CLIAdapter` 接口（`packages/server/src/agents/types.ts`），把 `Agent.create + run.stream` 包装成 `parseLine` / `buildCommand` 的等价语义；环境变量 `OPENSPACE_CURSOR_BACKEND=sdk|cli`（默认 `cli`）切换；并存测试 1~2 个 Sprint。

**直接收益**：
1. **解决 `D-19` 兜底痛点**：用户没装 `cursor-agent` 但有 `CURSOR_API_KEY` 时，自动走 SDK，不再走"默认三件套 + 黄色警告条"——把"勉强可用"升级为"正常可用"。
2. **启动延迟降低**：去掉 cursor-agent 子进程冷启动开销（历史 spike 测得 ~4.5s）。
3. **`run.cancel()` 替代 `process.kill`**：覆盖 cloud / 已挂起的进程等边界，比当前 `/abort` 实现（Sprint 3 CP3）更可靠。
4. **标准化 token usage**：`turn-ended.usage` 直接给 `inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens`——Sprint 4 Scribe 沉淀和 Sprint 5 Coach 都需要这个数据。

**参考实现**：[`coding-agent-cli/src/agent.ts`](https://github.com/cursor/cookbook/blob/main/sdk/coding-agent-cli/src/agent.ts) 的 `CodingAgentSession` 类——local/cloud 切换 + cancel + replaceAgent + emitSdkMessage 全套，改造成 `CLIAdapter` 即可。

**关键代码骨架（示意）**：

```typescript
// packages/server/src/agents/cursor-sdk-adapter.ts
import { Agent, type SDKMessage } from '@cursor/sdk';
import type { CLIAdapter, CLIEvent, BuildCommandParams } from './types.js';

export class CursorSdkAdapter implements CLIAdapter {
  readonly name = 'cursor-sdk';
  readonly capabilities = {
    supportsTextDelta: false,
    supportsThinking: true,
    supportsWorkingDirectory: true,
    supportsEnvVars: true,
    supportsModelSelection: true,
    supportsReasoningEffort: true,
    supportsStdinContext: true,
  };

  async checkInstallation() {
    return process.env.CURSOR_API_KEY
      ? { installed: true, version: 'sdk' }
      : { installed: false, error: 'CURSOR_API_KEY not set' };
  }

  async runWithSdk(params: BuildCommandParams, onEvent: (e: CLIEvent) => void) {
    await using agent = await Agent.create({
      apiKey: process.env.CURSOR_API_KEY!,
      model: { id: params.model ?? 'composer-2' },
      local: { cwd: params.workingDirectory! },
    });
    const run = await agent.send(params.prompt);
    for await (const event of run.stream()) {
      this.mapSdkMessage(event, onEvent);
    }
    const result = await run.wait();
    onEvent({ type: 'session.completed', duration_ms: result.durationMs, usage: result.usage });
  }

  private mapSdkMessage(event: SDKMessage, emit: (e: CLIEvent) => void) {
    // 见 coding-agent-cli/src/agent.ts emitSdkMessage()
  }
}
```

**注意点**：
- SDK 是 stream 而非 NDJSON，所以 `parseLine` 在 SDK adapter 里不再适用。可以考虑把 `CLIAdapter` 接口拆成 "spawn 派"（`buildCommand` + `parseLine`）和 "API 派"（`run` 一个方法），或者在 `Runner` 层判断 adapter 类型走不同路径。**前者更彻底，后者更兼容**。建议先走后者，等 SDK 稳定再考虑接口重构。
- `await using` 需要 TypeScript 5.2+ / Node 20+，OpenSpace 已用 Node ≥ 20，可以放心。

**对应已有约束**：
- `D-9`（兜底三件套）：SDK 可作为 `cursor-agent` 不在时的真正 fallback，而不是仅展示警告
- `D-12`（Cursor 流式策略）：SDK 已经处理好了 stream-partial 的 replay 跳动问题，可重新评估是否启用 `text.delta`

#### S-2：替换 `parseLine` 里脆弱的 Cursor 工具拆包逻辑

**做什么**：当前 `cursor-adapter.ts` lines 127-166 有一段假设 Cursor 内部 schema（`xxxToolCall` 后缀）的拆包代码：

```typescript
case 'tool_call': {
  const tc = o.tool_call as Record<string, Record<string, unknown>> | undefined;
  if (!tc) return [];
  const toolKey = Object.keys(tc).find((k) => k.endsWith('ToolCall'));
  const toolData = toolKey ? tc[toolKey] : {};
  const toolName = toolKey ? toolKey.replace('ToolCall', '').toLowerCase() : 'unknown';
  // ...
}
```

这段代码依赖未公开的 Cursor 内部 schema，Cursor 升级时随时可能 break。SDK 直接给标准化的 `SDKToolUseMessage`：

```typescript
interface SDKToolUseMessage {
  type: 'tool_call';
  call_id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  args?: unknown;
  result?: unknown;
  truncated?: { args?: boolean; result?: boolean };
}
```

**收益**：
- `truncated` 字段帮 OpenSpace 判断 args/result 是否被 SDK 主动截断（当前 OpenSpace 没有这个信号，UI 上无法区分"工具没产出"和"产出太大被吃掉"）。
- 不用关心 Cursor 内部 schema 变化。

**落地路径**：与 `S-1` 一并完成（CursorSdkAdapter 直接用新 schema；CursorAdapter 保持现状以兼容未升级的 cursor-agent）。

#### S-3：借鉴 `summarizeToolArgs` 给 `D-3` Activity Tab 加工具摘要

**做什么**：cookbook 的 [`summarizeToolArgs`](https://github.com/cursor/cookbook/blob/main/sdk/coding-agent-cli/src/agent.ts) + `getToolSummaryKeys`（lines 515-602）按工具名（read / glob / grep / shell / edit / write）智能提取关键参数生成摘要：

```typescript
function getToolSummaryKeys(toolName: string) {
  const name = toolName.toLowerCase()
  if (name.includes('read'))  return [['path', 'filePath', 'target_file'], ['offset'], ['limit']]
  if (name.includes('shell')) return [['command', 'cmd'], ['cwd', 'working_directory']]
  if (name.includes('edit'))  return [['path', 'target_file'], ['instruction']]
  // ...
}
```

直接对应 `D-3` 要求的 activity detail 格式：`"Shell: ls -la /path"` / `"Read: ./auth/oauth.ts"`。

**收益**：
- 当前 `packages/server/src/agents/activity-recorder.ts` 应该是手动处理每种工具的 args 字段，新工具加入时容易漏。
- 这套规则覆盖了 Cursor / Codex / Claude 三家的常见工具命名变体（`path` / `filePath` / `target_file` 都接），可以一并复用到 `R-18` 多 runtime 适配。

**落地路径**：直接抽成一个 `summarizeToolArgs.ts` 工具模块，在 `activity-recorder.ts` 写入 `agent_activity.detail` 时调用。**这一步与 SDK 引入解耦，可以单独做**。

---

### 🟡 中期 / Sprint 4~6 评估

#### S-4：用 SDK Subagents 重构 System Agent 实现（Sprint 4~6）

**做什么**：OpenSpace `D-15` 列了 6 个 System Agent（Team Architect / Scribe / Coach / Evaluator / Onboarder / Facilitator），现在的实现思路是"复用 CursorAdapter + 特殊 description"。SDK 有原生 Subagents：

```typescript
const agent = await Agent.create({
  apiKey, model: { id: 'composer-2' },
  local: { cwd: project.workspace_path },
  agents: {
    'architect':   { description: 'Designs architecture', prompt: '...', model: 'inherit' },
    'dev-backend': { description: 'Implements backend',  prompt: '...' },
    'reviewer':    { description: 'Reviews code',       prompt: '...' },
  },
});
```

这等价于 Team Architect 推荐的"Architect / Dev-Backend / Reviewer"三件套（`D-19`）；**Sprint 2 的 Workflow Step 调度**也可以直接映射成"主 Agent 通过 Agent tool 调用 subagent"。

**收益**：
- Workflow Step → SDK subagent 直接映射，省一个 OpenSpace 自实现的"多 CLIRunner 串联"调度层（当前 `WorkflowRunner`）。
- Subagent 的 `description` 就是 OpenSpace `agents.description`；Sprint 5 Coach 演化 description → 直接写回 subagent definition。
- `model: 'inherit'` 让 System Agent 用统一 token 配额（直接缓解 `Q-5`）。

**风险**：
- 这会动 OpenSpace 的"Agent = 顶级实体（`projects` / `agents` 表）"心智，慎重。
- 子 agent 共享父 agent 的 conversation context，可能与 OpenSpace "per-channel 状态隔离"（`D-1` / `D-18`）的语义不完全契合，需要 Sprint 4 启动前做小型 spike 验证。

**建议路径**：
1. **Sprint 4 试点**：Scribe System Agent 用 SDK subagent 实现，验证可行性
2. **Sprint 5**：Coach + Evaluator 跟进
3. **Sprint 7+**：评估是否把 Workflow Step 调度也下放到 SDK Subagents（影响面大，慎重）

**对应已有约束**：
- `D-15`：System Agents 共享约束（共享 runtime / 不出现在 Sidebar / token 配额）
- `Q-5`：System Agent token 配额——SDK subagent inherit 模型可作为参考

#### S-5：agent-kanban 当 OpenSpace 全局视图（`R-19`）的脚手架

**做什么**：[`agent-kanban`](https://github.com/cursor/cookbook/tree/main/sdk/agent-kanban) 是 Linear 风格的 cloud agent 看板，按 status / repository / branch / createdAt 4 维度分组。其 `AgentCard` 类型（[`src/lib/agents/types.ts`](https://github.com/cursor/cookbook/blob/main/sdk/agent-kanban/src/lib/agents/types.ts)）：

```typescript
type AgentCard = {
  id: string; title: string; status: string;
  repository: string; branch?: string;
  createdBy?: string; createdAt?: string; updatedAt?: string;
  prUrl?: string; latestMessage?: string;
  artifacts: ArtifactPreview[];   // image / video / file 三种预览
}
```

几乎是 OpenSpace Task / Thread 卡片字段的超集，直接对应 `R-19` 跨 Project 全局视图。

**可直接搬的设计**：
1. **按 status / repository / branch / createdAt 4 维分组切换**（[`src/lib/agents/server.ts`](https://github.com/cursor/cookbook/blob/main/sdk/agent-kanban/src/lib/agents/server.ts) 的 `enrichAgentCardFromRuns` + 前端 grouping 逻辑）
2. **Artifact 预览三档**（image / video / file）+ 内嵌 `mediaUrl` 通过本地 API 路由代理认证 → 对应 Sprint 4 Intelligence Tab 的"沉淀产物预览"
3. **API key 校验 + 可选记忆 `~/.agent-kanban/settings.json`**（`createSession` / `restoreSession`）→ OpenSpace Welcome 页"配 Cursor 凭证"流的现成参考

**收益**：
- OpenSpace Sprint 8+ `R-19` 跨 Project 视图直接照搬这套 grouping 逻辑，节省设计成本。
- Sprint 4 Intelligence Tab 的 artifact 预览（如果未来要展示 Scribe 沉淀的截图 / 文件）可以直接用这个 mediaUrl 代理模式。

**落地路径**：
- Sprint 4 Intelligence Tab 设计时参考 `AgentCard` 字段集合
- `R-19` 真正动工时把 grouping / preview 逻辑整体迁移过来

#### S-6：app-builder 给 Create Project 流程的两个改进点

**做什么**：[`app-builder`](https://github.com/cursor/cookbook/tree/main/sdk/app-builder) 是一个 Vite live preview 项目脚手架。它的 [`server.ts`](https://github.com/cursor/cookbook/blob/main/sdk/app-builder/src/lib/app-builder/server.ts) 有两个直接可用的功能：

1. **`generateProjectName(apiKey, prompt)`**（lines 291-393）：让 LLM 从 Goal 自动生成 ProjectName。`D-13` 的 `projects.name` 当前必填，可以改为可选 + 自动生成 + 用户可改。注意它已经踩过坑：用 XML tag 约束输出 `<projectName>...</projectName>` / 15s 超时 / fallback 到本地正则提取关键词。
2. **`Cursor.me({ apiKey })`** 校验 API key 后立即拿到用户名 → OpenSpace Welcome 页 "Hi {Name}, let's create your first Project"，比当前匿名体验亲切。

**收益**：
- Create Project 三步向导 step 1 的字段从 3 个（Name + Goal + Workspace）减到 2 个（Goal + Workspace），自动生成的 Name 用户可改。
- Welcome 页有用户名个性化（Slack 类心智更亲切）。

**风险**：
- `generateProjectName` 需要等一次 LLM 调用，可能让 step 1 → step 2 的过渡多 5-15s 等待；实现时建议**异步生成 + 用户填的时候 prefill**，而非阻塞下一步。

**落地路径**：作为 `R-25` "Project UX 打磨" 的子项，Sprint 4 顺手做或推到后续 sprint。

---

### 🟢 远期 / Sprint 8+ 战略级

#### S-7：Cloud runtime 一次性解锁多个远期路线

**做什么**：把 SDK cloud runtime 作为 **opt-in** 选项加入，不改变默认 local 行为。

| OpenSpace 远期项 | SDK cloud 提供的能力 |
|----|----|
| **`B-1`** Worktree 多 Agent 隔离 | cloud agent 自带 VM 隔离（`K-5` 共享 cwd 冲突天然消失）|
| **`R-21`** Workflow / Team Marketplace | cloud agent 跨用户分享 + `autoCreatePR` |
| **`R-23`** Electron / Tauri 打包 | 用户不需要装 `cursor-agent`，下载 OpenSpace + 输入 API key 即用 |
| **`R-19`** 跨 Project 全局视图 | `Agent.list({ runtime: 'cloud', prUrl })` 配合 PR 维度聚合 |

**合规要求**（与 `S-5` 数据本地承诺平衡）：
- 必须做成 **per-Project opt-in**，UI 上明确标注"代码会上传到 Cursor 云端"
- 建议加 `projects.runtime_mode: 'local' | 'cloud'` 字段
- Welcome 页和 Project Settings 都需要明确文案告知差异

**风险**：
- OpenSpace `S-5` 成功标准是"所有数据本地化，用户可以离线使用（CLI 工具本身的 API 调用除外）"。cloud 模式严格违反"代码本地化"，必须是用户显式选择。
- 与 `product-brief.md §8` "非目标用户" 中"需要企业级权限 / 审计的组织"会有交集，需要文档明确边界。

**对应已有约束**：
- `S-5`（成功标准）：local/cloud 二元 opt-in 设计
- `K-5`（多 Project 共享 cwd 冲突）：cloud runtime 直接消除
- `R-23`（Electron 打包）：cloud 模式让"零依赖体验"成立

#### S-8：`Agent.resume(agentId)` 解决长任务恢复

**做什么**：OpenSpace 当前是 `D-12` spawn-per-message，进程结束就没了；用户关 OpenSpace 中途回来，正在跑的 workflow 丢了。SDK cloud agent 设计就是 survive disconnection，配合 `Agent.list({ runtime: 'cloud' })` 可以恢复。

**最契合的场景**：
- Sprint 7 Facilitator 的 "Workflow Design Session"（5~15 分钟收敛），用户可能中途切走
- Sprint 4 Scribe 的回扫长 thread（可能 token 量很大，单次跑很久）
- 多 Agent 并发跑长 workflow（用户可能想关电脑去吃饭）

**前置条件**：依赖 `S-7` cloud runtime；local 模式不支持长任务保活。

**落地路径**：
- Sprint 7 启动前评估 Facilitator 是否需要 resume 能力
- 远期纳入 `R-23` 桌面应用的"任务跨重启续"功能

#### S-9：Hooks 与 Sprint 3 已落地的 Approval Flow 协同

**做什么**：SDK 支持文件级 [`.cursor/hooks.json`](https://cursor.com/docs/hooks)（不能编程注册），可以做"shell 命令在 destructive 操作前请求 approve"——比 OpenSpace 自实现拦截更稳，因为 Cursor 自家 IDE 也用同一份 hooks。

**收益**：
- Sprint 3 已落地的 ApprovalCard / `/approve` `/reject` 流程可以与 hooks 配合：hooks 触发 → SDK 暂停 → OpenSpace Approval Card → 用户决定 → SDK 继续
- 工程师在 Cursor IDE 里设置好的 hooks 在 OpenSpace 自动生效，无需重复配置

**风险**：
- hooks 是文件级，不能动态调整；OpenSpace 的 ApprovalCard 是 thread 内动态触发的，**两者协同的精确语义需要小型 spike 验证**
- 不是所有 hook 类型都暴露给 SDK（具体看 [Cursor Hooks 文档](https://cursor.com/docs/hooks)）

**落地路径**：Sprint 8+ 评估，不阻塞当前路线。

---

## 5. Sprint 映射汇总

按 OpenSpace 现状（Sprint 4 — Delivery Loop）排序，标注每个 `S-N` 的建议落地时机：

| 时机 | 条目 | 价值 | 工期估算 |
|------|------|------|---------|
| **Sprint 4（顺手做）** | `S-1` CursorSdkAdapter 旁路 | 🔴 高（解决 D-19 兜底） | 1~2 天 |
| **Sprint 4（顺手做）** | `S-2` Tool call schema 替换 | 🟡 中（schema 稳定性） | 0.5 天（与 S-1 合并） |
| **Sprint 4（顺手做）** | `S-3` Activity Tab 工具摘要 | 🟡 中（D-3 显示密度） | 0.5 天（与 SDK 引入解耦）|
| **Sprint 4（试点）** | `S-4` Subagents 重构 Scribe | 🟡 中（Q-5 token 配额）| 2~3 天（需 spike）|
| **Sprint 5（试点跟进）** | `S-4` 扩展到 Coach / Evaluator | 🟡 中 | 2 天 |
| **Sprint 4（设计参考）** | `S-5` agent-kanban grouping | 🟢 低（不阻塞）| 仅设计参考 |
| **Sprint 4 / R-25** | `S-6` Project name 自动生成 | 🟢 低（UX 打磨）| 1 天 |
| **Sprint 7 启动前** | `S-8` Agent.resume 评估 | 🟡 中（Facilitator 长 session） | 评估 0.5 天 |
| **Sprint 8+** | `S-7` Cloud runtime opt-in | 🔴 高（解锁 B-1 / R-19 / R-21 / R-23） | 5~7 天 |
| **Sprint 8+** | `S-5` agent-kanban 整体迁移 | 🟡 中（R-19 跨 Project 视图）| 3~5 天 |
| **Sprint 8+** | `S-9` Hooks 协同 ApprovalCard | 🟢 低 | 2 天 |

---

## 6. 不建议引入

### MCP servers（与 `D-13` 决策冲突）

`D-13` 明确 "为什么不用 MCP：本地场景直接 spawn CLI 比 MCP 更简单直接"。这条决策当前仍然成立：

- OpenSpace 的核心场景是"本地编程协作"，Agent 工具就是 read / write / shell / grep 这些标准能力，spawn CLI 直给
- MCP 的价值在"接外部服务"（Linear / Figma / Notion 等），这是 OpenSpace `product-brief §8` "非目标场景"
- 如果未来要给 Architect 接 Linear / Figma 等外部工具，再单独评估

**不建议在 Sprint 4~7 引入**。

### SDK 的 Inline `mcpServers` 配置

即使用 SDK，也建议**不在 `Agent.create` 时传 `mcpServers`**。理由同上。

### 完全替换 `CursorAdapter`（仅引入 `CursorSdkAdapter`）

- `cursor-agent` 仍然是离线 / 老用户的兜底（很多工程师已经 git 配好 cursor-agent，不愿意换 API key 路径）
- 两套 adapter 并存的成本可控（接口已经抽好），完全替换的风险大于收益
- **建议长期并存**，环境变量 / 用户偏好让两条路径互不干扰

---

## 7. 风险与合规检查

### 风险 1：SDK 是 public beta，API 可能变动

> "Public beta. APIs may change before general availability."（[官方文档](https://cursor.com/docs/api/sdk/typescript)）

**应对**：
- `S-1` 用旁路设计，不破坏现有 `CursorAdapter`
- 在 OpenSpace 监控 SDK 升级日志，breaking change 时 `CursorSdkAdapter` 内部修改即可

### 风险 2：Cloud runtime 违反 `S-5` 数据本地承诺

**应对**：
- `S-7` 必须做成 per-Project opt-in，UI 文案明确告知
- 默认始终是 local 模式，与当前 cursor-agent 行为完全一致

### 风险 3：API key 管理（与当前 cursor-agent 已登录复用 vs 新增 `CURSOR_API_KEY`）

**当前**：`cursor-agent` 命令行登录后凭证存在 Cursor 的本地配置目录，OpenSpace 不感知。
**SDK**：需要 `CURSOR_API_KEY` 环境变量或显式 apiKey 参数。

**应对**：
- Welcome 页 / Settings 增加 "Cursor API key" 配置项，引导用户从 [Cursor integrations dashboard](https://cursor.com/dashboard/integrations) 取
- 凭证存 `~/.openspace/secrets.json`（mode 0600），与 SQLite 数据库分开（避免 key 进备份 / 同步）
- 参考 [`agent-kanban`](https://github.com/cursor/cookbook/blob/main/sdk/agent-kanban/src/lib/agents/server.ts) 的 `~/.agent-kanban/settings.json` 实现（`writeSettings` lines 564-567 已经处理好 mkdir + 0600 mode）

### 风险 4：Subagents 共享 conversation context 可能违反 `D-1` per-channel 状态隔离

**应对**：
- `S-4` 落地前做小型 spike，验证 SDK subagent 在多 thread 并发时的行为
- 必要时给每个 channel 一个独立的 `Agent.create` 实例（牺牲一些 SDK 优化但保住语义清晰）

---

## 8. 参考资料

### Cursor SDK 官方

- [TypeScript SDK 文档](https://cursor.com/docs/api/sdk/typescript)（核心 API 参考，37KB / 1218 行）
- [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints)（REST 层）
- [Self-hosted pool](https://cursor.com/docs/cloud-agent/self-hosted-pool)（企业自托管，OpenSpace 暂不涉及）
- [Hooks 文档](https://cursor.com/docs/hooks)（`S-9` 前置阅读）

### cookbook 关键文件（按价值排序）

| 文件 | 行数 | 用途 |
|------|------|------|
| [`coding-agent-cli/src/agent.ts`](https://github.com/cursor/cookbook/blob/main/sdk/coding-agent-cli/src/agent.ts) | 603 | **`S-1` 的主参考实现**：CodingAgentSession 完整包装（local/cloud/cancel/replaceAgent） |
| [`coding-agent-cli/src/index.ts`](https://github.com/cursor/cookbook/blob/main/sdk/coding-agent-cli/src/index.ts) | 291 | CLI 入口 + `runPlainPrompt` 流式打印 |
| [`agent-kanban/src/lib/agents/server.ts`](https://github.com/cursor/cookbook/blob/main/sdk/agent-kanban/src/lib/agents/server.ts) | 975 | **`S-5` 主参考**：list/create cloud agents + artifacts 代理 |
| [`agent-kanban/src/lib/agents/types.ts`](https://github.com/cursor/cookbook/blob/main/sdk/agent-kanban/src/lib/agents/types.ts) | 70 | `AgentCard` 字段定义（直接 `R-19` 用）|
| [`app-builder/src/lib/app-builder/server.ts`](https://github.com/cursor/cookbook/blob/main/sdk/app-builder/src/lib/app-builder/server.ts) | 1084 | **`S-6` 主参考**：generateProjectName + Cursor.me + Vite preview |
| [`quickstart/src/index.ts`](https://github.com/cursor/cookbook/blob/main/sdk/quickstart/src/index.ts) | 23 | 最简流式（用来验证 SDK 安装是否成功）|

### OpenSpace 内部相关

- [`packages/server/src/agents/types.ts`](../packages/server/src/agents/types.ts) — `CLIAdapter` 接口（含 `runDirect?` 钩子，`S-1` 实现入口）
- [`packages/server/src/agents/runner.ts`](../packages/server/src/agents/runner.ts) — `runWithAdapter()` 统一 dispatcher（spawn-派 / api-direct-派）
- [`packages/server/src/agents/adapter-factory.ts`](../packages/server/src/agents/adapter-factory.ts) — `createCursorAdapter()`，按 `OPENSPACE_CURSOR_BACKEND` 切换
- [`packages/server/src/agents/cursor-adapter.ts`](../packages/server/src/agents/cursor-adapter.ts) — 当前 `CursorAdapter`（spawn 子进程派，默认）
- [`packages/server/src/agents/cursor-sdk-adapter.ts`](../packages/server/src/agents/cursor-sdk-adapter.ts) — `CursorSdkAdapter`（`S-1` + `S-2` 落地点；lazy-import 避免默认启动加载 sqlite3）
- [`packages/server/src/agents/summarize-tool-args.ts`](../packages/server/src/agents/summarize-tool-args.ts) — `S-3` Activity 摘要工具
- [`packages/server/src/agents/activity-recorder.ts`](../packages/server/src/agents/activity-recorder.ts) — `D-3` Activity 写入点（已接 `summarizeToolArgs`）
- [`packages/server/scripts/verify-sdk-adapter.ts`](../packages/server/scripts/verify-sdk-adapter.ts) — Smoke 验证脚本（无需 SQLite，可直接 `tsx` 跑）
- [`docs/technical-decisions.md`](technical-decisions.md) §D-9 / §D-12 / §D-15 / §D-19 — 与 `S-1` 强相关的现有决策
- [`docs/product-brief.md`](product-brief.md) §S-5 / §K-5 / §R-23 — 与 `S-7` 强相关的成功标准 / 已知坑 / 远期路线

---

## 9. 运维与启用指南（v1.1）

### 9.1 选择后端

| 环境变量 | 行为 | 前置条件 |
|----------|------|---------|
| 未设置 / `OPENSPACE_CURSOR_BACKEND=cli`（默认）| 走 `CursorAdapter`，spawn `cursor-agent` 子进程 | 需要本机已安装 `cursor-agent` 并已登录（与原状一致） |
| `OPENSPACE_CURSOR_BACKEND=sdk` | 走 `CursorSdkAdapter`，使用 `@cursor/sdk` 直连 | 需要 `CURSOR_API_KEY` 环境变量 + sqlite3 native binding 已编译（见 9.2） |

### 9.2 启用 SDK 后端：两种方式

`@cursor/sdk` 间接依赖 `sqlite3@^5.1.7`（native binding）。仓库根 `package.json`
的 `pnpm.onlyBuiltDependencies` 已加入 `sqlite3`，所以 `pnpm install` 会自动编译，
**无需手动 `pnpm approve-builds`**。

#### 方式 A — UI 配置（推荐，新用户友好）

```bash
# 1. 启动 OpenSpace
pnpm dev

# 2. 浏览器打开 http://localhost:4178/settings（Sidebar 底部齿轮也能进）
# 3. 在 Cursor Backend 卡片：
#    - 选 "SDK" backend
#    - 粘贴 API key（从 https://cursor.com/dashboard/integrations 获取）
#    - 点 "Save & Verify"
# 4. 立即看到 "Verified as: <你的邮箱>" → 配置生效，无需重启 server
```

UI 写入到 `~/.openspace/settings.json`，OpenSpace 启动时通过 `mergeUserSettings()` 注入
到 `process.env`。文件不进入版本库（与数据库同目录，被 `.gitignore` 覆盖）。

#### 方式 B — `.env` 文件（CI / 脚本场景）

```bash
# 1. 拿 User API key：https://cursor.com/dashboard/integrations
#    （必须是 user key 或 service account key；Team Admin key 不支持）

# 2. 在仓库根 .env 写入（.env 已加入 .gitignore）
cat > .env <<'EOF'
CURSOR_API_KEY=crsr_your_key_here
OPENSPACE_CURSOR_BACKEND=sdk
EOF

# 3. 启动 server
pnpm dev
```

#### 优先级

启动时按这个顺序合并（后到的不覆盖前到的）：

1. shell `export` 的环境变量（CI 显式 override 最高）
2. `.env`（项目根 / `OPENSPACE_ENV_FILE` 指定）
3. `~/.openspace/settings.json`（UI 配置）
4. defaults（`cli` / 无 key）

> 默认（cli）模式下，**`@cursor/sdk` 通过 lazy dynamic import 引入**，启动时不会触发
> sqlite3 加载，因此默认用户无需任何额外操作。
>
> `.env` / `settings.json` 由 `packages/server/src/load-env.ts` 在 server 入口加载（不依赖
> `dotenv` 包）。如需自定义 .env 路径，设置 `OPENSPACE_ENV_FILE` 环境变量。
>
> UI Settings 页也会在 SDK 模式下展示 ripgrep 路径自动定位结果（详见 §9.4 故障排查）。

### 9.3 验证

```bash
# CLI 触发：不依赖 SQLite，verify adapter factory + summarizer + 真实 Cursor.me() auth
pnpm --filter @openspace/server exec tsx scripts/verify-sdk-adapter.ts

# REST API 触发（server 已启动）：
curl 'http://127.0.0.1:4179/api/settings/cursor?validate=true'

# UI 触发：访问 http://localhost:4178/settings 点 "Save & Verify"
```

三条路径共用同一份 `loadDotenv()` + `mergeUserSettings()` + `configureCursorRipgrep()`
+ `CursorSdkAdapter.checkInstallation()` 实现，结果一致。

### 9.4 故障排查

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| `Team Architect returned unparseable output` | SDK stream 中间 assistant text block 是增量片段，被覆盖 | v1.2 已修：累加+`RunResult.result` 双源 |
| `Ripgrep path not configured. Call configureRipgrepPath()` | pnpm `.pnpm` 间接路径 SDK 找不到 | v1.2 已修：`configureCursorRipgrep()` 启动时注入 `CURSOR_RIPGREP_PATH` |
| `EADDRINUSE: address already in use 127.0.0.1:4179` | tsx watch 重启时旧进程未释放端口 | `pkill -9 -f "tsx watch"` 后重启 |
| `no such column: channel_id` (旧用户升级) | v0 db 缺新列；schema.sql 里 INDEX 引用未补的列 | 删 `~/.openspace/openspace.db*` 让 schema 重建（开发期可以） |
| Settings 页保存后 backend 仍是 cli | shell `export` 了 `OPENSPACE_CURSOR_BACKEND=cli` 优先级最高 | `unset OPENSPACE_CURSOR_BACKEND` 后重启 server |

### 9.5 选择策略建议

- **个人开发者 + 已装 cursor-agent** → 默认 `cli` 即可
- **团队 / 服务部署 + 不想依赖 cursor-agent CLI** → `sdk`，统一用 API key 管理
- **想测试 SDK 解析稳定性** → 启 `sdk`，看 `tool_call` 解析是否更可靠（解决 `D-9` 兜底）
- **未来要上 cloud runtime / Subagents** → 必须切 `sdk`（`S-7` / `S-4`）

---

## 10. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-04-30 | 初版：基于 `cursor/cookbook` + `@cursor/sdk` public beta 文档调研，提出 `S-1` ~ `S-9` 9 个引入条目，附 Sprint 映射 |
| v1.1 | 2026-04-30 | Sprint 4-ext 落地：`S-1` `CursorSdkAdapter` + `S-2` SDK schema + `S-3` `summarizeToolArgs`；接口增 `runDirect?` 钩子，`runWithAdapter` 统一 dispatcher；新增运维章节（§9）|
| v1.2 | 2026-05-07 | 启用打通：仓库根 `.env` 加载（`load-env.ts`，零依赖）；`pnpm.onlyBuiltDependencies` 加入 `sqlite3` 免手动 `approve-builds`；verify 脚本增加真实 `Cursor.me()` auth check |
| v1.3 | 2026-05-07 | 4 个根因修复 + UI 配置入口：(1) `configureCursorRipgrep()` 注入 SDK rg 路径；(2) `CursorSdkAdapter` 改为累加流式 assistant text，不再被增量片段覆盖；(3) 新增 `~/.openspace/settings.json` + `mergeUserSettings()` 合并；(4) Settings 页 + REST `/api/settings/cursor`，UI 输入 API key + 切 backend + 实时 `Cursor.me()` 验证 |
