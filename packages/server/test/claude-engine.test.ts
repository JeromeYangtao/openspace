import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { openProjectDb, closeAllDbs } from '../src/db/index.js';
import { agentRepo, messageRepo, runtimeSessionRepo } from '../src/db/repos.js';
import { projectsService } from '../src/config/projects-service.js';
import { ClaudeAdapter } from '../src/agents/claude/claude-adapter.js';
import { triggerAgent } from '../src/agents/engine.js';
import type { BuildCommandParams, RunnerOptions } from '../src/agents/types.js';
import type { Project } from '@openspace/shared';

test('engine resumes only the matching project, agent and channel; history is not reinjected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openspace-claude-engine-'));
  const seen: BuildCommandParams[] = [];
  const projects = ['one', 'two'].map(
    (id) => ({ id, workspace_path: join(root, id), name: id }) as Project,
  );
  mock.method(projectsService, 'getByPath', (path: string) =>
    projects.find((p) => p.workspace_path === path),
  );
  mock.method(
    ClaudeAdapter.prototype,
    'runDirect',
    async (params: BuildCommandParams, options: RunnerOptions) => {
      seen.push(params);
      options.onEvent?.({
        type: 'session.started',
        session_id: params.resumeSessionId ?? `session-${seen.length}`,
      });
      return {
        exitCode: 0,
        fullText: 'done',
        events: [],
        duration_ms: 1,
        timedOut: false,
        aborted: false,
      };
    },
  );
  try {
    const dbs = projects.map((project) => {
      const db = openProjectDb(project.workspace_path);
      for (const id of ['a', 'b']) agentRepo.create(db, { id, name: id, runtime: 'claude' });
      for (const id of ['c1', 'c2'])
        db.prepare('INSERT INTO channels (id,name,type,created_at) VALUES (?,?,?,?)').run(
          id,
          id,
          'channel',
          0,
        );
      return db;
    });
    async function run(project: number, agent: string, channel: string, text: string) {
      const db = dbs[project]!;
      const msg = messageRepo.create(db, {
        channel_id: channel,
        sender_type: 'user',
        sender_id: 'local-user',
        content: text,
      });
      const result = await triggerAgent(
        agent,
        { channelId: channel, triggerMessage: msg },
        { db, logger: { info() {}, warn() {}, error() {} } },
      );
      assert.equal(result.ok, true);
    }
    await run(0, 'a', 'c1', 'FIRST UNIQUE PROMPT');
    await run(0, 'a', 'c1', 'SECOND PROMPT');
    await run(0, 'a', 'c2', 'another channel');
    await run(0, 'b', 'c1', 'another agent');
    await run(1, 'a', 'c1', 'another project');
    assert.deepEqual(
      seen.map((p) => p.resumeSessionId),
      [null, 'session-1', null, null, null],
    );
    assert.ok(!seen[1]!.prompt.includes('FIRST UNIQUE PROMPT'));
    assert.equal(seen[4]!.workingDirectory, projects[1]!.workspace_path);
    assert.equal(
      runtimeSessionRepo.get(dbs[0]!, { runtime: 'claude', agent_id: 'a', channel_id: 'c2' }),
      'session-3',
    );
  } finally {
    mock.restoreAll();
    closeAllDbs();
    rmSync(root, { recursive: true, force: true });
  }
});
