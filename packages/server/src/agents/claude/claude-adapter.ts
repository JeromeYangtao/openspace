import { DEFAULT_RUNTIME_MODELS } from '@openspace/shared';
import type {
  CanUseTool,
  Options,
  PermissionResult,
  SDKMessage,
  query,
} from '@anthropic-ai/claude-agent-sdk';
import { PROCESS_IDLE_TIMEOUT_MS, type AgentInputResponse } from '@openspace/shared';
import { registerApproval, forgetApproval } from '../approval-manager.js';
import { registerInput, forgetInput } from '../input-manager.js';
import type {
  BuildCommandParams,
  CLIAdapter,
  CLIEvent,
  RunnerOptions,
  RunnerResult,
  SpawnSpec,
} from '../types.js';

// Injectable transport keeps protocol tests independent of credentials and paid model calls.
export type ClaudeQuery = typeof query;
export class ClaudeAdapter implements CLIAdapter {
  readonly name = 'claude';
  readonly capabilities = {
    supportsTextDelta: true,
    supportsThinking: true,
    supportsWorkingDirectory: true,
    supportsEnvVars: true,
    supportsModelSelection: true,
    supportsReasoningEffort: true,
    supportsStdinContext: true,
  };
  constructor(private readonly queryFactory?: ClaudeQuery) {}

  async checkInstallation() {
    try {
      await import('@anthropic-ai/claude-agent-sdk');
      return {
        installed: true,
        version: 'Claude Agent SDK 0.3.318',
        path: '@anthropic-ai/claude-agent-sdk',
      };
    } catch (error) {
      return { installed: false, error: String(error) };
    }
  }
  buildCommand(): SpawnSpec {
    throw new Error('ClaudeAdapter uses runDirect');
  }
  parseLine(): CLIEvent[] {
    return [];
  }
  async getSupportedModels() {
    return [DEFAULT_RUNTIME_MODELS.claude!, 'sonnet', 'opus', 'haiku'];
  }

