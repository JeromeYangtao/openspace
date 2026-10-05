import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { resolveApproval } from '../src/agents/approval-manager.js';
import { CodexAppServerAdapter } from '../src/agents/codex/codex-app-server-adapter.js';

// Exercise the actual JSON-RPC transport without executing commands or contacting a model.
const fakeServer = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const complete = () => {
  send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
  process.stdout.write('', () => process.exit(0));
};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  fs.appendFileSync(process.env.REQUEST_LOG, line + '\\n');
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  if (message.method === 'thread/start' || message.method === 'thread/resume') {
    send({ id: message.id, result: { thread: { id: 'thread-test' } } });
  }
  if (message.method === 'turn/start') {
    send({ id: message.id, result: {} });
    if (process.env.REQUEST_APPROVAL === 'true') {
      send({ id: 'approval-test', method: 'item/commandExecution/requestApproval',
        params: { command: 'example-command', reason: 'Explicit permission required' } });
    } else complete();
  }
  if (message.id === 'approval-test') complete();
});
`;

for (const scenario of [
  { name: 'new thread', resume: false, permissive: true, reviewer: 'auto_review' },
  { name: 'resumed thread', resume: true, permissive: true, reviewer: 'auto_review' },
  { name: 'read-only thread', resume: false, permissive: false, reviewer: 'auto_review' },
  { name: 'manual review override', resume: false, permissive: true, reviewer: 'user' },
] as const) {
  test(`Codex approval policy: ${scenario.name}`, { timeout: 10_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'openspace-approval-'));
    const log = join(root, 'requests.jsonl');
    writeFileSync(join(root, 'codex'), fakeServer, { mode: 0o755 });
    try {
      const result = await new CodexAppServerAdapter().runDirect(
        {
          prompt: 'Do the requested work',
          workingDirectory: root,
          codexAppServerKey: root,
          permissive: scenario.permissive,
          resumeSessionId: scenario.resume ? 'thread-test' : undefined,
          envVars: {
            PATH: `${root}${delimiter}${process.env.PATH}`,
            REQUEST_LOG: log,
            REQUEST_APPROVAL: 'true',
            // Empty selects the default regardless of the developer's environment.
            OPENSPACE_CODEX_APPROVALS_REVIEWER: scenario.reviewer === 'user' ? 'user' : '',
          },
        },
        {
          onEvent(event) {
            if (event.type === 'approval.required' && event.call_id) {
              assert.equal(resolveApproval(event.call_id, 'approve_for_session'), true);
            }
          },
        },
      );
      assert.equal(result.exitCode, 0);
      const requests = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const thread = requests.find(
        (r) => r.method === (scenario.resume ? 'thread/resume' : 'thread/start'),
      );
      const turn = requests.find((r) => r.method === 'turn/start');
      for (const request of [thread, turn]) {
        assert.equal(request.params.approvalPolicy, 'on-request');
        assert.equal(request.params.approvalsReviewer, scenario.reviewer);
      }
      assert.equal(thread.params.sandbox, scenario.permissive ? 'workspace-write' : 'read-only');
      assert.equal(turn.params.sandboxPolicy.networkAccess, false);
      if (scenario.permissive) assert.deepEqual(turn.params.sandboxPolicy.writableRoots, [root]);
      else assert.equal(turn.params.sandboxPolicy.type, 'readOnly');
      assert.deepEqual(requests.find((r) => r.id === 'approval-test').result, {
        decision: 'acceptForSession',
      });
      const started = result.events.find((event) => event.type === 'session.started');
      assert.equal(started?.meta?.approvalsReviewer, scenario.reviewer);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
