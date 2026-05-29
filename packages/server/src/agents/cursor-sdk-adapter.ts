/**
 * Cursor SDK Adapter（Sprint 4 ext / S-1 + S-2）
 *
 * 旁路 adapter：与 `CursorAdapter`（spawn cursor-agent 子进程）并存，使用 `@cursor/sdk`
 * TypeScript SDK 直接调用 Cursor 后端，避开子进程冷启动开销。
 *
 * 启用条件：
 *   - 环境变量 `OPENSPACE_CURSOR_BACKEND=sdk`（默认仍是 `cli`）
 *
 * 实现要点：
 *   - 不走 `buildCommand` / `parseLine`，而是实现 `CLIAdapter.runDirect`
 *   - 把 `SDKMessage` 流映射为 OpenSpace 内部 `CLIEvent` schema（与 cursor-agent 输出兼容）
 *   - `run.cancel()` 替代 `process.kill`（覆盖 cloud / 已挂起进程）
 *   - **Lazy dynamic import**：`@cursor/sdk` 只在用户选 SDK 后端时加载，避免默认 CLI
 *     用户启动时被 SDK 间接依赖（sqlite3 native binding）卡住
 *
 * 参考：
 *   - cursor/cookbook/sdk/coding-agent-cli/src/agent.ts（CodingAgentSession 类）
 *   - docs/cursorsdkadapter.md §S-1 / §S-2
 */

import { PROCESS_TIMEOUT_MS } from '@openspace/shared';
import type {
  AdapterCapabilities,
  BuildCommandParams,
  CLIAdapter,
  CLIEvent,
  RunnerOptions,
  RunnerResult,
  SpawnSpec,
} from './types.js';

// 仅 import type，避免触发 SDK runtime 加载（间接 sqlite3 native binding）
type SdkModule = typeof import('@cursor/sdk');
type SDKMessage = import('@cursor/sdk').SDKMessage;

const DEFAULT_MODEL = 'composer-2';

/**
 * cursor-agent CLI ↔ Cursor SDK 模型 ID 兼容表。
 *
 * cursor-agent 接受 `composer-2-fast` / `auto` 等别名，SDK 严格只接受 `Cursor.models.list()`
 * 返回的 ID（截至 v1.0.10：default / composer-2 / composer-1.5 / gpt-5.x / claude-x / gemini-x / grok-x / kimi-x）。
 *
 * 老 db 里的 agent.model 可能是 cursor-agent 时代留下来的字符串（Team Architect 历史推荐过
 * `composer-2-fast`）。这里在 SDK 模式下做透明映射，避免大批 agent spawn 失败。
 */
const MODEL_ALIASES: Record<string, string> = {
  'composer-2-fast': 'composer-2',
  'composer-2-balanced': 'composer-2',
  auto: 'default',
};

function normalizeModelId(raw?: string | null): string {
  if (!raw) return DEFAULT_MODEL;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_MODEL;
  return MODEL_ALIASES[trimmed] ?? trimmed;
}

function isUnknownModelError(err: Error): boolean {
  return /Cannot use this model/i.test(err.message);
}

/**
 * Sprint 4-ext / Phase A：把 OpenSpace Agent 的 thinking / context / reasoning 字段
 * 拼成 SDK ModelSelection.params 数组（仅当用户显式设置才 emit，跟随 model 默认 → 不 emit）。
 *
 * SDK 会在 model 不支持某个 param 时报错（"unsupported parameter ..."）；目前我们直接透传，
 * 后续可以基于 Cursor.models.list().parameters cache 做客户端校验过滤，但当前的 try/catch
 * fallback 已经覆盖严重失败场景。
 */
function buildModelParams(params: BuildCommandParams): Array<{ id: string; value: string }> {
  const out: Array<{ id: string; value: string }> = [];
  if (params.reasoning && params.reasoning !== '') {
    out.push({ id: 'effort', value: params.reasoning });
  }
  if (params.thinking !== undefined && params.thinking !== null) {
    out.push({ id: 'thinking', value: params.thinking ? 'on' : 'off' });
  }
  if (params.context) {
    out.push({ id: 'context', value: params.context });
  }
  return out;
}