  async runDirect(params: BuildCommandParams, options: RunnerOptions = {}): Promise<RunnerResult> {
    const start = Date.now();
    const events: CLIEvent[] = [];
    let fullText = '';
    let exitCode = 1;
    let timedOut = false;
    let aborted = false;
    let receivedResult = false;
    const controller = new AbortController();
    let stream: ReturnType<ClaudeQuery> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<() => void>();
    let waiting = 0;
    const emit = (event: CLIEvent) => {
      events.push(event);
      if (event.type === 'text.delta') fullText += event.text;
      if (event.type === 'text.completed') fullText = event.text;
      options.onEvent?.(event);
    };
    const stop = () => {
      controller.abort();
      for (const cancel of [...pending]) cancel();
      stream?.close();
    };
    const resetTimer = () => {
      clearTimeout(timer);
      if (!waiting && !controller.signal.aborted)
        timer = setTimeout(() => {
          timedOut = true;
          stop();
        }, options.timeoutMs ?? PROCESS_IDLE_TIMEOUT_MS);
    };
    const onAbort = () => {
      aborted = true;
      stop();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    // Each permission/input wait owns its cleanup, including SDK-side cancellation.
    const waitFor = <T>(
      signal: AbortSignal,
      cancelled: T,
      register: (finish: (value: T) => void) => () => void,
    ): Promise<T> => {
      if (signal.aborted || controller.signal.aborted) return Promise.resolve(cancelled);
      waiting++;
      clearTimeout(timer);
      return new Promise<T>((resolve) => {
        let done = false;
        let cleanup: (() => void) | undefined;
        const finish = (value: T) => {
          if (done) return;
          done = true;
          cleanup?.();
          signal.removeEventListener('abort', cancel);
          pending.delete(cancel);
          waiting--;
          resetTimer();
          resolve(value);
        };
        const cancel = () => finish(cancelled);
        pending.add(cancel);
        signal.addEventListener('abort', cancel, { once: true });
        cleanup = register(finish);
        if (done) cleanup(); // onEvent may synchronously resolve the card.
      });
    };
    const deny: PermissionResult = { behavior: 'deny', message: 'Request cancelled or declined' };
    const canUseTool: CanUseTool = async (tool, input, context) => {
      // Background system agents have no interactive event consumer.
      if (!options.onEvent)
        return { behavior: 'deny', message: 'Interactive approval is unavailable for this run' };
      if (tool === 'AskUserQuestion') {
        const raw = input.questions as Array<{
          question: string;
          header?: string;
          options?: Array<{ label: string; description?: string }>;
        }>;
        if (!Array.isArray(raw) || !raw.length || raw.some((q) => typeof q.question !== 'string'))
          return deny;
        const response = await waitFor<AgentInputResponse>(
          context.signal,
          { action: 'cancel' },
          (finish) => {
            const request = registerInput({
              kind: 'questions',
              title: 'Claude needs your input',
              blocking: true,
              questions: raw.map((q, i) => ({
                id: String(i),
                header: q.header ?? 'Question',
                question: q.question,
                isOther: true,
                isSecret: false,
                options:
                  q.options?.map((o) => ({ label: o.label, description: o.description ?? '' })) ??
                  null,
              })),
              respond: finish,
            });
            emit({
              type: 'input.required',
              request_id: request.id,
              title: request.title,
              blocking: true,
            });
            return () => {
              forgetInput(request.id);
              emit({ type: 'input.resolved', request_id: request.id });
            };
          },
        );
        if (response.action !== 'accept') return deny;
        return {
          behavior: 'allow',
          updatedInput: {
            ...input,
            answers: Object.fromEntries(
              raw.map((q, i) => [q.question, response.answers?.[String(i)]?.join(', ') ?? '']),
            ),
          },
        };
      }
      return waitFor<PermissionResult>(context.signal, deny, (finish) => {
        const request = registerApproval({
          kind:
            tool === 'Bash'
              ? 'command'
              : /^(Write|Edit|NotebookEdit)$/.test(tool)
                ? 'file_change'
                : 'permissions',
          title: `Claude: ${tool}`,
          command: typeof input.command === 'string' ? input.command : undefined,
          reason: context.decisionReason,
          decide: (decision) => {
            if (decision === 'approve' || decision === 'approve_for_session') {
              finish({
                behavior: 'allow',
                updatedInput: input,
                // Never persist SDK suggestions to project settings without a separate explicit action.
                updatedPermissions:
                  decision === 'approve_for_session'
                    ? context.suggestions?.map((update) => ({
                        ...update,
                        destination: 'session' as const,
                      }))
                    : undefined,
              });
            } else finish(deny);
          },
          cancel: () => finish(deny),
        });
        emit({
          type: 'approval.required',
          call_id: request.id,
          title: request.title,
          kind: request.kind,
          command: request.command,
          reason: request.reason,
          detail: JSON.stringify(input),
          supported: true,
        });
        return () => forgetApproval(request.id);
      });
    };
    try {
      if (options.signal?.aborted) onAbort();
      if (controller.signal.aborted) return result();
      const env = { ...process.env, ...params.envVars };
      // Let Claude Code resolve credentials, including the current user's CLI login.
      // Preserve HOME / CLAUDE_CONFIG_DIR and never require or copy credentials here.
      const queryFn = this.queryFactory ?? (await import('@anthropic-ai/claude-agent-sdk')).query;
      const effort = params.reasoning === 'extra-high' ? 'xhigh' : params.reasoning;
      const sdkOptions: Options = {
        cwd: params.workingDirectory,
        env,
        model: params.model?.trim() || DEFAULT_RUNTIME_MODELS.claude,
        resume: params.resumeSessionId || undefined,
        abortController: controller,
        includePartialMessages: true,
        permissionMode: 'default',
        canUseTool,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: ['user', 'project', 'local'],
        stderr: (line) => {
          resetTimer();
          options.onStderr?.(line);
        },
        ...(effort && ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)
          ? { effort: effort as Options['effort'] }
          : {}),
        ...(params.thinking != null
          ? { thinking: { type: params.thinking ? ('adaptive' as const) : ('disabled' as const) } }
          : {}),
      };
      if (params.context)
        emit({
          type: 'progress.updated',
          source: 'claude',
          summary: 'Context size uses the selected Claude model default',
        });
      resetTimer();
      stream = queryFn({
        prompt: [params.stdinContext, params.prompt].filter(Boolean).join('\n\n'),
        options: sdkOptions,
      });
      const mapper = new ClaudeEventMapper(emit);
      for await (const message of stream) {
        resetTimer();
        mapper.accept(message);
        if (message.type === 'result') {
          receivedResult = true;
          exitCode = message.subtype === 'success' && !message.is_error ? 0 : 1;
          break;
        }
      }
      if (!receivedResult && !controller.signal.aborted)
        throw new Error('Claude exited without a result');
    } catch (error) {
      if (!controller.signal.aborted)
        emit({
          type: 'error',
          code: 'claude_run_failed',
          message: (error as Error).message,
          fatal: true,
        });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      // Abort before clearing callbacks so cleanup cannot restart the idle timer.
      controller.abort();
      for (const cancel of [...pending]) cancel();
      stream?.close();
      if (timedOut || aborted)
        emit({
          type: 'error',
          code: timedOut ? 'timeout' : 'aborted',
          message: timedOut ? 'Claude timed out without activity' : 'Claude stopped by user',
          fatal: true,
        });
    }
    return result();
    function result(): RunnerResult {
      return {
        exitCode: aborted || timedOut ? 1 : exitCode,
        fullText,
        events,
        duration_ms: Date.now() - start,
        timedOut,
        aborted,
      };
    }
  }
}

