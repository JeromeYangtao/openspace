import assert from 'node:assert/strict';
import test from 'node:test';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  ClaudeAdapter,
  ClaudeEventMapper,
  type ClaudeQuery,
} from '../src/agents/claude/claude-adapter.js';
import { listPendingApprovals, resolveApproval } from '../src/agents/approval-manager.js';
import { listPendingInputs, resolveInput } from '../src/agents/input-manager.js';
import type { CLIEvent } from '../src/agents/types.js';

// An empty override also makes these tests independent of a developer's API key.
const params = { prompt: 'hello', envVars: { ANTHROPIC_API_KEY: '' } };
const message = (value: unknown) => value as SDKMessage;
const success = () =>
  message({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Done',
    duration_ms: 1,
    usage: { input_tokens: 2, output_tokens: 1 },
  });
function fakeQuery(
  run: (options: Options) => AsyncGenerator<SDKMessage>,
  closed = () => {},
): ClaudeQuery {
  return (({ options }: { options: Options }) => {
    const generator = run(options);
    return Object.assign(generator, { close: closed });
  }) as unknown as ClaudeQuery;
}
const context = (signal = new AbortController().signal) => ({
  signal,
  toolUseID: 'tool-1',
  requestId: 'request-1',
});

test('streamed blocks are not replayed; nested text is excluded and tool failures retain IDs', () => {
  const events: CLIEvent[] = [];
  const mapper = new ClaudeEventMapper((e) => events.push(e));
  const stream = (event: unknown) =>
    mapper.accept(message({ type: 'stream_event', parent_tool_use_id: null, event }));
  stream({ type: 'message_start', message: { id: 'm1' } });
  stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } });
  mapper.accept(
    message({
      type: 'assistant',
      message: {
        id: 'm1',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'false' } },
        ],
      },
    }),
  );
  mapper.accept(
    message({
      type: 'assistant',
      parent_tool_use_id: 'nested',
      message: { id: 'child', content: [{ type: 'text', text: 'HIDDEN' }] },
    }),
  );
  mapper.accept(
    message({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'exit 1' }],
      },
    }),
  );
  mapper.accept(success());
  assert.equal(
    events
      .filter((e) => e.type === 'text.delta')
      .map((e) => e.text)
      .join(''),
    'Hello',
  );
  assert.ok(
    events.some(
      (e) => e.type === 'tool.completed' && e.call_id === 't1' && e.tool === 'Bash' && !e.success,
    ),
  );
  assert.ok(events.some((e) => e.type === 'text.completed' && e.text === 'Done'));
});

test('passes explicit session, cwd, model and permissions; final text replaces progress', async () => {
  let closed = false;
  const adapter = new ClaudeAdapter(
    fakeQuery(
      async function* (options) {
        assert.equal(options.resume, 'session-A');
        assert.equal(options.cwd, '/tmp');
        assert.equal(options.model, 'sonnet');
        assert.equal(options.permissionMode, 'auto');
        assert.equal(options.permissionPrompts, undefined);
        assert.equal(options.effort, 'xhigh');
        assert.equal(options.continue, undefined);
        assert.equal(options.allowDangerouslySkipPermissions, undefined);
        yield message({
          type: 'system',
          subtype: 'init',
          session_id: 'session-A',
          model: 'sonnet',
        });
        yield message({
          type: 'assistant',
          message: { id: 'm', content: [{ type: 'text', text: 'Working' }] },
        });
        yield success();
      },
      () => {
        closed = true;
      },
    ),
  );
  const result = await adapter.runDirect({
    ...params,
    resumeSessionId: 'session-A',
    workingDirectory: '/tmp',
    model: 'sonnet',
    reasoning: 'extra-high',
    permissive: true,
  });
  assert.equal(result.fullText, 'Done');
  assert.equal(result.exitCode, 0);
  assert.ok(closed);
});