let _sdkPromise: Promise<SdkModule> | null = null;
async function loadSdk(): Promise<SdkModule> {
  if (!_sdkPromise) {
    _sdkPromise = import('@cursor/sdk');
  }
  return _sdkPromise;
}

export class CursorSdkAdapter implements CLIAdapter {
  readonly name = 'cursor-sdk';

  readonly capabilities: AdapterCapabilities = {
    // SDK 已经处理好 stream-partial 的 replay 跳动问题（与 D-12 不同），可启用 text.delta
    supportsTextDelta: true,
    supportsThinking: true,
    supportsWorkingDirectory: true,
    supportsEnvVars: false, // SDK 不像子进程那样接 env 注入；如需可走 local.cwd 下的 .env
    supportsModelSelection: true,
    supportsReasoningEffort: false,
    supportsStdinContext: false, // SDK 一次发完整 prompt，无单独 stdin
  };

  async checkInstallation() {
    const apiKey = process.env.CURSOR_API_KEY;
    if (!apiKey) {
      return { installed: false, error: 'CURSOR_API_KEY not set' };
    }
    try {
      const sdk = await loadSdk();
      // 轻量 auth check：拿当前用户信息
      const me = await sdk.Cursor.me({ apiKey });
      return {
        installed: true,
        version: '@cursor/sdk',
        path: me.userEmail ?? me.apiKeyName ?? 'sdk',
      };
    } catch (e) {
      return { installed: false, error: `Cursor SDK auth failed: ${(e as Error).message}` };
    }
  }

  // ===== 接口要求但不会被调用：runDirect 优先 =====

  buildCommand(_params: BuildCommandParams): SpawnSpec {
    throw new Error(
      'CursorSdkAdapter does not use buildCommand; runWithAdapter dispatches to runDirect',
    );
  }

  parseLine(_line: string): CLIEvent[] {
    return [];
  }

  // ===== 入口 =====

  async getSupportedModels(): Promise<string[]> {
    const apiKey = process.env.CURSOR_API_KEY;
    if (!apiKey) return ['composer-2-fast', 'composer-2', 'auto'];
    try {
      const sdk = await loadSdk();
      const list = await sdk.Cursor.models.list({ apiKey });
      return list.map((m) => m.id);
    } catch {
      return ['composer-2-fast', 'composer-2', 'auto'];
    }
  }

