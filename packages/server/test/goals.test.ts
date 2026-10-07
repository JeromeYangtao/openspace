import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Goal, GoalReport } from '@openspace/shared';
import { openProjectDb, closeAllDbs, pinProjectDb, closeProjectDb } from '../src/db/index.js';
import { parseGoalCommand } from '../src/goals/command-parser.js';
import {
  createGoal,
  actionGoal,
  goalRepo,
  queueIteration,
  saveGoal,
  pauseChannelGoals,
} from '../src/goals/service.js';
import { settleGoalIteration, recoverGoals } from '../src/goals/scheduler.js';
import { parseGoalReport, GoalTextStream, REPORT_START, REPORT_END } from '../src/goals/report.js';
import { registerAgentRun, completeAgentRun, abortAgentRun } from '../src/agents/run-manager.js';
const user = { id: 'owner', username: 'owner', display_name: null, role: 'admin' as const };
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openspace-goals-'));
});
afterEach(() => {
  closeAllDbs();
  mock.restoreAll();
  rmSync(root, { recursive: true, force: true });
});
function setup(name = 'one') {
  const db = openProjectDb(join(root, name));
  db.prepare(
    "INSERT INTO channels(id,name,type,created_at) VALUES('ch','general','channel',0)",
  ).run();
  db.prepare(
    "INSERT INTO agents(id,name,runtime,created_at) VALUES('agent','开发','codex',0)",
  ).run();
  db.prepare("INSERT INTO channel_agents VALUES('ch','agent')").run();
  return db;
}
function create(db: ReturnType<typeof setup>, request = 'request') {
  return createGoal(db, user, {
    channel_id: 'ch',
    agent_id: 'agent',
    objective: '实现验证码并测试',
    client_request_id: request,
  });
}
function start(db: ReturnType<typeof setup>, g: Goal, kind?: string) {
  const i = db
    .prepare("SELECT * FROM goal_iterations WHERE goal_id=? AND status='queued'")
    .get(g.id) as { id: string; generation: number };
  assert.ok(i);
  db.prepare(
    "UPDATE goal_iterations SET status='running',started_at=0,kind=COALESCE(?,kind) WHERE id=?",
  ).run(kind ?? null, i.id);
  g.rounds_used++;
  g.status = kind === 'verify' ? 'verifying' : 'running';
  saveGoal(db, g, 'started');
  return i;
}
function report(g: Goal, id: string, outcome: GoalReport['outcome'] = 'completion_candidate') {
  return (
    '结果\n' +
    REPORT_START +
    JSON.stringify({
      schema_version: 1,
      goal_id: g.id,
      iteration_id: id,
      generation: g.generation,
      requirements_revision: g.requirements_revision,
      outcome,
      summary: '实现并完成测试',
      next_action: '验证',
      criteria: g.criteria.map((c) => ({
        ...c,
        state: 'passed',
        evidence: ['tests/login.test.ts: passed'],
      })),
    }) +
    REPORT_END
  );
}
test('Goal syntax only recognizes explicit command positions', () => {
  assert.deepEqual(parseGoalCommand('@开发 /goal 实现验证码'), {
    name: '/goal',
    args: '实现验证码',
    agentNames: ['开发'],
  });
  assert.deepEqual(parseGoalCommand('/goal 实现验证码 @开发'), {
    name: '/goal',
    args: '实现验证码',
    agentNames: ['开发'],
  });
  assert.equal(parseGoalCommand('解释 /goal'), null);
  assert.equal(parseGoalCommand('```\n/goal 实现\n```'), null);
  assert.equal(parseGoalCommand('/goal pause 数据同步')?.args, 'pause 数据同步');
  assert.equal(parseGoalCommand('@one @two /goal 实现')?.agentNames.length, 2);
});
test('creation is idempotent and queues exactly one iteration', () => {
  const db = setup();
  const g = create(db);
  assert.equal(create(db).id, g.id);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM goals').get() as { n: number }).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM goal_iterations').get() as { n: number }).n, 1);
  assert.equal(g.max_rounds, 20);
  assert.equal(g.max_active_ms, 3600000);
});
test('append to a paused Goal saves requirements without resuming', () => {
  const db = setup();
  let g = create(db);
  g = actionGoal(db, user, g.id, { action: 'pause', client_request_id: 'pause' });
  g = actionGoal(db, user, g.id, {
    action: 'update',
    content: '增加过期测试',
    client_request_id: 'update',
  });
  assert.equal(g.status, 'paused');
  assert.deepEqual(g.requirements, ['增加过期测试']);
  assert.equal(g.criteria.length, 2);
  assert.equal(db.prepare("SELECT 1 FROM goal_iterations WHERE status='queued'").get(), undefined);
});
test('update during a run invalidates old completion and queues a new plan only after exit', () => {
  const db = setup();
  const original = create(db);
  const i = start(db, original);
  const updated = actionGoal(db, user, original.id, {
    action: 'update',
    content: '有效期五分钟',
    client_request_id: 'update',
  });
  assert.equal(updated.status, 'pausing');
  assert.equal(db.prepare("SELECT 1 FROM goal_iterations WHERE status='queued'").get(), undefined);
  settleGoalIteration(db, i.id, { ok: true, fullText: report(original, i.id), duration_ms: 50 });
  const g = goalRepo.get(db, original.id)!;
  assert.equal(g.status, 'queued');
  assert.equal(g.criteria[0]?.state, 'pending');
  assert.equal(g.requirements_revision, 2);
  assert.equal(
    (db.prepare("SELECT kind FROM goal_iterations WHERE status='queued'").get() as { kind: string })
      .kind,
    'plan',
  );
});
test('completion requires a separate verification iteration', () => {
  const db = setup();
  let g = create(db);
  let i = start(db, g);
  settleGoalIteration(db, i.id, { ok: true, fullText: report(g, i.id), duration_ms: 50 });
  g = goalRepo.get(db, g.id)!;
  assert.equal(g.status, 'queued');
  i = start(db, g, 'verify');
  settleGoalIteration(db, i.id, { ok: true, fullText: report(g, i.id), duration_ms: 50 });
  assert.equal(goalRepo.get(db, g.id)?.status, 'completed');
  assert.equal(db.prepare("SELECT 1 FROM goal_iterations WHERE status='queued'").get(), undefined);
});
test('cancel during execution cannot be overridden by delayed completion', () => {
  const db = setup();
  const g = create(db);
  const i = start(db, g);
  actionGoal(db, user, g.id, { action: 'cancel', client_request_id: 'cancel' });
  settleGoalIteration(db, i.id, { ok: true, fullText: report(g, i.id), duration_ms: 5 });
  assert.equal(goalRepo.get(db, g.id)?.status, 'cancelled');
});
test('budget exhaustion pauses rather than adding an extra iteration', () => {
  const db = setup();
  const g = create(db);
  g.max_rounds = 1;
  saveGoal(db, g, 'limits');
  const i = start(db, g);
  settleGoalIteration(db, i.id, {
    ok: true,
    fullText: report(g, i.id, 'continue'),
    duration_ms: 5,
  });
  assert.equal(goalRepo.get(db, g.id)?.reason, 'budget_exhausted');
  assert.throws(
    () => actionGoal(db, user, g.id, { action: 'resume', client_request_id: 'resume' }),
    /额度/,
  );
  assert.equal(
    actionGoal(db, user, g.id, { action: 'resume', max_rounds: 2, client_request_id: 'resume2' })
      .status,
    'queued',
  );
});
test('malformed reports get one repair round and then pause', () => {
  const db = setup();
  let g = create(db);
  let i = start(db, g);
  settleGoalIteration(db, i.id, { ok: true, fullText: 'done', duration_ms: 1 });
  g = goalRepo.get(db, g.id)!;
  i = start(db, g);
  settleGoalIteration(db, i.id, { ok: true, fullText: 'done', duration_ms: 1 });
  assert.equal(goalRepo.get(db, g.id)?.reason, 'invalid_report');
});
test('report rejects mismatched identity and omitted criteria', () => {
  const db = setup();
  const g = create(db);
  const text = report(g, 'iteration');
  assert.throws(() => parseGoalReport(text, g, 'other'), /identity/);
  assert.throws(() => parseGoalReport(text.replace('"c1"', '"c2"'), g, 'iteration'), /criterion/);
});
test('internal report marker is filtered even across stream chunks', () => {
  const stream = new GoalTextStream();
  let visible = '';
  for (const char of `hello ${REPORT_START}{"secret":true}${REPORT_END}`)
    visible += stream.push(char);
  assert.equal(visible, 'hello ');
});
test('recovery pauses uncertain running work without replay', () => {
  const db = setup();
  const g = create(db);
  start(db, g);
  recoverGoals(db);
  assert.equal(goalRepo.get(db, g.id)?.reason, 'server_restarted');
  assert.equal(
    db.prepare("SELECT 1 FROM goal_iterations WHERE status IN ('queued','running')").get(),
    undefined,
  );
});
test('stop all pauses queued Goals too', () => {
  const db = setup();
  const g = create(db);
  pauseChannelGoals(db, 'ch');
  assert.equal(goalRepo.get(db, g.id)?.status, 'paused');
});
test('cross-project run ids have independent abort signals', () => {
  const one = setup(),
    two = setup('two');
  for (const db of [one, two])
    db.prepare(
      "INSERT INTO agent_runs(id,agent_id,channel_id,status,started_at) VALUES(1,'agent','ch','working',0)",
    ).run();
  const a = registerAgentRun(one, 1),
    b = registerAgentRun(two, 1);
  abortAgentRun(one, 1);
  assert.equal(a.aborted, true);
  assert.equal(b.aborted, false);
  completeAgentRun(one, 1);
  completeAgentRun(two, 1);
});
test('pinned database cannot close mid execution', () => {
  const db = setup();
  const release = pinProjectDb(db);
  assert.throws(() => closeProjectDb(join(root, 'one')), /active/);
  release();
  closeProjectDb(join(root, 'one'));
  assert.equal(db.open, false);
});
test('optimistic versions and revoked channel access reject mutations', () => {
  const db = setup();
  const g = create(db);
  assert.throws(
    () =>
      actionGoal(db, user, g.id, {
        action: 'pause',
        expected_version: 0,
        client_request_id: 'bad',
      }),
    /更新/,
  );
  db.prepare("UPDATE channels SET name='private' WHERE id='ch'").run();
  assert.throws(
    () =>
      actionGoal(db, { ...user, role: 'member' }, g.id, {
        action: 'pause',
        client_request_id: 'bad2',
      }),
    /无权/,
  );
});
test('a failed runtime can never complete a Goal from its text', () => {
  const db = setup();
  const g = create(db);
  const i = start(db, g);
  settleGoalIteration(db, i.id, {
    ok: false,
    fullText: report(g, i.id),
    duration_ms: 5,
    errorMessage: 'aborted',
  });
  assert.equal(goalRepo.get(db, g.id)?.status, 'failed');
});
test('queue insertion remains unique when scheduler reconciliation repeats', () => {
  const db = setup();
  const g = create(db);
  queueIteration(db, g, 'execute');
  queueIteration(db, g, 'execute');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM goal_iterations').get() as { n: number }).n, 1);
});

