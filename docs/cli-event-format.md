# CLI Event Format Reference

> 三个 CLI 工具（Codex / Claude / Cursor）在非交互模式下的事件格式对照。
> 本文档是 Phase 0 CLI Spike 的直接产出，基于实际运行输出归纳。
> Phase 1 MVP-4 实现 CLI Bridge 时，按本文档设计适配器。
> 当前 Codex 后端默认已切到 `codex app-server --listen stdio://`，保留 `codex exec --json`
> 作为 `OPENSPACE_CODEX_BACKEND=cli` fallback。

## 命令入口对比

| 工具 | 命令 | 流式输出参数 | 工作目录参数 |
|------|------|-------------|-------------|
| **Codex app-server** | `codex app-server --listen stdio://` | JSON-RPC notifications | `cwd` / `sandboxPolicy` |
| **Codex CLI fallback** | `codex exec` | `--json` | `-C <DIR>` |
| **Claude Code** | `claude -p` | `--output-format stream-json` | `--add-dir <DIR>` |
| **Cursor CLI** | `cursor-agent -p` | `--output-format stream-json [--stream-partial-output]` | `--workspace <DIR>` |

**重要发现**：
- Cursor CLI 的命令名是 `cursor-agent`（不是 `cursor agent`，不是 `cursor`）
- Codex 必须加 `< /dev/null` 显式关闭 stdin，否则在 pipe 环境下会卡住等待 stdin 输入
- Codex 默认强制 git 仓库检测，非 git 目录需加 `--skip-git-repo-check`

## 事件类型对照

### Codex CLI

JSONL 事件，**无字符级 delta**，每个 `item` 整条输出：

| 事件 type | 含义 | 关键字段 |
|-----------|------|---------|
| `thread.started` | 会话开始 | `thread_id` |
| `turn.started` | 一轮对话开始 | （无） |
| `item.started` | item 开始（目前仅 command_execution 出现） | `item.id`, `item.type`, `item.command`, `item.status="in_progress"` |
| `item.completed` | item 完成 | `item.id`, `item.type`, 其他按 type 而定 |
| `turn.completed` | 一轮对话完成 | `usage.input_tokens`, `usage.cached_input_tokens`, `usage.output_tokens` |

**item.type 子类型**：

| item.type | 含义 | 额外字段 |
|-----------|------|---------|
| `agent_message` | 模型文本响应（整条） | `text`（完整字符串，**非 delta**） |
| `command_execution` | shell 命令执行 | `command`, `aggregated_output`, `exit_code`, `status` |

**样例**（`spike/outputs/codex-workdir.jsonl`）：

```json
{"type":"thread.started","thread_id":"019db503-28f7-7243-8e19-a754348dd4d0"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"我先检查当前目录内容..."}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc 'rg --files -uu .'","status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc 'rg --files -uu .'","aggregated_output":"./b.md\n./a.txt\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"当前目录下有 2 个文件..."}}
{"type":"turn.completed","usage":{"input_tokens":52433,"cached_input_tokens":29568,"output_tokens":157}}
```

### Cursor CLI

NDJSON 事件，**支持字符级 delta**（通过 `--stream-partial-output`）：

| 事件 type | subtype | 含义 | 关键字段 |
|-----------|---------|------|---------|
| `system` | `init` | 会话初始化 | `session_id`, `cwd`, `model`, `permissionMode`, `apiKeySource` |
| `user` | - | 用户消息回显 | `message.content[0].text` |
| `thinking` | `delta` | 推理过程片段 | `text` |
| `thinking` | `completed` | 推理结束 | - |
| `assistant` | - | 助手文本输出 | `message.content[0].text`（stream-partial 模式下每条是独立 chunk，最后一条是 full replay） |
| `tool_call` | `started` | 工具调用开始 | `call_id`, `tool_call.{xxxToolCall}.args` |
| `tool_call` | `completed` | 工具调用完成 | `call_id`, `tool_call.{xxxToolCall}.result.success` |
| `result` | `success` | 会话完成（权威） | `duration_ms`, `is_error`, `result`（最终完整文本）, `usage` |

**工具调用子类型**（`tool_call.<name>ToolCall`）：
- `shellToolCall` — shell 命令
- `readToolCall` — 读文件
- `writeToolCall` — 写文件
- `editToolCall` — 编辑
- 等等

**样例**（简化自 `spike/outputs/cursor-basic.ndjson`）：

```json
{"type":"system","subtype":"init","session_id":"...","cwd":"...","model":"..."}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
{"type":"thinking","subtype":"delta","text":"The user wants..."}
{"type":"thinking","subtype":"completed"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"你好！"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"我是一个"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"AI编程助手..."}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"你好！我是一个AI编程助手..."}]}}
{"type":"result","subtype":"success","duration_ms":9678,"is_error":false,"result":"你好！我是一个AI编程助手...","usage":{"inputTokens":3,"outputTokens":98}}
```

### Claude Code（待 Phase 1+ 验证）

根据社区文档预期：

| 事件 type | 含义 |
|-----------|------|
| `system` | 会话初始化（含 session_id） |
| `user` | 用户消息回显 |
| `assistant` | 助手响应（可能分 message_start / content_block_delta / message_stop） |
| `tool_use` | 工具调用 |
| `tool_result` | 工具结果 |
| `result` | 最终结果（含 usage, cost, duration） |

**占位**：MVP-4 执行时实际验证后补完整映射。

## 统一适配器事件模型（CLIEvent）

OpenSpace 内部用统一的 `CLIEvent` 联合类型（见 `spike/src/types.ts`）：

