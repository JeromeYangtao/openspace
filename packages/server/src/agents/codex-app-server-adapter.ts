import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { CodexRuntimeState, CodexRuntimeStatus } from '@openspace/shared';
import { cancelApproval, registerApproval, type ApprovalDecision } from './approval-manager.js';
import type {
  AdapterCapabilities,
  BuildCommandParams,
  CLIAdapter,
  CLIEvent,
  ContextUsageInfo,
  RunnerOptions,
  RunnerResult,
  SpawnSpec,
  TokenUsageBreakdown,
} from './types.js';
import { parseTokenCountInfo } from './codex-session-log.js';

const execFileAsync = promisify(execFile);
const COMPACT_TIMEOUT_MS = 120_000;
const APP_SERVER_KILL_GRACE_MS = 2_000;
const APP_SERVER_STALE_MS = 120_000;

type JsonRpcId = number | string;
type JsonRpcMessage = {
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
};

const MODEL_ALIASES: Record<string, string> = {
  'gpt-5-codex': 'gpt-5.1-codex-max',
};

const FALLBACK_MODELS = ['gpt-5.1-codex-max', 'gpt-5-codex', 'gpt-5.1', 'gpt-5'];

const REASONING_ALIASES: Record<string, string> = {
  none: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  'extra-high': 'xhigh',
  xhigh: 'xhigh',
  max: 'xhigh',
};

function normalizeModel(raw?: string | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return MODEL_ALIASES[value] ?? value;
}

function normalizeReasoning(raw?: string | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return REASONING_ALIASES[value] ?? value;
}

function promptWithContext(params: BuildCommandParams): string {
  if (!params.stdinContext?.trim()) return params.prompt;
  return `${params.prompt}\n\nAdditional context:\n${params.stdinContext}`;
}

function sandboxMode(params: BuildCommandParams): 'workspace-write' | 'read-only' {
  return params.permissive ? 'workspace-write' : 'read-only';
}