test('explicit human acceptance waits for confirmation after verification', () => {
  const db = setup();
  let g = createGoal(db, user, {
    channel_id: 'ch',
    agent_id: 'agent',
    objective: '实现验证码，人工验收',
    client_request_id: 'human',
  });
  let i = start(db, g);
  settleGoalIteration(db, i.id, { ok: true, fullText: report(g, i.id), duration_ms: 1 });
  g = goalRepo.get(db, g.id)!;
  i = start(db, g, 'verify');
  settleGoalIteration(db, i.id, { ok: true, fullText: report(g, i.id), duration_ms: 1 });
  g = goalRepo.get(db, g.id)!;
  assert.equal(g.reason, 'human_verification');
  assert.equal(
    actionGoal(db, user, g.id, { action: 'confirm', client_request_id: 'confirmed' }).status,
    'completed',
  );
});
test('v6 database upgrade creates Goal tables without changing project metadata', () => {
  const db = setup();
  db.prepare("UPDATE meta SET value='6' WHERE key='schema_version'").run();
  closeProjectDb(join(root, 'one'));
  const reopened = openProjectDb(join(root, 'one'));
  assert.equal(
    (
      reopened.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as {
        value: string;
      }
    ).value,
    '7',
  );
  assert.ok(reopened.prepare("SELECT name FROM sqlite_master WHERE name='goals'").get());
  assert.equal((reopened.prepare('SELECT COUNT(*) n FROM agents').get() as { n: number }).n, 1);
});
