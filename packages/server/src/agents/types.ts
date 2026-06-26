/**
 * CLI 适配器与 Runner 接口（从 spike/src/types.ts 迁移 + 精炼）
 */

// =============================================================================
// 统一事件类型
// =============================================================================

export type CLIEvent =
  | { type: 'session.started'; session_id: string; meta?: Record<string, unknown> }
  | { type: 'session.completed'; duration_ms?: number; usage?: UsageInfo }
  | { type: 'context_usage.updated'; usage: ContextUsageInfo }
  | { type: 'thinking.delta'; text: string }
  | { type: 'thinking.completed' }
  | { type: 'text.delta'; text: string }
  | { type: 'text.completed'; text: string }
  | {
      type: 'tool.started';
      call_id: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'tool.completed';
      call_id: string;
      tool: string;
      success: boolean;
      result?: string;
      exit_code?: number;
      duration_ms?: number;
    }
  | {
      type: 'approval.required';
      call_id?: string;
      title: string;
      kind?: 'command' | 'file_change' | 'permissions';
      command?: string;
      detail?: string;
      reason?: string;
      policyAmendment?: string;
      supported: boolean;
    }
  | { type: 'error'; message: string; code?: string; recoverable?: boolean };

export interface UsageInfo {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  extra?: Record<string, unknown>;
}

export interface TokenUsageBreakdown {
  total_tokens: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
}

export interface ContextUsageInfo {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  model_context_window: number | null;
  percent_used: number | null;
  context_percent?: number | null;
  input_tokens_in_latest_context?: number | null;
}

// =============================================================================
// Adapter capabilities
// =============================================================================

export interface AdapterCapabilities {
  supportsTextDelta: boolean;
  supportsThinking: boolean;
  supportsWorkingDirectory: boolean;
  supportsEnvVars: boolean;
  supportsModelSelection: boolean;
  supportsReasoningEffort: boolean;
  supportsStdinContext: boolean;
}

// =============================================================================
// Adapter
// =============================================================================

export interface CLIAdapter {
  readonly name: string;
  readonly capabilities: AdapterCapabilities;

  checkInstallation(): Promise<{
    installed: boolean;
    version?: string;
    path?: string;
    error?: string;
  }>;

  buildCommand(params: BuildCommandParams): SpawnSpec;
  parseLine(line: string): CLIEvent[];
  getSupportedModels(): Promise<string[]>;

  /**
   * S-1：API-direct 派 adapter 的入口（如 CursorSdkAdapter）。
   *
   * 实现该方法的 adapter 会被 `runWithAdapter` 优先调用，runner 跳过 spawn / parseLine
   * 流程，由 adapter 自行驱动 SDK 流式返回并 emit `CLIEvent`。
   *
   * 不实现：使用默认的 spawn-spec 路径（buildCommand + parseLine）。
   */
  runDirect?(params: BuildCommandParams, options: RunnerOptions): Promise<RunnerResult>;
}

export interface BuildCommandParams {
  prompt: string;
  model?: string | null;
  reasoning?: string | null;
  /**
   * Sprint 4-ext / Phase A：Cursor SDK ModelSelection.params{id:"thinking"} 透传。
   * `null` / `undefined` = 跟 model 默认；CLI 模式下被忽略 + warn。
   */
  thinking?: boolean | null;
  /**
   * Sprint 4-ext / Phase A：Cursor SDK ModelSelection.params{id:"context"} 透传。
   * `null` / `undefined` = 跟 model 默认。CLI 模式下被忽略 + warn。
   */
  context?: '300k' | '1m' | null;
  workingDirectory?: string;
  envVars?: Record<string, string>;
  stdinContext?: string;
  permissive?: boolean;
  resumeSessionId?: string | null;
  /**
   * Optional stable key for long-lived Codex app-server reuse.
   * Other adapters ignore this field.
   */
  codexAppServerKey?: string;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
  stdin?: string;
  cwd?: string;
}

// =============================================================================
// Runner
// =============================================================================

export interface RunnerOptions {
  timeoutMs?: number;
  onEvent?: (event: CLIEvent) => void;
  onRawLine?: (line: string) => void;
  onStderr?: (line: string) => void;
  /** 外部控制：在进行中可主动 abort */
  signal?: AbortSignal;
}

export interface RunnerResult {
  exitCode: number | null;
  fullText: string;
  events: CLIEvent[];
  duration_ms: number;
  timedOut: boolean;
  aborted: boolean;
}
