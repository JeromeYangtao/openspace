import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, mock } from 'node:test';
import Fastify from 'fastify';
import type { Project } from '@openspace/shared';
test('Goal REST validates membership, idempotency, versions, and requirement appends', async () => {
  const root = mkdtempSync(join(tmpdir(), 'goal-routes-'));
  process.env.OPENSPACE_HOME = join(root, 'auth');
  const { openAuthDb, closeAuthDb } = await import('../src/auth/db.js');
  const { createSession } = await import('../src/auth/session.js');
  const { openProjectDb, closeAllDbs } = await import('../src/db/index.js');
  const { projectsService } = await import('../src/config/projects-service.js');
  const { goalRoutes } = await import('../src/routes/goals.js');
  const { routeUserMessage } = await import('../src/messaging/router.js');
  const { goalRepo } = await import('../src/goals/service.js');
  const p: Project = {
    id: 'p',
    name: 'p',
    workspace_path: join(root, 'project'),
    display_name: null,
    goal: '',
    team_rules: null,
    color: null,
    created_at: 0,
  };
  mock.method(projectsService, 'getById', () => p);
  mock.method(projectsService, 'getByPath', () => p);
  const app = Fastify();
  const auth = openAuthDb();
  const db = openProjectDb(p.workspace_path);
  try {
    for (const id of ['owner', 'visitor'])
      auth
        .prepare(
          'INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)',
        )
        .run(id, id, 'test', 'member');
    db.prepare(
      "INSERT INTO channels(id,name,type,created_at) VALUES('ch','private','channel',0)",
    ).run();
    db.prepare("INSERT INTO agents(id,name,runtime,created_at) VALUES('a','dev','codex',0)").run();
    db.prepare("INSERT INTO channel_agents VALUES('ch','a')").run();
    db.prepare("INSERT INTO channel_users VALUES('ch','owner')").run();
    const owner = { cookie: `openspace_session=${createSession(auth, 'owner').token}` },
      visitor = { cookie: `openspace_session=${createSession(auth, 'visitor').token}` };
    await app.register(goalRoutes);
    const url = '/api/projects/p/channels/ch/goals';
    const payload = { objective: '实现测试', agent_id: 'a', client_request_id: 'create' };
    assert.equal(
      (await app.inject({ method: 'POST', url, headers: visitor, payload })).statusCode,
      403,
    );
    const response = await app.inject({ method: 'POST', url, headers: owner, payload });
    assert.equal(response.statusCode, 200);
    const goal = response.json();
    assert.equal(
      (await app.inject({ method: 'POST', url, headers: owner, payload })).json().id,
      goal.id,
    );
    const actionUrl = `/api/projects/p/goals/${goal.id}/actions`;
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: actionUrl,
          headers: owner,
          payload: { action: 'pause', expected_version: 0, client_request_id: 'wrong' },
        })
      ).statusCode,
      409,
    );
    const result = await app.inject({
      method: 'POST',
      url: actionUrl,
      headers: owner,
      payload: {
        action: 'update',
        content: '补上过期测试',
        expected_version: goal.version,
        client_request_id: 'update',
      },
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json().requirements, ['补上过期测试']);
    await routeUserMessage(
      {
        channelId: 'ch',
        threadId: goal.thread_root_id,
        content: '有效期五分钟',
        clientRequestId: 'thread-update',
      },
      { db, userId: 'owner', logger: { info: () => {}, warn: () => {}, error: () => {} } },
    );
    assert.deepEqual(goalRepo.get(db, goal.id)?.requirements, ['补上过期测试', '有效期五分钟']);
    assert.equal(
      (await app.inject({ url: `/api/projects/p/goals/${goal.id}`, headers: visitor })).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ url: `/api/projects/p/goals/${goal.id}/events`, headers: owner }))
        .statusCode,
      200,
    );
  } finally {
    await app.close();
    closeAllDbs();
    closeAuthDb();
    mock.restoreAll();
    rmSync(root, { recursive: true, force: true });
  }
});