  async runDirect(params: BuildCommandParams, options: RunnerOptions = {}): Promise<RunnerResult> {
    const start = Date.now();
    const events: CLIEvent[] = [];
    let fullText = '';
    let textDelta = '';
    let timedOut = false;
    let aborted = false;

    const emit = (e: CLIEvent) => {
      events.push(e);
      if (e.type === 'text.delta') {
        textDelta += e.text;
        fullText = textDelta;
      } else if (e.type === 'text.completed') {
        fullText = e.text;
      }
      options.onEvent?.(e);
    };

    const apiKey = process.env.CURSOR_API_KEY;
    if (!apiKey) {
      emit({
        type: 'error',
        message: 'CURSOR_API_KEY not set; cannot use CursorSdkAdapter',
        code: 'no_api_key',
      });
      return {
        exitCode: null,
        fullText,
        events,
        duration_ms: Date.now() - start,
        timedOut: false,
        aborted: false,
      };
    }

    const timeoutMs = options.timeoutMs ?? PROCESS_TIMEOUT_MS;

    let sdk: SdkModule;
    try {
      sdk = await loadSdk();
    } catch (e) {
      emit({
        type: 'error',
        message: `failed to load @cursor/sdk: ${(e as Error).message}`,
        code: 'sdk_load_failed',
      });
      return {
        exitCode: null,
        fullText,
        events,
        duration_ms: Date.now() - start,
        timedOut: false,
        aborted: false,
      };
    }

    let agent: Awaited<ReturnType<SdkModule['Agent']['create']>> | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let cancelOnAbort: (() => void) | null = null;

    try {
      // 模型 ID 解析 + auto-fallback：SDK 拒绝的 model 自动重试 'default'，让用户的 agent
      // 总能跑起来（哪怕配了一个 SDK 不识别的 ID，也只是降级到 default），不再硬挂。
      const requestedModel = normalizeModelId(params.model);
      const modelParams = buildModelParams(params);
      let actualModel = requestedModel;
      try {
        agent = await sdk.Agent.create({
          apiKey,
          model: {
            id: requestedModel,
            ...(modelParams.length > 0 ? { params: modelParams } : {}),
          },
          ...(params.workingDirectory ? { local: { cwd: params.workingDirectory } } : {}),
        });
      } catch (e) {
        const err = e as Error;
        if (isUnknownModelError(err) && requestedModel !== 'default') {
          // 第二次机会：用 default 再试（保留 params；SDK 通常会忽略不支持的）
          actualModel = 'default';
          try {
            agent = await sdk.Agent.create({
              apiKey,
              model: {
                id: 'default',
                ...(modelParams.length > 0 ? { params: modelParams } : {}),
              },
              ...(params.workingDirectory ? { local: { cwd: params.workingDirectory } } : {}),
            });
            // 软警告事件 + 继续 — 不阻断
            emit({
              type: 'error',
              message: `Model "${params.model}" not supported by Cursor SDK; fell back to "default". Update agent settings to silence this warning.`,
              code: 'sdk_model_fallback',
              recoverable: true,
            });
          } catch (e2) {
            emit({
              type: 'error',
              message: `Agent.create failed (both "${requestedModel}" and "default"): ${(e2 as Error).message}`,
              code: 'sdk_create_failed',
            });
            return {
              exitCode: null,
              fullText,
              events,
              duration_ms: Date.now() - start,
              timedOut: false,
              aborted: false,
            };
          }
        } else {
          emit({
            type: 'error',
            message: `Agent.create failed: ${err.message}`,
            code: 'sdk_create_failed',
          });
          return {
            exitCode: null,
            fullText,
            events,
            duration_ms: Date.now() - start,
            timedOut: false,
            aborted: false,
          };
        }
      }
      // ESLint：actualModel 在 fallback 路径已被使用（emit 内嵌字符串），保留以便未来扩展
      void actualModel;

      const run = await agent.send(params.prompt);

      timeoutHandle = setTimeout(() => {
        timedOut = true;
        run.cancel().catch(() => {
          /* ignore */
        });
      }, timeoutMs);

      if (options.signal) {
        if (options.signal.aborted) {
          aborted = true;
          run.cancel().catch(() => {
            /* ignore */
          });
        } else {
          const onAbort = () => {
            aborted = true;
            run.cancel().catch(() => {
              /* ignore */
            });
          };
          options.signal.addEventListener('abort', onAbort, { once: true });
          cancelOnAbort = () => options.signal!.removeEventListener('abort', onAbort);
        }
      }

      // 累加 SDK 流中所有 assistant text block（按 SDK 文档示例语义增量输出）。
      // 一个 turn 可能有多个 SDKAssistantMessage，每个 content 是该时间点的增量片段。
      let assistantBuf = '';

      try {
        for await (const msg of run.stream()) {
          this.mapSdkMessage(msg, emit, (delta) => {
            assistantBuf += delta;
          });
        }
        const result = await run.wait();

        // 优先用 run.wait().result（如果 SDK 提供了），否则 fallback 到流累加。
        // v1.0.10 实测 result.result 偶尔为 undefined，必须 fallback。
        const finalText =
          typeof result.result === 'string' && result.result.length > 0
            ? result.result
            : assistantBuf;
        if (finalText) {
          emit({ type: 'text.completed', text: finalText });
        }

        emit({
          type: 'session.completed',
          duration_ms: result.durationMs,
        });
        return {
          exitCode: result.status === 'finished' ? 0 : 1,
          fullText,
          events,
          duration_ms: Date.now() - start,
          timedOut,
          aborted,
        };
      } catch (e) {
        emit({
          type: 'error',
          message: `SDK run failed: ${(e as Error).message}`,
          code: 'sdk_run_failed',
        });
        return {
          exitCode: null,
          fullText,
          events,
          duration_ms: Date.now() - start,
          timedOut,
          aborted,
        };
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (cancelOnAbort) cancelOnAbort();
      if (agent) {
        try {
          await agent[Symbol.asyncDispose]?.();
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * 把 SDK 标准化 SDKMessage 流映射为 OpenSpace 内部 CLIEvent。
   *
   * S-2：SDKToolUseMessage 直接给 { name, args, result, status, truncated }，避免
   * CursorAdapter 里依赖 `xxxToolCall` 后缀的脆弱解析。
   *
   * @param onAssistantText 收集流式 assistant text 增量（SDK 文档示例语义：每个 block
   *   按字符串顺序累加输出）。runDirect 用累加结果 fallback `RunResult.result` 为空的情况。
   */
  private mapSdkMessage(
    msg: SDKMessage,
    emit: (e: CLIEvent) => void,
    onAssistantText: (delta: string) => void,
  ): void {
    switch (msg.type) {
      case 'system':
        emit({
          type: 'session.started',
          session_id: msg.run_id,
          meta: {
            model: msg.model,
            tools: msg.tools,
          },
        });
        break;

      case 'thinking':
        if (msg.text) {
          emit({ type: 'thinking.delta', text: msg.text });
        }
        break;

      case 'assistant': {
        // SDK 文档（cursor.com/docs/sdk/typescript）的 stream 示例直接 process.stdout.write(block.text)
        // 累加输出，说明每个 text block 是该 turn 的增量片段。我们累加到 onAssistantText 收集器，
        // 不在流中 emit text.completed（避免上层 supportsTextDelta=true 模式覆盖 fullText）。
        // 最终 fullText 在 runDirect 里用 RunResult.result 优先、累加值 fallback 的方式产生。
        // tool_use blocks 已由独立的 'tool_call' SDKMessage 覆盖，这里不处理。
        const blocks = msg.message.content ?? [];
        for (const block of blocks) {
          if (block.type === 'text' && block.text) {
            onAssistantText(block.text);
          }
        }
        break;
      }

      case 'tool_call': {
        const args =
          msg.args && typeof msg.args === 'object' ? (msg.args as Record<string, unknown>) : {};
        if (msg.status === 'running') {
          emit({
            type: 'tool.started',
            call_id: msg.call_id,
            tool: msg.name,
            args,
          });
        } else {
          // completed / error
          const success = msg.status === 'completed';
          let resultStr = '';
          if (typeof msg.result === 'string') {
            resultStr = msg.result;
          } else if (msg.result !== undefined) {
            try {
              resultStr = JSON.stringify(msg.result).slice(0, 500);
            } catch {
              resultStr = '[unserializable]';
            }
          }
          if (msg.truncated?.result) {
            resultStr = `${resultStr} [truncated]`;
          }
          emit({
            type: 'tool.completed',
            call_id: msg.call_id,
            tool: msg.name,
            success,
            result: resultStr,
          });
        }
        break;
      }

      case 'status':
        // SDK 内部状态变化（CREATING / RUNNING / FINISHED / ERROR / CANCELLED / EXPIRED）
        // 仅在 ERROR 时映射为 CLIEvent.error
        if (msg.status === 'ERROR') {
          emit({
            type: 'error',
            message: msg.message ?? 'SDK reported ERROR status',
            code: 'sdk_status_error',
          });
        }
        break;

      // user / task / 其他类型暂不映射（会被 session.started/completed 覆盖）
      default:
        break;
    }
  }
}