/** Per-run state: never share streamed block IDs across agents or channels. */
export class ClaudeEventMapper {
  private streamed = new Set<string>();
  private messageId = '';
  private tools = new Map<string, string>();
  constructor(private readonly emit: (event: CLIEvent) => void) {}
  accept(msg: SDKMessage): void {
    if (msg.type === 'system' && msg.subtype === 'init') {
      this.emit({
        type: 'session.started',
        session_id: msg.session_id,
        meta: { model: msg.model },
      });
    } else if (msg.type === 'stream_event' && !msg.parent_tool_use_id) {
      const event = msg.event;
      if (event.type === 'message_start') this.messageId = event.message.id;
      if (event.type === 'content_block_delta') {
        const key = `${this.messageId}:${event.index}`;
        if (event.delta.type === 'text_delta') {
          this.streamed.add(key);
          this.emit({ type: 'text.delta', text: event.delta.text, item_id: key });
        } else if (event.delta.type === 'thinking_delta') {
          this.streamed.add(key);
          this.emit({ type: 'thinking.delta', text: event.delta.thinking, item_id: key });
        }
      }
    } else if (msg.type === 'assistant') {
      msg.message.content.forEach((block, i) => {
        const key = `${msg.message.id}:${i}`;
        if (block.type === 'tool_use') {
          if (!this.tools.has(block.id))
            this.emit({
              type: 'tool.started',
              call_id: block.id,
              tool: block.name,
              args: block.input as Record<string, unknown>,
            });
          this.tools.set(block.id, block.name);
        } else if (!msg.parent_tool_use_id && !this.streamed.has(key)) {
          if (block.type === 'text')
            this.emit({ type: 'text.delta', text: block.text, item_id: key });
          if (block.type === 'thinking')
            this.emit({ type: 'thinking.delta', text: block.thinking, item_id: key });
          this.streamed.add(key);
        }
      });
    } else if (msg.type === 'user' && Array.isArray(msg.message.content)) {
      for (const block of msg.message.content)
        if (block.type === 'tool_result') {
          this.emit({
            type: 'tool.completed',
            call_id: block.tool_use_id,
            tool: this.tools.get(block.tool_use_id) ?? 'tool',
            success: !block.is_error,
            result:
              typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          });
        }
    } else if (msg.type === 'result') {
      if (msg.subtype === 'success' && !msg.is_error) {
        this.emit({ type: 'text.completed', text: msg.result });
        this.emit({
          type: 'session.completed',
          duration_ms: msg.duration_ms,
          usage: {
            input_tokens: msg.usage.input_tokens,
            output_tokens: msg.usage.output_tokens,
            cached_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
          },
        });
      } else
        this.emit({
          type: 'error',
          code: 'claude_result_error',
          fatal: true,
          message: msg.subtype === 'success' ? msg.result : msg.errors.join('\n'),
        });
    }
  }
}
