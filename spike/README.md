# OpenSpace CLI Bridge Spike

> Phase 0 技术验证产物。在写业务代码前验证 Codex / Claude / Cursor CLI 的非交互模式行为，确定 OpenSpace CLI Bridge 的实现方式。
>
> 执行时间：2026-04-22
>
> 详细事件格式文档：[`docs/cli-event-format.md`](../docs/cli-event-format.md)

## 验收结论

| 验收项 | 状态 | 备注 |
|--------|------|------|
| Codex CLI 可用 | ✅ | v0.118.0，ChatGPT OAuth 登录方式 |
| Cursor CLI 可用 | ✅ | v2026.03.30，命令名是 `cursor-agent`（非 `cursor agent`） |
| Claude Code 可用 | ⏸ | 未安装，占位适配器，MVP-4 用户安装后补验证 |
| 统一 `CLIAdapter` 接口 | ✅ | `spike/src/types.ts` |
| Codex 适配器可运行 | ✅ | `spike/src/codex-adapter.ts` + demo 通过 |
| Cursor 适配器可运行 | ✅ | `spike/src/cursor-adapter.ts` + demo 通过 |
| 端到端 demo | ✅ | `pnpm demo:codex` / `pnpm demo:cursor` |
| 事件格式对照文档 | ✅ | `docs/cli-event-format.md` |
| 上下文注入方式 | ✅ | 两者都支持 stdin pipe |
| 性能基线数据 | ✅ | `spike/outputs/baseline.json` |

**满足 phase0-cli-spike.md 的 §验收标准**：
- [x] 三个 CLI 至少有两个验证通过（Codex + Cursor）
- [x] 统一适配器接口已定义
- [x] 事件格式对照文档已完成
- [x] 上下文注入方式已确定
- [x] 性能基线数据已采集（首 token 延迟均 <20s）
- [x] `demo.ts` 可运行

## 快速开始

```bash
cd spike
pnpm install
pnpm typecheck

# 运行 demo（prompt 可选）
pnpm demo:codex "用中文做一段自我介绍"
pnpm demo:cursor "用中文做一段自我介绍"

# 采集性能基线（每场景 ×N 次）
pnpm exec tsx src/baseline.ts 3   # 3 次取均值

# 重跑原始 bash 验证脚本
bash scripts/test-codex.sh
bash scripts/test-cursor.sh
```

## 目录结构

```
spike/
├── README.md                    # 本文件
├── package.json                 # tsx + typescript 最小依赖
├── tsconfig.json
├── scripts/
│   ├── test-codex.sh            # Codex 原始 bash 验证（4 个 case）
│   └── test-cursor.sh           # Cursor 原始 bash 验证（5 个 case）
├── outputs/                     # baseline.json 入库；CLI 原始输出跑完脚本后产出在本地（已 gitignore）
│   ├── codex-basic.jsonl        # [gitignored] 基础测试输出
│   ├── codex-workdir.jsonl      # [gitignored] 工作目录 + 工具调用
│   ├── codex-context.jsonl      # [gitignored] stdin 上下文注入
│   ├── codex-env.jsonl          # [gitignored] 环境变量注入
│   ├── cursor-basic.ndjson      # [gitignored]
│   ├── cursor-stream.ndjson     # [gitignored] --stream-partial-output 模式
│   ├── cursor-tool.ndjson       # [gitignored] 工具调用
│   ├── cursor-context.ndjson    # [gitignored]
│   ├── cursor-model.ndjson      # [gitignored] 指定模型
│   └── baseline.json            # 性能基线数据（JSON，入库）
└── src/
    ├── types.ts                 # CLIAdapter / CLIEvent / CLIRunner 类型
    ├── codex-adapter.ts         # Codex 适配器
    ├── cursor-adapter.ts        # Cursor 适配器
    ├── claude-adapter.ts        # Claude 占位适配器
    ├── runner.ts                # CLIRunner 进程运行器
    ├── demo.ts                  # 端到端演示脚本
    └── baseline.ts              # 性能基线采集
```