```typescript
type CLIEvent =
  | { type: 'session.started'; session_id: string; meta?: Record<string, unknown> }
  | { type: 'session.completed'; duration_ms?: number; usage?: UsageInfo }
  | { type: 'thinking.delta'; text: string }
  | { type: 'thinking.completed' }
  | { type: 'text.delta'; text: string }
  | { type: 'text.completed'; text: string }
  | { type: 'tool.started'; call_id: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool.completed'; call_id: string; tool: string; success: boolean; result?: string; exit_code?: number; duration_ms?: number }
  | { type: 'error'; message: string; code?: string; recoverable?: boolean };
```

### 映射规则

| OpenSpace 统一事件 | Codex 原生事件 | Cursor 原生事件 |
|---------------|---------------|----------------|
| `session.started` | `thread.started` | `system{subtype:init}` |
| `session.completed` | `turn.completed` | `result{subtype:success}` |
| `thinking.delta` | ❌ 无（capabilities.supportsThinking=false） | `thinking{subtype:delta}` |
| `thinking.completed` | ❌ 无 | `thinking{subtype:completed}` |
| `text.delta` | ❌ 无（capabilities.supportsTextDelta=false） | `assistant`（每条作为 delta） |
| `text.completed` | `item.completed{type:agent_message}` | `result.result` 字段（权威最终文本） |
| `tool.started` | `item.started{type:command_execution}` | `tool_call{subtype:started}` |
| `tool.completed` | `item.completed{type:command_execution}` | `tool_call{subtype:completed}` |
| `error` | `turn.failed` / `error` 或 stderr | `result{is_error:true}` |

## 能力差异表（AdapterCapabilities）

| 能力 | Codex | Cursor | Claude |
|------|-------|--------|--------|
| supportsTextDelta（字符级流式） | ❌ | ✅ | ✅（预期） |
| supportsThinking（思考过程） | ❌ | ✅ | ❌（预期） |
| supportsWorkingDirectory | ✅ | ✅ | ✅ |
| supportsEnvVars | ✅ | ✅ | ✅ |
| supportsModelSelection | ✅ | ✅ | ✅ |
| supportsReasoningEffort | ✅（config） | ❌（通过 model 名） | ❌（预期） |
| supportsStdinContext | ✅ | ✅ | ✅（预期） |

**对上层业务的影响**：

1. **前端流式渲染**
   - Cursor 可实现字符级流式（打字机效果）
   - Codex app-server 支持 `item/agentMessage/delta`；CLI fallback 只能"整条出现"
2. **上下文注入**：三者都支持 stdin pipe，但长文本最佳实践是通过 prompt 拼接
3. **Reasoning 参数**：Codex 支持 `model_reasoning_effort`，Cursor 通过 `-thinking` / `-high` 后缀模型名，Claude 未知
4. **Sandbox / approval**：Codex 有 sandbox / approval 选项。OpenSpace 正式后端普通 agent 使用 `workspace-write` + `on-request`；只读 system agent 使用 `read-only` + `on-request`。默认 app-server backend 会接收 `item/*/requestApproval` server request，并通过 UI Approve / Reject 把决定回写 JSON-RPC；`codex exec` fallback 仍只能展示 unsupported approval，因为 exec mode 不能接收审批决定。

## 性能基线（本机采集 2026-04-22）

`spike/outputs/baseline.json` 数据摘要（每场景 2 次取均值）：

| 场景 | Codex first-token | Codex total | Cursor first-token | Cursor total |
|------|------------------|-------------|-------------------|--------------|
| 简单问答 (短 prompt) | 8.3s | 9.8s | 4.6s | 5.0s |
| 4K 上下文注入 | 8.1s | 9.6s | 4.7s | 14.1s |
| 50 字回复 | 15.6s | 17.1s | 4.5s | 5.8s |

**结论**：
- **Cursor 首 token 约 4.5s**，稳定且不受 prompt 显著影响
- **Codex 首 token 约 8-16s**，受 prompt 复杂度影响大（可能与其工程索引有关）
- 4K 上下文注入不显著影响首 token（两者都证明上下文传递可行）
- 所有场景 total < 20s，前端需展示 "thinking..." 反馈，但总体可接受

**设计影响**：
- 默认 `PROCESS_TIMEOUT_MS=300000`（5 分钟）对正常场景绰绰有余
- 首 token 延迟 >3s 时前端必须显示 Loading 状态（见 D-11）
- Cursor 优先级应高于 Codex（用户体验更好）

## 关键验证踩坑

### Codex stdin 卡死

**现象**：`codex exec "prompt" > out.jsonl` 在 pipe 环境下会卡 stdin。

**原因**：Codex 检测到 stdin 是 pipe（非 TTY）时，会尝试读取 stdin 作为附加上下文（help 文档说明）。

**解决**：spawn 时必须显式传 `stdin: ''` 或 `< /dev/null`。代码中通过 `child.stdin?.end()` 实现。

### Codex auth 过期

**现象**：stderr 持续输出 `refresh_token_reused` + `token_expired`，主进程无限重试。

**原因**：Codex 使用 OAuth refresh token，过期后需重新登录。

**解决**：用户需手动 `codex login`。生产环境应在 spawn 前先检查 `codex login status`，过期时引导用户。

### Cursor 事件中的 replay 陷阱

**现象**：`--stream-partial-output` 模式下，最后一条 `assistant` 事件的 text 是完整 replay，与前面所有 delta 拼接重复。

**解决**：忽略"最终 assistant"，改由 `result.result` 字段作为权威 `text.completed`。CLIRunner 遇到 `text.completed` 时覆盖累积的 delta fullText。

---

*本文档由 Phase 0 Spike 验证直接生成，覆盖 2026-04 时点的 CLI 版本。CLI 升级后如事件格式变化，请重跑 `spike/scripts/test-*.sh` 并更新本文档。*