test('approval and user input roundtrip through existing managers, including rejection', async () => {
  const adapter = new ClaudeAdapter(
    fakeQuery(async function* (options) {
      const allow = await options.canUseTool!(
        'Bash',
        { command: 'echo hi' },
        {
          ...context(),
          suggestions: [
            {
              type: 'addRules',
              rules: [{ toolName: 'Bash', ruleContent: 'echo hi' }],
              behavior: 'allow',
              destination: 'localSettings',
            },
          ],
        },
      );
      assert.equal(allow?.behavior, 'allow');
      if (allow?.behavior === 'allow')
        assert.equal(allow.updatedPermissions?.[0]?.destination, 'session');
      const deny = await options.canUseTool!('Write', { file_path: '/tmp/x' }, context());
      assert.equal(deny?.behavior, 'deny');
      const answer = await options.canUseTool!(
        'AskUserQuestion',
        {
          questions: [
            {
              header: 'Choose',
              question: 'Which?',
              options: [{ label: 'A', description: 'first' }],
            },
          ],
        },
        context(),
      );
      assert.equal(answer?.behavior, 'allow');
      if (answer?.behavior === 'allow')
        assert.deepEqual(answer.updatedInput?.answers, { 'Which?': 'A' });
      yield success();
    }),
  );
  const result = await adapter.runDirect(params, {
    onEvent(event) {
      if (event.type === 'approval.required')
        resolveApproval(
          event.call_id!,
          event.kind === 'command' ? 'approve_for_session' : 'reject',
        );
      if (event.type === 'input.required')
        resolveInput(event.request_id, { action: 'accept', answers: { '0': ['A'] } });
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(listPendingInputs().length, 0);
  assert.equal(listPendingApprovals().length, 0);
});

test('human waits suspend idle timeout; abort clears cards and closes transport', async () => {
  const controller = new AbortController();
  let closed = false;
  const adapter = new ClaudeAdapter(
    fakeQuery(
      async function* (options) {
        await options.canUseTool!('Bash', { command: 'echo hi' }, context());
        if (!options.abortController!.signal.aborted) yield success();
      },
      () => {
        closed = true;
      },
    ),
  );
  const result = await adapter.runDirect(params, {
    signal: controller.signal,
    timeoutMs: 15,
    onEvent(event) {
      if (event.type === 'approval.required') setTimeout(() => controller.abort(), 40);
    },
  });
  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 1);
  assert.equal(listPendingApprovals().length, 0);
  assert.ok(closed);
});

test('timeout and missing terminal result fail; pre-abort never starts SDK', async () => {
  const adapter = new ClaudeAdapter(
    fakeQuery(async function* (options) {
      await new Promise<void>((resolve) =>
        options.abortController!.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
    }),
  );
  assert.equal((await adapter.runDirect(params, { timeoutMs: 10 })).timedOut, true);
  const empty = new ClaudeAdapter(fakeQuery(async function* () {}));
  assert.equal((await empty.runDirect(params)).exitCode, 1);
  const controller = new AbortController();
  controller.abort();
  const never = new ClaudeAdapter((() => {
    throw new Error('must not start');
  }) as ClaudeQuery);
  assert.equal((await never.runDirect(params, { signal: controller.signal })).aborted, true);
});

test('SDK errors are reported; interactive calls in background runs are denied', async () => {
  const adapter = new ClaudeAdapter(
    fakeQuery(async function* (options) {
      assert.equal((await options.canUseTool!('Bash', {}, context()))?.behavior, 'deny');
      yield message({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['authentication failed'],
      });
    }),
  );
  const result = await adapter.runDirect(params);
  assert.equal(result.exitCode, 1);
  assert.ok(result.events.some((e) => e.type === 'error' && e.message === 'authentication failed'));
});

test('uses local Claude login without an API key and preserves credential lookup environment', async () => {
  let called = false;
  const adapter = new ClaudeAdapter(
    fakeQuery(async function* (options) {
      called = true;
      assert.equal(options.env?.ANTHROPIC_API_KEY, '');
      assert.equal(options.env?.HOME, process.env.HOME);
      assert.equal(options.env?.CLAUDE_CONFIG_DIR, '/tmp/openspace-test-claude-config');
      assert.deepEqual(options.settingSources, ['user', 'project', 'local']);
      assert.equal(options.extraArgs?.bare, undefined);
      yield success();
    }),
  );
  const result = await adapter.runDirect({
    ...params,
    envVars: {
      ...params.envVars,
      CLAUDE_CONFIG_DIR: '/tmp/openspace-test-claude-config',
    },
  });
  assert.ok(called);
  assert.equal(result.exitCode, 0);
  assert.equal(result.fullText, 'Done');
});

test('reports actual permission mode when Claude falls back from auto to manual', () => {
  const events: CLIEvent[] = [];
  const mapper = new ClaudeEventMapper((event) => events.push(event));
  mapper.accept(
    message({
      type: 'system',
      subtype: 'init',
      session_id: 'session',
      model: 'opus',
      permissionMode: 'auto',
    }),
  );
  mapper.accept(
    message({ type: 'system', subtype: 'status', status: null, permissionMode: 'default' }),
  );
  const progress = events.filter((event) => event.type === 'progress.updated');
  assert.equal(progress.length, 2);
  assert.match(progress[0]!.summary, /automatic permission review/);
  assert.match(progress[1]!.summary, /default/);
  assert.match(progress[1]!.detail!, /approval cards/);
});

// ----- Background tasks: the run must outlive the first result -----
const init = () => message({ type: 'system', subtype: 'init', session_id: 'S', model: 'opus' });
const tasksChanged = (tasks: Array<{ id: string; description: string; ambient?: boolean }>) =>
  message({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: tasks.map((t) => ({
      task_id: t.id,
      task_type: 'local_bash',
      description: t.description,
      ambient: t.ambient,
    })),
  });
const turnResult = (text: string, input = 2, output = 1) =>
  message({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    duration_ms: 5,
    usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 1 },
  });
const untilAborted = (options: Options) =>
  new Promise<void>((resolve) =>
    options.abortController!.signal.addEventListener('abort', () => resolve(), { once: true }),
  );

test('background task notification wakes a follow-up turn before the run completes', async () => {
  const order: string[] = [];
  const adapter = new ClaudeAdapter(
    fakeQuery(
      async function* () {
        yield init();
        yield tasksChanged([{ id: 'b1', description: 'Wait for markout run' }]);
        yield message({
          type: 'system',
          subtype: 'task_started',
          task_id: 'b1',
          description: 'Wait for markout run',
          is_backgrounded: true,
          task_type: 'local_bash',
        });
        yield turnResult('started');
        order.push('first result consumed');
        await new Promise((r) => setTimeout(r, 30));
        yield message({
          type: 'system',
          subtype: 'task_notification',
          task_id: 'b1',
          status: 'completed',
          output_file: '/tmp/b1.output',
          summary: 'Background command "Wait for markout run" completed',
        });
        yield tasksChanged([]);
        yield init();
        yield turnResult('finished: 42', 3, 2);
        order.push('second result consumed');
      },
      () => order.push('closed'),
    ),
    { resultSettleMs: 1000, backgroundWaitMs: 1000 },
  );
  const events: CLIEvent[] = [];
  const result = await adapter.runDirect(params, { onEvent: (e) => events.push(e), timeoutMs: 10 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.fullText, 'started\n\nfinished: 42');
  assert.deepEqual(order, ['first result consumed', 'second result consumed', 'closed']);
  assert.equal(events.filter((e) => e.type === 'session.started').length, 1);
  const completed = events.filter((e) => e.type === 'session.completed');
  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0]!.type === 'session.completed' && completed[0]!.usage, {
    input_tokens: 5,
    output_tokens: 3,
    cached_input_tokens: 2,
  });
  const progress = events.flatMap((e) => (e.type === 'progress.updated' ? [e.summary] : []));
  assert.ok(progress.includes('Background task started: Wait for markout run'));
  assert.ok(progress.includes('Waiting for 1 background task(s)'));
  assert.ok(progress.some((s) => s.startsWith('Background task completed:')));
  assert.ok(!events.some((e) => e.type === 'error'));
});

test('background wait times out without failing the delivered reply', async () => {
  const adapter = new ClaudeAdapter(
    fakeQuery(async function* (options) {
      yield init();
      yield tasksChanged([{ id: 'b1', description: 'Long job' }]);
      yield turnResult('started');
      await untilAborted(options);
    }),
    { backgroundWaitMs: 20, resultSettleMs: 1000 },
  );
  const result = await adapter.runDirect(params, { timeoutMs: 1000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.fullText, 'started');
  const error = result.events.find((e) => e.type === 'error');
  assert.ok(error && error.type === 'error' && error.code === 'background_timeout');
  assert.equal(error.type === 'error' && error.fatal, false);
  assert.match(error.type === 'error' ? error.message : '', /Long job/);
});

test('a stream left open after a final result is closed after the settle period', async () => {
  let closed = false;
  const adapter = new ClaudeAdapter(
    fakeQuery(
      async function* (options) {
        yield init();
        // Ambient watchers never hold the run open.
        yield tasksChanged([{ id: 'w1', description: 'watcher', ambient: true }]);
        yield turnResult('Done');
        await untilAborted(options);
      },
      () => {
        closed = true;
      },
    ),
    { resultSettleMs: 20, backgroundWaitMs: 5000 },
  );
  const started = Date.now();
  const result = await adapter.runDirect(params, { timeoutMs: 5000 });
  assert.ok(Date.now() - started < 1000);
  assert.ok(closed);
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.aborted, false);
  assert.equal(result.fullText, 'Done');
  assert.ok(!result.events.some((e) => e.type === 'error'));
  assert.equal(result.events.filter((e) => e.type === 'session.completed').length, 1);
});