## 关键发现

### 1. 三个 CLI 都是 spawn-per-message 模型
每次调用 = 一次独立进程，通过命令行 + stdin 传输 prompt + 上下文，stdout 输出 NDJSON/JSONL 事件流，进程完成后自动退出。没有长驻进程、没有持续会话通道。

**对 OpenSpace 的影响**：
- Agent "Hibernating" 状态不存在（天然"不跑就不占资源"）
- 上下文必须每次调用时**完整注入**
- Token 预算管理必须严格（见 D-4）

### 2. Cursor 首 token 比 Codex 快约 2-3 倍
Cursor ≈ 4.5s，Codex ≈ 8-16s。用户体验上 Cursor 优先。

### 3. Codex 无字符级 delta，Cursor 有
Codex 的 `agent_message` 是整条输出；Cursor `--stream-partial-output` 发送字符级 delta。

**对前端的影响**：
- Cursor 可以实现真正的打字机效果
- Codex 只能"消息整条出现"，配合 "thinking..." 过渡动画

### 4. Cursor 的 replay 陷阱
`--stream-partial-output` 模式下，最后一条 `assistant` 事件会 replay 完整文本（与所有 delta 拼接重复）。

**解决**：统一适配器让 `result.result` 字段作为 `text.completed` 权威文本，Runner 遇到 `text.completed` 时覆盖累积 delta。

### 5. Codex 必须显式关闭 stdin
pipe 环境下 stdin 不是 TTY 时 Codex 会卡住等输入。需要 `< /dev/null` 或 `child.stdin?.end()`。

### 6. 命令名是 `cursor-agent`
之前设计文档写了 `cursor agent`（带空格），实际是 `cursor-agent`（连字符）。

## CLIAdapter 接口核心

```typescript
interface CLIAdapter {
  readonly name: string;
  readonly capabilities: AdapterCapabilities;

  checkInstallation(): Promise<{ installed: boolean; version?: string; path?: string }>;

  buildCommand(params: {
    prompt: string;
    model?: string;
    reasoning?: 'low' | 'medium' | 'high' | 'xhigh';
    workingDirectory?: string;
    envVars?: Record<string, string>;
    stdinContext?: string;
    permissive?: boolean;
  }): { command: string; args: string[]; env?: Record<string, string>; stdin?: string; cwd?: string };

  parseLine(line: string): CLIEvent[];  // 一行可能产出多个事件（如 Cursor 的 result）

  getSupportedModels(): Promise<string[]>;
}
```

`CLIEvent` 统一类型见 `src/types.ts`。

## 从 Spike 到 MVP-4 的迁移清单

Phase 1 MVP-4 正式实现时：

- [ ] 把 `spike/src/` 迁移到 `packages/server/src/agents/`
- [ ] `CLIRunner` 加入并发控制（D-5: 最多 3 个进程 + FIFO 队列 + 队列上限 20）
- [ ] `CLIRunner` 接入 `ActivityRecorder`（D-3 规则）
- [ ] `ContextBuilder` 新增（按 D-4 token 预算裁剪对话历史 + description + 团队成员列表）
- [ ] 补充 `ClaudeAdapter` 真实实现（用户安装后）
- [ ] 对每个适配器加单元测试：parseLine 覆盖所有观察到的事件类型
- [ ] 针对 Codex auth 过期场景加运行前检查（`codex login status`）
- [ ] Spike 废弃提示：`spike/` 目录保留作历史参考，不再维护

## 参考链接

- [Phase 0 Spike Plan](../docs/phase0-cli-spike.md)
- [CLI Event Format Reference](../docs/cli-event-format.md)
- [Technical Decisions](../docs/technical-decisions.md)
- [Project PLAN](../PLAN.md)
