import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerInput, forgetInput } from '../src/agents/input-manager.js';

test('input routes authorize callers, validate responses, and do not expose callbacks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openspace-input-routes-'));
  process.env.OPENSPACE_HOME = root;
  const { openAuthDb, closeAuthDb } = await import('../src/auth/db.js');
  const { createSession } = await import('../src/auth/session.js');
  const { agentApprovalRoutes } = await import('../src/routes/agent-approvals.js');
  const app = Fastify();
  let received: unknown;
  const input = registerInput({
    kind: 'questions',
    title: 'Choose',
    blocking: true,
    questions: [
      {
        id: 'q',
        header: 'Q',
        question: 'Choose',
        isOther: false,
        isSecret: true,
        options: [{ label: 'A', description: 'Option' }],
      },
    ],
    respond: (response) => {
      received = response;
    },
  });
  try {
    const db = openAuthDb();
    for (const role of ['admin', 'member']) {
      db.prepare(
        'INSERT INTO users (id,username,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      ).run(role, role, 'test-only', role, 0, 0);
    }
    const admin = { cookie: `openspace_session=${createSession(db, 'admin').token}` };
    const member = { cookie: `openspace_session=${createSession(db, 'member').token}` };
    await app.register(agentApprovalRoutes);
    assert.equal((await app.inject({ url: '/api/agent-inputs' })).statusCode, 403);
    assert.deepEqual((await app.inject({ url: '/api/agent-inputs', headers: member })).json(), []);
    const listed = (await app.inject({ url: '/api/agent-inputs', headers: admin })).json();
    assert.equal(listed[0].id, input.id);
    assert.equal('respond' in listed[0], false);
    const url = `/api/agent-inputs/${input.id}/response`;
    assert.equal(
      (await app.inject({ method: 'POST', url, headers: member, payload: { action: 'cancel' } }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: admin,
          payload: { action: 'accept', answers: { q: ['invalid'] } },
        })
      ).statusCode,
      400,
    );
    assert.equal(received, undefined);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: admin,
          payload: { action: 'accept', answers: { q: ['A'] } },
        })
      ).statusCode,
      200,
    );
    assert.deepEqual(received, { action: 'accept', answers: { q: ['A'] } });
    assert.equal(
      (await app.inject({ method: 'POST', url, headers: admin, payload: { action: 'cancel' } }))
        .statusCode,
      404,
    );
  } finally {
    forgetInput(input.id);
    await app.close();
    closeAuthDb();
    rmSync(root, { recursive: true, force: true });
    delete process.env.OPENSPACE_HOME;
  }
});