function sandboxPolicy(params: BuildCommandParams): Record<string, unknown> {
  if (!params.permissive) {
    return { type: 'readOnly', networkAccess: false };
  }
  const cwd = params.workingDirectory ?? process.cwd();
  return {
    type: 'workspaceWrite',
    writableRoots: [cwd],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function commandFromParams(params: Record<string, unknown>): string | undefined {
  const command = params.command;
  if (typeof command === 'string' && command.trim()) return command;
  const actions = params.commandActions;
  if (Array.isArray(actions) && actions.length > 0) {
    try {
      return JSON.stringify(actions).slice(0, 240);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function stringFromParams(params: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function compactJson(value: unknown, maxLength = 1200): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > maxLength ? `${json.slice(0, maxLength)}...` : json;
  } catch {
    return undefined;
  }
}

function policyAmendmentFromParams(params: Record<string, unknown>): string | undefined {
  return compactJson(
    params.proposedExecpolicyAmendment ??
      params.proposedExecPolicyAmendment ??
      params.execpolicyAmendment ??
      params.execPolicyAmendment,
  );
}

function execPolicyAmendmentFromParams(params: Record<string, unknown>): unknown[] | null {
  const amendment =
    params.proposedExecpolicyAmendment ??
    params.proposedExecPolicyAmendment ??
    params.execpolicyAmendment ??
    params.execPolicyAmendment;
  return Array.isArray(amendment) ? amendment : null;
}

function approvalDetail(
  kind: 'command' | 'file_change' | 'permissions',
  params: Record<string, unknown>,
): string | undefined {
  if (kind === 'command') {
    return stringFromParams(params, ['cwd', 'workdir', 'workingDirectory']);
  }

  if (kind === 'permissions') {
    return compactJson({
      permissions: params.permissions,
      grantRoot: params.grantRoot,
      writableRoots: params.writableRoots,
    });
  }

  const path =
    stringFromParams(params, ['path', 'filePath', 'file', 'targetPath']) ??
    stringFromParams(params, ['cwd', 'workdir', 'workingDirectory']);
  const diff = stringFromParams(params, ['diff', 'patch', 'changes']);
  const summary = compactJson(params.changes ?? params.files ?? params.edits);
  return (
    [path ? `Path: ${path}` : undefined, diff ?? summary].filter(Boolean).join('\n\n') || undefined
  );
}

function errorMessageFromNotification(params: Record<string, unknown>): string {
  if (typeof params.message === 'string' && params.message) return params.message;
  const error = params.error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message) return message;
  }
  return 'Codex app-server error';
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseTokenUsageBreakdown(value: unknown): TokenUsageBreakdown | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return {
    total_tokens: numberField(record, 'totalTokens'),
    input_tokens: numberField(record, 'inputTokens'),
    cached_input_tokens: numberField(record, 'cachedInputTokens'),
    output_tokens: numberField(record, 'outputTokens'),
    reasoning_output_tokens: numberField(record, 'reasoningOutputTokens'),
  };
}

function parseContextUsage(value: unknown): ContextUsageInfo | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const total = parseTokenUsageBreakdown(record.total);
  const last = parseTokenUsageBreakdown(record.last);
  if (!total || !last) return null;
  const modelContextWindow =
    typeof record.modelContextWindow === 'number' && Number.isFinite(record.modelContextWindow)
      ? record.modelContextWindow
      : null;
  return {
    total,
    last,
    model_context_window: modelContextWindow,
    percent_used:
      modelContextWindow && modelContextWindow > 0 ? last.input_tokens / modelContextWindow : null,
    context_percent:
      modelContextWindow && modelContextWindow > 0
        ? (last.input_tokens / modelContextWindow) * 100
        : null,
    input_tokens_in_latest_context: null,
  };
}

function approvalTitle(method: string): string {
  if (method === 'item/commandExecution/requestApproval') return 'Command approval requested';
  if (method === 'item/fileChange/requestApproval') return 'File change approval requested';
  if (method === 'item/permissions/requestApproval') return 'Permission approval requested';
  return 'Approval requested';
}

function approvalKind(method: string): 'command' | 'file_change' | 'permissions' {
  if (method === 'item/fileChange/requestApproval') return 'file_change';
  if (method === 'item/permissions/requestApproval') return 'permissions';
  return 'command';
}

function decisionFor(
  kind: 'command' | 'file_change' | 'permissions',
  decision: ApprovalDecision,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  if (kind === 'permissions') {
    if (decision === 'reject' || decision === 'cancel') return null;
    const requested = params.permissions;
    return {
      permissions: requested && typeof requested === 'object' ? requested : {},
      scope: decision === 'approve_for_session' ? 'session' : 'turn',
      strictAutoReview: true,
    };
  }

  const protocolDecision =
    decision === 'approve'
      ? 'accept'
      : decision === 'approve_for_session'
        ? 'acceptForSession'
        : decision === 'approve_with_policy'
          ? (() => {
              const amendment = execPolicyAmendmentFromParams(params);
              return amendment
                ? {
                    acceptWithExecpolicyAmendment: {
                      execpolicy_amendment: amendment,
                    },
                  }
                : 'acceptForSession';
            })()
          : decision === 'reject'
            ? 'decline'
            : 'cancel';
  return { decision: protocolDecision };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface ActiveTurn {
  start: number;
  lastEventAt: number | null;
  events: CLIEvent[];
  pendingApprovalIds: Set<string>;
  options: RunnerOptions;
  resolve: (result: RunnerResult) => void;
  fullText: string;
  deltaBuffer: string;
  finalText: string;
  timedOut: boolean;
  aborted: boolean;
  threadId: string | null;
  turnId: string | null;
  interrupting: boolean;
  settled: boolean;
  finish: (exitCode: number | null) => RunnerResult;
  emit: (event: CLIEvent) => void;
}

class CodexAppServerClient {
  private child: ChildProcess | null = null;
  private stdoutBuf = '';
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private activeTurn: ActiveTurn | null = null;
  private startPromise: Promise<void> | null = null;
  private disposed = false;
  private startedAt: number | null = null;
  private lastMessageAt: number | null = null;
  private lastStdoutAt: number | null = null;
  private lastStderrAt: number | null = null;
  private closedAt: number | null = null;
  private lastError: string | null = null;

  constructor(
    readonly key: string,
    private readonly params: BuildCommandParams,
    private readonly onDispose: (key: string) => void,
  ) {}

  get busy(): boolean {
    return this.activeTurn !== null;
  }

  snapshot(now = Date.now()): CodexRuntimeStatus {
    const meta = this.params.codexAppServerMeta;
    return {
      key: this.key,
      agent_id: meta?.agentId,
      channel_id: meta?.channelId,
      workspace_path: meta?.workspacePath ?? this.params.workingDirectory,
      pid: this.child?.pid ?? null,
      state: this.runtimeState(now),
      started_at: this.startedAt,
      last_message_at: this.lastMessageAt,
      last_stdout_at: this.lastStdoutAt,
      last_stderr_at: this.lastStderrAt,
      pending_requests: this.pendingRequests.size,
      active_turn: this.activeTurn
        ? {
            thread_id: this.activeTurn.threadId,
            turn_id: this.activeTurn.turnId,
            started_at: this.activeTurn.start,
            last_event_at: this.activeTurn.lastEventAt,
            interrupting: this.activeTurn.interrupting,
          }
        : null,
      error: this.lastError,
    };
  }

  private runtimeState(now: number): CodexRuntimeState {
    if (this.lastError) return 'error';
    if (this.closedAt || (!this.child && !this.startPromise)) return 'exited';
    if (this.startPromise && !this.child) return 'starting';
    if (this.activeTurn) {
      const lastActivity =
        this.activeTurn.lastEventAt ?? this.lastMessageAt ?? this.activeTurn.start;
      return now - lastActivity > APP_SERVER_STALE_MS ? 'stale' : 'busy';
    }
    return 'healthy';
  }

  async runTurn(params: BuildCommandParams, options: RunnerOptions = {}): Promise<RunnerResult> {
    try {
      await this.ensureStarted();
    } catch (e) {
      const event: CLIEvent = {
        type: 'error',
        message: `Codex app-server setup failed: ${(e as Error).message}`,
        code: 'codex_app_server_setup_failed',
      };
      this.dispose();
      return {
        exitCode: null,
        fullText: '',
        events: [event],
        duration_ms: 0,
        timedOut: false,
        aborted: false,
      };
    }
    if (this.activeTurn) {
      return {
        exitCode: 1,
        fullText: '',
        events: [
          {
            type: 'error',
            message: 'Codex app-server already has an active turn',
            code: 'codex_app_server_busy',
          },
        ],
        duration_ms: 0,
        timedOut: false,
        aborted: false,
      };
    }

    const turn = this.createTurn(options);
    this.activeTurn = turn;

    const onAbort = () => this.abortActiveTurn();

    return new Promise<RunnerResult>((resolve) => {
      turn.resolve = (result) => {
        if (options.signal) options.signal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
      void this.startTurn(params, turn);
    });
  }

  private async startTurn(params: BuildCommandParams, turn: ActiveTurn): Promise<void> {
    try {
      const cwd = params.workingDirectory ?? process.cwd();
      const threadResult = await this.request(
        params.resumeSessionId ? 'thread/resume' : 'thread/start',
        {
          ...(params.resumeSessionId ? { threadId: params.resumeSessionId } : {}),
          cwd,
          runtimeWorkspaceRoots: [cwd],
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          sandbox: sandboxMode(params),
          ...(normalizeModel(params.model) ? { model: normalizeModel(params.model) } : {}),
        },
      );
      const thread =
        threadResult && typeof threadResult === 'object'
          ? (threadResult as Record<string, unknown>).thread
          : null;
      const threadId =
        thread && typeof thread === 'object' ? (thread as Record<string, unknown>).id : undefined;
      if (typeof threadId !== 'string' || !threadId) {
        throw new Error('Codex app-server did not return a thread id');
      }
      turn.threadId = threadId;

      turn.emit({
        type: 'session.started',
        session_id: threadId,
        meta: {
          backend: 'app-server',
          approvalPolicy: 'on-request',
          sandbox: sandboxMode(params),
        },
      });

      await this.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: promptWithContext(params), text_elements: [] }],
        cwd,
        runtimeWorkspaceRoots: [cwd],
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandboxPolicy: sandboxPolicy(params),
        ...(normalizeModel(params.model) ? { model: normalizeModel(params.model) } : {}),
        effort: normalizeReasoning(params.reasoning),
      });
    } catch (e) {
      turn.emit({
        type: 'error',
        message: `Codex app-server setup failed: ${(e as Error).message}`,
        code: 'codex_app_server_setup_failed',
      });
      this.resolveActiveTurn(turn.finish(null));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectPendingRequests(new Error('Codex app-server disposed'));
    if (this.activeTurn && !this.activeTurn.settled) {
      this.activeTurn.emit({
        type: 'error',
        message: 'Codex app-server was closed',
        code: 'codex_app_server_closed',
      });
      this.resolveActiveTurn(this.activeTurn.finish(null));
    }
    try {
      this.child?.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        this.child?.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, APP_SERVER_KILL_GRACE_MS).unref();
    this.onDispose(this.key);
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.disposed) return;
    if (this.startPromise) return this.startPromise;
    this.disposed = false;
    this.startPromise = this.start();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async start(): Promise<void> {
    this.child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      cwd: this.params.workingDirectory,
      env: this.params.envVars ? { ...process.env, ...this.params.envVars } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.startedAt = Date.now();
    this.closedAt = null;
    this.lastError = null;

    this.child.stdout?.on('data', (chunk: Buffer) => {
      const now = Date.now();
      this.lastMessageAt = now;
      this.lastStdoutAt = now;
      this.stdoutBuf += chunk.toString('utf8');
      let idx: number;
      while ((idx = this.stdoutBuf.indexOf('\n')) >= 0) {
        const line = this.stdoutBuf.slice(0, idx).trim();
        this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
        if (!line) continue;
        this.activeTurn?.options.onRawLine?.(line);
        try {
          this.handleMessage(JSON.parse(line) as JsonRpcMessage);
        } catch (e) {
          this.activeTurn?.emit({
            type: 'error',
            message: `Failed to parse Codex app-server message: ${(e as Error).message}`,
            code: 'codex_app_server_parse_failed',
          });
        }
      }
    });

    this.child.stderr?.on('data', (chunk: Buffer) => {
      const now = Date.now();
      this.lastMessageAt = now;
      this.lastStderrAt = now;
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim()) this.activeTurn?.options.onStderr?.(line);
      }
    });

    this.child.on('error', (err) => {
      this.lastError = err.message;
      this.activeTurn?.emit({
        type: 'error',
        message: err.message,
        code: 'codex_app_server_spawn_failed',
      });
      if (this.activeTurn) this.resolveActiveTurn(this.activeTurn.finish(null));
      this.dispose();
    });

    this.child.on('close', (code) => {
      this.closedAt = Date.now();
      this.rejectPendingRequests(
        new Error(`Codex app-server exited${code === null ? '' : ` (${code})`}`),
      );
      if (this.activeTurn && !this.activeTurn.settled) {
        this.activeTurn.emit({
          type: 'error',
          message: `Codex app-server exited before turn completed${code === null ? '' : ` (${code})`}`,
          code: 'codex_app_server_exited',
        });
        this.resolveActiveTurn(this.activeTurn.finish(code));
      }
      this.child = null;
      this.onDispose(this.key);
    });

    await this.request('initialize', {
      clientInfo: {
        name: 'openspace',
        title: 'OpenSpace',
        version: '0.0.1',
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    this.send({ method: 'initialized', params: {} });
  }

  private createTurn(options: RunnerOptions): ActiveTurn {
    const turn: ActiveTurn = {
      start: Date.now(),
      lastEventAt: null,
      events: [],
      pendingApprovalIds: new Set<string>(),
      options,
      resolve: () => {},
      fullText: '',
      deltaBuffer: '',
      finalText: '',
      timedOut: false,
      aborted: false,
      threadId: null,
      turnId: null,
      interrupting: false,
      settled: false,
      finish: () => {
        throw new Error('turn.finish called before initialization');
      },
      emit: () => {},
    };

    turn.emit = (event: CLIEvent) => {
      turn.lastEventAt = Date.now();
      turn.events.push(event);
      if (event.type === 'text.delta') {
        turn.deltaBuffer += event.text;
        turn.fullText = turn.deltaBuffer;
      } else if (event.type === 'text.completed') {
        turn.finalText = event.text;
        turn.fullText = event.text;
      }
      options.onEvent?.(event);
    };

    turn.finish = (exitCode: number | null): RunnerResult => {
      this.cleanupApprovals(turn);
      if (!turn.finalText && turn.deltaBuffer) {
        const event: CLIEvent = { type: 'text.completed', text: turn.deltaBuffer };
        turn.events.push(event);
        turn.fullText = turn.deltaBuffer;
        options.onEvent?.(event);
      }
      return {
        exitCode,
        fullText: turn.fullText,
        events: turn.events,
        duration_ms: Date.now() - turn.start,
        timedOut: turn.timedOut,
        aborted: turn.aborted,
      };
    };

    return turn;
  }

  private abortActiveTurn(markAborted = true): void {
    const turn = this.activeTurn;
    if (!turn) return;
    if (markAborted) turn.aborted = true;
    if (turn.interrupting) return;
    turn.interrupting = true;

    if (!turn.threadId || !turn.turnId) {
      turn.emit({
        type: 'error',
        message: 'Codex turn interrupt unavailable before turn start completed',
        code: 'codex_turn_interrupt_unavailable',
      });
      return;
    }

    void this.request('turn/interrupt', {
      threadId: turn.threadId,
      turnId: turn.turnId,
    }).catch((e) => {
      if (this.activeTurn !== turn || turn.settled) return;
      turn.emit({
        type: 'error',
        message: `Codex turn interrupt failed: ${(e as Error).message}`,
        code: 'codex_turn_interrupt_failed',
      });
    });
  }

  private resolveActiveTurn(result: RunnerResult): void {
    const turn = this.activeTurn;
    if (!turn || turn.settled) return;
    turn.settled = true;
    this.cleanupApprovals(turn);
    this.activeTurn = null;
    turn.resolve(result);
  }

  private cleanupApprovals(turn: ActiveTurn): void {
    for (const id of turn.pendingApprovalIds) {
      cancelApproval(id);
    }
    turn.pendingApprovalIds.clear();
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private send(message: JsonRpcMessage): void {
    if (!this.child?.stdin || this.child.stdin.destroyed) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(
    method: string,
    requestParams: Record<string, unknown> | undefined,
  ): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ id, method, params: requestParams });
    });
  }

  private handleMessage(message: JsonRpcMessage): void {
    this.lastMessageAt = Date.now();
    if (message.id !== undefined && (message.result !== undefined || message.error)) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) return;
      this.pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'Codex app-server request failed'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message.id, message.method, message.params ?? {});
      return;
    }

    if (!message.method) return;
    this.handleNotification(message.method, message.params ?? {});
  }

  private handleServerRequest(
    requestId: JsonRpcId,
    method: string,
    requestParams: Record<string, unknown>,
  ): void {
    const turn = this.activeTurn;
    if (!turn) {
      this.send({
        id: requestId,
        error: { code: -32000, message: 'No active OpenSpace turn for approval request' },
      });
      return;
    }
    if (
      method !== 'item/commandExecution/requestApproval' &&
      method !== 'item/fileChange/requestApproval' &&
      method !== 'item/permissions/requestApproval'
    ) {
      this.send({
        id: requestId,
        error: { code: -32601, message: `Unsupported Codex server request: ${method}` },
      });
      return;
    }

    const kind = approvalKind(method);
    const title = approvalTitle(method);
    const command = commandFromParams(requestParams);
    const detail = approvalDetail(kind, requestParams);
    const policyAmendment = policyAmendmentFromParams(requestParams);
    const reason =
      typeof requestParams.reason === 'string'
        ? requestParams.reason
        : typeof requestParams.grantRoot === 'string'
          ? `Grant write access to ${requestParams.grantRoot}`
          : undefined;

    const approval = registerApproval({
      kind,
      title,
      command,
      reason,
      policyAmendment,
      decide: (decision) => {
        turn.pendingApprovalIds.delete(approval.id);
        const result = decisionFor(kind, decision, requestParams);
        if (!result) {
          this.send({
            id: requestId,
            error: { code: -32000, message: 'Approval request declined by user' },
          });
          return;
        }
        this.send({ id: requestId, result });
      },
      cancel: () => {
        this.send({ id: requestId, error: { code: -32000, message: 'Approval request canceled' } });
      },
    });
    turn.pendingApprovalIds.add(approval.id);
    turn.emit({
      type: 'approval.required',
      call_id: approval.id,
      title,
      kind,
      command,
      detail,
      reason,
      policyAmendment,
      supported: true,
    });
  }

  private handleNotification(method: string, notificationParams: Record<string, unknown>): void {
    const turn = this.activeTurn;
    if (!turn) return;
    switch (method) {
      case 'turn/started': {
        const startedTurn = notificationParams.turn;
        const threadId = notificationParams.threadId;
        if (typeof threadId === 'string' && threadId) {
          turn.threadId = threadId;
        }
        if (startedTurn && typeof startedTurn === 'object') {
          const turnId = (startedTurn as Record<string, unknown>).id;
          if (typeof turnId === 'string' && turnId) {
            turn.turnId = turnId;
          }
        }
        break;
      }

      case 'item/agentMessage/delta': {
        const delta = notificationParams.delta;
        if (typeof delta === 'string' && delta) turn.emit({ type: 'text.delta', text: delta });
        break;
      }

      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const delta = notificationParams.delta;
        if (typeof delta === 'string' && delta) turn.emit({ type: 'thinking.delta', text: delta });
        break;
      }

      case 'item/started': {
        const item = notificationParams.item;
        if (!item || typeof item !== 'object') break;
        const record = item as Record<string, unknown>;
        if (record.type !== 'commandExecution') break;
        const id = typeof record.id === 'string' ? record.id : `command-${Date.now()}`;
        const command = typeof record.command === 'string' ? record.command : '';
        turn.emit({
          type: 'tool.started',
          call_id: id,
          tool: 'shell',
          args: {
            command,
            cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
          },
        });
        break;
      }

      case 'item/completed': {
        const item = notificationParams.item;
        if (!item || typeof item !== 'object') break;
        const record = item as Record<string, unknown>;
        if (record.type === 'agentMessage') {
          const text = typeof record.text === 'string' ? record.text : '';
          if (text && text !== turn.finalText) turn.emit({ type: 'text.completed', text });
        } else if (record.type === 'commandExecution') {
          const id = typeof record.id === 'string' ? record.id : `command-${Date.now()}`;
          const exitCode = typeof record.exitCode === 'number' ? record.exitCode : undefined;
          const output =
            typeof record.aggregatedOutput === 'string' ? record.aggregatedOutput : undefined;
          turn.emit({
            type: 'tool.completed',
            call_id: id,
            tool: 'shell',
            success: exitCode === undefined || exitCode === 0,
            result: output,
            exit_code: exitCode,
            duration_ms: typeof record.durationMs === 'number' ? record.durationMs : undefined,
          });
        } else if (record.type === 'reasoning') {
          turn.emit({ type: 'thinking.completed' });
        }
        break;
      }

      case 'thread/tokenUsage/updated': {
        const usage = parseContextUsage(notificationParams.tokenUsage);
        if (usage) turn.emit({ type: 'context_usage.updated', usage });
        break;
      }

      case 'token_count': {
        const usage = parseTokenCountInfo(notificationParams.info);
        if (usage) turn.emit({ type: 'context_usage.updated', usage });
        break;
      }

      case 'turn/completed': {
        const completedTurn = notificationParams.turn;
        const status =
          completedTurn && typeof completedTurn === 'object'
            ? (completedTurn as Record<string, unknown>).status
            : undefined;
        if (status === 'interrupted' && !turn.timedOut) {
          turn.aborted = true;
        }
        turn.emit({
          type: 'session.completed',
          duration_ms:
            completedTurn &&
            typeof completedTurn === 'object' &&
            typeof (completedTurn as Record<string, unknown>).durationMs === 'number'
              ? ((completedTurn as Record<string, unknown>).durationMs as number)
              : undefined,
        });
        this.resolveActiveTurn(turn.finish(status === 'completed' ? 0 : 1));
        break;
      }

      case 'error': {
        turn.emit({
          type: 'error',
          message: errorMessageFromNotification(notificationParams),
          code: 'codex_app_server_error',
        });
        break;
      }

      default:
        break;
    }
  }
}

