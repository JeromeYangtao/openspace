import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { PROCESS_IDLE_TIMEOUT_MS } from '@openspace/shared';
import {
  cancelApproval,
  registerApproval,
  type ApprovalDecision,
} from './approval-manager.js';
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
  return [path ? `Path: ${path}` : undefined, diff ?? summary].filter(Boolean).join('\n\n') || undefined;
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
      modelContextWindow && modelContextWindow > 0
        ? last.input_tokens / modelContextWindow
        : null,
    context_percent: null,
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
        const help = spawn('codex', ['app-server', '--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
    const start = Date.now();
    const idleTimeoutMs = options.timeoutMs ?? PROCESS_IDLE_TIMEOUT_MS;
    const events: CLIEvent[] = [];
    const pendingApprovalIds = new Set<string>();
    const pendingRequests = new Map<JsonRpcId, {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }>();
    let nextRequestId = 1;
    let stdoutBuf = '';
    let fullText = '';
    let deltaBuffer = '';
    let finalText = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let child: ChildProcess | null = null;
    let resetIdleTimer = () => {};

    const emit = (event: CLIEvent) => {
      resetIdleTimer();
      events.push(event);
      if (event.type === 'text.delta') {
        deltaBuffer += event.text;
        fullText = deltaBuffer;
      } else if (event.type === 'text.completed') {
        finalText = event.text;
        fullText = event.text;
      }
      options.onEvent?.(event);
    };

    const send = (message: JsonRpcMessage) => {
      if (!child?.stdin || child.stdin.destroyed) return;
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const request = (method: string, requestParams: Record<string, unknown> | undefined) => {
      const id = nextRequestId++;
      return new Promise<unknown>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        send({ id, method, params: requestParams });
      });
    };

    const cleanupApprovals = () => {
      for (const id of pendingApprovalIds) {
        cancelApproval(id);
      }
      pendingApprovalIds.clear();
    };

    const finish = (exitCode: number | null): RunnerResult => {
      cleanupApprovals();
      if (!finalText && deltaBuffer) {
        const event: CLIEvent = { type: 'text.completed', text: deltaBuffer };
        events.push(event);
        fullText = deltaBuffer;
        options.onEvent?.(event);
      }
      return {
        exitCode,
        fullText,
        events,
        duration_ms: Date.now() - start,
        timedOut,
        aborted,
      };
    };

    return new Promise<RunnerResult>((resolve) => {
      const abort = (markAborted = true) => {
        if (markAborted) aborted = true;
        try {
          child?.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          try {
            child?.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }, 2000);
      };

      resetIdleTimer = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        timeoutHandle = setTimeout(() => {
          if (pendingApprovalIds.size > 0) {
            resetIdleTimer();
            return;
          }
          timedOut = true;
          abort(false);
        }, idleTimeoutMs);
      };

      const resolveOnce = (result: RunnerResult) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        cleanupApprovals();
        try {
          child?.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        resolve(result);
      };

      const handleMessage = (message: JsonRpcMessage) => {
        resetIdleTimer();
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

        if (message.id !== undefined && message.method) {
          handleServerRequest(message.id, message.method, message.params ?? {});
          return;
        }

        if (!message.method) return;
        handleNotification(message.method, message.params ?? {});
      };

      const handleServerRequest = (
        requestId: JsonRpcId,
        method: string,
        requestParams: Record<string, unknown>,
      ) => {
        if (
          method !== 'item/commandExecution/requestApproval' &&
          method !== 'item/fileChange/requestApproval' &&
          method !== 'item/permissions/requestApproval'
        ) {
          send({
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
            resetIdleTimer();
            pendingApprovalIds.delete(approval.id);
            const result = decisionFor(kind, decision, requestParams);
            if (!result) {
              send({
                id: requestId,
                error: { code: -32000, message: 'Approval request declined by user' },
              });
              return;
            }
            send({ id: requestId, result });
          },
          cancel: () => {
            send({ id: requestId, error: { code: -32000, message: 'Approval request canceled' } });
          },
        });
        pendingApprovalIds.add(approval.id);
        emit({
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
      };

      const handleNotification = (method: string, notificationParams: Record<string, unknown>) => {
        switch (method) {
          case 'item/agentMessage/delta': {
            const delta = notificationParams.delta;
            if (typeof delta === 'string' && delta) emit({ type: 'text.delta', text: delta });
            break;
          }

          case 'item/reasoning/textDelta':
          case 'item/reasoning/summaryTextDelta': {
            const delta = notificationParams.delta;
            if (typeof delta === 'string' && delta) emit({ type: 'thinking.delta', text: delta });
            break;
          }

          case 'item/started': {
            const item = notificationParams.item;
            if (!item || typeof item !== 'object') break;
            const record = item as Record<string, unknown>;
            if (record.type !== 'commandExecution') break;
            const id = typeof record.id === 'string' ? record.id : `command-${Date.now()}`;
            const command = typeof record.command === 'string' ? record.command : '';
            emit({
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
              if (text && text !== finalText) emit({ type: 'text.completed', text });
            } else if (record.type === 'commandExecution') {
              const id = typeof record.id === 'string' ? record.id : `command-${Date.now()}`;
              const exitCode = typeof record.exitCode === 'number' ? record.exitCode : undefined;
              const output =
                typeof record.aggregatedOutput === 'string' ? record.aggregatedOutput : undefined;
              emit({
                type: 'tool.completed',
                call_id: id,
                tool: 'shell',
                success: exitCode === undefined || exitCode === 0,
                result: output,
                exit_code: exitCode,
                duration_ms:
                  typeof record.durationMs === 'number' ? record.durationMs : undefined,
              });
            } else if (record.type === 'reasoning') {
              emit({ type: 'thinking.completed' });
            }
            break;
          }

          case 'thread/tokenUsage/updated': {
            const usage = parseContextUsage(notificationParams.tokenUsage);
            if (usage) emit({ type: 'context_usage.updated', usage });
            break;
          }

          case 'token_count': {
            const usage = parseTokenCountInfo(notificationParams.info);
            if (usage) emit({ type: 'context_usage.updated', usage });
            break;
          }

          case 'turn/completed': {
            const turn = notificationParams.turn;
            const status =
              turn && typeof turn === 'object'
                ? (turn as Record<string, unknown>).status
                : undefined;
            emit({
              type: 'session.completed',
              duration_ms:
                turn && typeof turn === 'object' && typeof (turn as Record<string, unknown>).durationMs === 'number'
                  ? ((turn as Record<string, unknown>).durationMs as number)
                  : undefined,
            });
            resolveOnce(finish(status === 'completed' ? 0 : 1));
            break;
          }

          case 'error': {
            emit({
              type: 'error',
              message: errorMessageFromNotification(notificationParams),
              code: 'codex_app_server_error',
            });
            break;
          }

          default:
            break;
        }
      };

      child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
        cwd: params.workingDirectory,
        env: params.envVars ? { ...process.env, ...params.envVars } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        resetIdleTimer();
        stdoutBuf += chunk.toString('utf8');
        let idx: number;
        while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
          const line = stdoutBuf.slice(0, idx).trim();
          stdoutBuf = stdoutBuf.slice(idx + 1);
          if (!line) continue;
          options.onRawLine?.(line);
          try {
            handleMessage(JSON.parse(line) as JsonRpcMessage);
          } catch (e) {
            emit({
              type: 'error',
              message: `Failed to parse Codex app-server message: ${(e as Error).message}`,
              code: 'codex_app_server_parse_failed',
            });
          }
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        resetIdleTimer();
        for (const line of chunk.toString('utf8').split('\n')) {
          if (line.trim()) options.onStderr?.(line);
        }
      });

      child.on('error', (err) => {
        emit({ type: 'error', message: err.message, code: 'codex_app_server_spawn_failed' });
        resolveOnce(finish(null));
      });

      child.on('close', (code) => {
        if (!settled) {
          emit({
            type: 'error',
            message: timedOut
              ? `Codex app-server timed out after ${idleTimeoutMs}ms without activity`
              : `Codex app-server exited before turn completed${code === null ? '' : ` (${code})`}`,
            code: timedOut ? 'timeout' : 'codex_app_server_exited',
          });
          resolveOnce(finish(code));
        }
      });

      resetIdleTimer();

      if (options.signal) {
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', () => abort(), { once: true });
      }

      void (async () => {
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

          const cwd = params.workingDirectory ?? process.cwd();
          const threadResult = await request(
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
            thread && typeof thread === 'object'
              ? (thread as Record<string, unknown>).id
              : undefined;
          if (typeof threadId !== 'string' || !threadId) {
            throw new Error('Codex app-server did not return a thread id');
          }

          emit({
            type: 'session.started',
            session_id: threadId,
            meta: {
              backend: 'app-server',
              approvalPolicy: 'on-request',
              sandbox: sandboxMode(params),
            },
          });

          await request('turn/start', {
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
          emit({
            type: 'error',
            message: `Codex app-server setup failed: ${(e as Error).message}`,
            code: 'codex_app_server_setup_failed',
          });
          try {
            child?.kill('SIGTERM');
          } catch {
            /* ignore */
          }
          resolveOnce(finish(null));
        }
      })();
    });
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
  const pendingRequests = new Map<JsonRpcId, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
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
