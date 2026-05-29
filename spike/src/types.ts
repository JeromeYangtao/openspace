/**
 * Phase 0 Spike: CLIAdapter 接口定义
 *
 * 本文件定义 OpenSpace 三个 CLI 工具（Codex / Claude / Cursor）的统一适配器接口。
 * Phase 1 MVP-4 正式实现时会从 spike/src/ 迁移到 packages/server/src/agents/。
 *
 * 关键设计原则：
 * 1. 所有 CLI 采用 spawn-per-message 模型（验证见 docs/phase0-cli-spike.md）
 * 2. 输入：prompt + 可选 stdin context
 * 3. 输出：NDJSON/JSONL 流 → 统一映射为 CLIEvent 事件
 * 4. 能力差异（如字符级 delta 支持）通过 Capability flag 暴露
 */

// ============================================================================
// 统一事件类型（三个 CLI 的输出映射到这些类型）
// ============================================================================

export type CLIEvent =
  // 会话边界
  | { type: 'session.started'; session_id: string; meta?: Record<string, unknown> }
  | { type: 'session.completed'; duration_ms?: number; usage?: UsageInfo }

  // 思考过程（Cursor 会有，Codex 目前不暴露）
  | { type: 'thinking.delta'; text: string }
  | { type: 'thinking.completed' }

  // 文本响应
  //   Codex: 只有 text.completed（整条 agent_message）
  //   Cursor: 有 text.delta（字符级片段）+ text.completed
  | { type: 'text.delta'; text: string }
  | { type: 'text.completed'; text: string }

  // 工具调用（shell / read / write / ...）
  | {
      type: 'tool.started'
      call_id: string
      tool: string
      args: Record<string, unknown>
    }
  | {
      type: 'tool.completed'
      call_id: string
      tool: string
      success: boolean
      result?: string
      exit_code?: number
      duration_ms?: number
    }

  // 错误
  | { type: 'error'; message: string; code?: string; recoverable?: boolean };

export interface UsageInfo {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  // 其它 runtime 特有字段可放进 extra
  extra?: Record<string, unknown>;
}

// ============================================================================
// 适配器能力声明
// ============================================================================

export interface AdapterCapabilities {
  /** 是否支持字符级 delta（影响 UI 流式渲染策略） */
  supportsTextDelta: boolean;
  /** 是否暴露思考过程事件 */
  supportsThinking: boolean;
  /** 是否支持自定义 working directory */
  supportsWorkingDirectory: boolean;
  /** 是否支持环境变量传递 */
  supportsEnvVars: boolean;
  /** 是否支持显式选择模型 */
  supportsModelSelection: boolean;
  /** 是否支持 reasoning effort 参数 */
  supportsReasoningEffort: boolean;
  /** 是否通过 stdin 接收额外上下文（若为 false，上下文必须放 prompt） */
  supportsStdinContext: boolean;
}

// ============================================================================
// 适配器接口
// ============================================================================

export interface CLIAdapter {
  /** 适配器名称，如 'codex' / 'claude' / 'cursor' */
  readonly name: string;

  /** 能力声明 */
  readonly capabilities: AdapterCapabilities;

  /** 检测本地是否已安装 */
  checkInstallation(): Promise<{
    installed: boolean;
    version?: string;
    path?: string;
    error?: string;
  }>;

  /** 构建 spawn 参数 */
  buildCommand(params: BuildCommandParams): SpawnSpec;

  /**
   * 解析单行 NDJSON/JSONL 输出为 CLIEvent 事件数组。
   * 大多数情况返回 0 或 1 个事件；某些 CLI（如 Cursor）的 result 事件
   * 包含多种语义（text.completed + session.completed），会返回 2 个事件。
   */
  parseLine(line: string): CLIEvent[];

  /** 返回该 CLI 支持的 model 列表（可异步查询，也可返回静态数组） */
  getSupportedModels(): Promise<string[]>;
}

export interface BuildCommandParams {
  prompt: string;
  model?: string;
  reasoning?: 'low' | 'medium' | 'high' | 'xhigh';
  workingDirectory?: string;
  envVars?: Record<string, string>;
  /** 额外上下文（通常通过 stdin 传递），若 adapter 不支持，此字段会被合并进 prompt */
  stdinContext?: string;
  /** 工具权限：MVP 先放开所有，后续收紧 */
  permissive?: boolean;
}

export interface SpawnSpec {
  /** 可执行文件名或绝对路径 */
  command: string;
  /** 参数列表 */
  args: string[];
  /** 环境变量（merge 到 process.env） */
  env?: Record<string, string>;
  /** stdin 内容（如果 adapter 要通过 stdin 传 context） */
  stdin?: string;
  /** 工作目录 */
  cwd?: string;
}

// ============================================================================
// 进程运行器接口
// ============================================================================

export interface RunnerOptions {
  /** 超时（毫秒），默认 300000 = 5 分钟 */
  timeoutMs?: number;
  /** 事件回调 */
  onEvent?: (event: CLIEvent) => void;
  /** 原始 stdout 行回调（debug 用） */
  onRawLine?: (line: string) => void;
  /** 原始 stderr 行回调 */
  onStderr?: (line: string) => void;
}

export interface RunnerResult {
  exitCode: number | null;
  /** 聚合后的完整文本响应（text.completed 或累加 text.delta） */
  fullText: string;
  /** 所有已解析事件 */
  events: CLIEvent[];
  /** 总耗时 */
  duration_ms: number;
  /** 是否因超时被 kill */
  timedOut: boolean;
}