const appServerClients = new Map<string, CodexAppServerClient>();

function appServerKey(params: BuildCommandParams): string {
  return params.codexAppServerKey ?? params.workingDirectory ?? 'default';
}

function getAppServerClient(params: BuildCommandParams): CodexAppServerClient {
  const key = appServerKey(params);
  const existing = appServerClients.get(key);
  if (existing) return existing;
  const client = new CodexAppServerClient(key, params, (disposedKey) => {
    if (appServerClients.get(disposedKey) === client) {
      appServerClients.delete(disposedKey);
    }
  });
  appServerClients.set(key, client);
  return client;
}

export function snapshotCodexAppServers(): {
  active_clients: number;
  busy_clients: number;
} {
  let busy = 0;
  for (const client of appServerClients.values()) {
    if (client.busy) busy += 1;
  }
  return {
    active_clients: appServerClients.size,
    busy_clients: busy,
  };
}

export function listCodexAppServerStatuses(): CodexRuntimeStatus[] {
  const now = Date.now();
  return Array.from(appServerClients.values()).map((client) => client.snapshot(now));
}

export class CodexAppServerAdapter implements CLIAdapter {
  readonly name = 'codex';

  readonly capabilities: AdapterCapabilities = {
    supportsTextDelta: true,
    supportsThinking: true,
    supportsWorkingDirectory: true,
    supportsEnvVars: true,
    supportsModelSelection: true,
    supportsReasoningEffort: true,
    supportsStdinContext: true,
  };

  async checkInstallation() {
    return new Promise<{
      installed: boolean;
      version?: string;
      path?: string;
      error?: string;
    }>((resolve) => {
      const child = spawn('codex', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout?.on('data', (d) => (out += d.toString()));
      child.stderr?.on('data', (d) => (err += d.toString()));
      child.on('error', (e) => resolve({ installed: false, error: e.message }));
      child.on('close', (code) => {
        if (code !== 0) {
          resolve({ installed: false, error: err.trim() || `codex exited ${code}` });
          return;
        }
        const version = out.trim() || undefined;
        const help = spawn('codex', ['app-server', '--help'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let helpErr = '';
        help.stderr?.on('data', (d) => (helpErr += d.toString()));
        help.on('error', (e) => resolve({ installed: false, version, error: e.message }));
        help.on('close', (helpCode) => {
          if (helpCode === 0) {
            resolve({ installed: true, version, path: 'codex app-server' });
          } else {
            resolve({
              installed: false,
              version,
              error: helpErr.trim() || `codex app-server unavailable (${helpCode})`,
            });
          }
        });
      });
    });
  }

  buildCommand(_params: BuildCommandParams): SpawnSpec {
    throw new Error('CodexAppServerAdapter uses runDirect, not buildCommand');
  }

  parseLine(_line: string): CLIEvent[] {
    return [];
  }

  async getSupportedModels(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('codex', ['debug', 'models'], {
        timeout: 5000,
        maxBuffer: 20 * 1024 * 1024,
      });
      const catalog = JSON.parse(stdout) as {
        models?: Array<{ slug?: unknown; visibility?: unknown }>;
      };
      const models =
        catalog.models
          ?.filter((m) => m.visibility === 'list' && typeof m.slug === 'string' && m.slug)
          .map((m) => m.slug as string) ?? [];
      return models.length > 0 ? models : FALLBACK_MODELS;
    } catch {
      return FALLBACK_MODELS;
    }
  }

  async runDirect(params: BuildCommandParams, options: RunnerOptions = {}): Promise<RunnerResult> {
    return getAppServerClient(params).runTurn(params, options);
  }
}

export interface CompactCodexThreadResult {
  ok: boolean;
  threadId: string;
  duration_ms: number;
}

export async function compactCodexThread(input: {
  threadId: string;
  workingDirectory?: string;
  model?: string | null;
}): Promise<CompactCodexThreadResult> {
  const start = Date.now();
  const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
    cwd: input.workingDirectory,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let nextRequestId = 1;
  let stdoutBuf = '';
  const pendingRequests = new Map<
    JsonRpcId,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  let compacted = false;
  let settled = false;
  let lastError = '';

  const send = (message: JsonRpcMessage) => {
    if (!child.stdin || child.stdin.destroyed) return;
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const request = (method: string, requestParams: Record<string, unknown> | undefined) => {
    const id = nextRequestId++;
    return new Promise<unknown>((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      send({ id, method, params: requestParams });
    });
  };

  const cleanup = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };

  const rejectPending = (error: Error) => {
    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }
    pendingRequests.clear();
  };

  const waitForCompaction = () =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for Codex compaction to complete'));
      }, COMPACT_TIMEOUT_MS);
      const poll = () => {
        if (compacted) {
          clearTimeout(timer);
          resolve();
          return;
        }
        if (settled) {
          clearTimeout(timer);
          reject(new Error(lastError || 'Codex app-server exited before compaction completed'));
          return;
        }
        setTimeout(poll, 100);
      };
      poll();
    });

  const handleMessage = (message: JsonRpcMessage) => {
    if (message.id !== undefined && (message.result !== undefined || message.error)) {
      const pending = pendingRequests.get(message.id);
      if (!pending) return;
      pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'Codex app-server request failed'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!message.method) return;
    if (message.method === 'thread/compacted') {
      compacted = true;
      return;
    }
    if (message.method === 'item/completed') {
      const item = message.params?.item;
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        if (record.type === 'contextCompaction') compacted = true;
      }
    }
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf8');
    let idx: number;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        handleMessage(JSON.parse(line) as JsonRpcMessage);
      } catch {
        /* ignore non-json lines */
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) lastError = text.slice(0, 500);
  });

  child.on('error', (err) => {
    lastError = err.message;
    settled = true;
    rejectPending(err);
  });
  child.on('close', () => {
    settled = true;
    rejectPending(new Error(lastError || 'Codex app-server exited'));
  });

  try {
    await request('initialize', {
      clientInfo: {
        name: 'openspace',
        title: 'OpenSpace',
        version: '0.0.1',
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    send({ method: 'initialized' });

    await request('thread/resume', {
      threadId: input.threadId,
      ...(input.workingDirectory ? { cwd: input.workingDirectory } : {}),
      ...(normalizeModel(input.model) ? { model: normalizeModel(input.model) } : {}),
    });
    await request('thread/compact/start', { threadId: input.threadId });
    await waitForCompaction();

    return {
      ok: true,
      threadId: input.threadId,
      duration_ms: Date.now() - start,
    };
  } finally {
    cleanup();
  }
}
