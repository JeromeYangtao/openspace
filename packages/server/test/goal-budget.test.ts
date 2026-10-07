import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, mock } from 'node:test';
import type { Project } from '@openspace/shared';
test(
  'scheduler interrupts a turn at the active time limit and never queues continuation',
  { timeout: 10000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'goal-budget-'));
    process.env.OPENSPACE_HOME = join(root, 'auth');
    const { openAuthDb, closeAuthDb } = await import('../src/auth/db.js');
    const { openProjectDb, closeAllDbs } = await import('../src/db/index.js');
    const { projectsService } = await import('../src/config/projects-service.js');
    const { createGoal, goalRepo } = await import('../src/goals/service.js');
    const { claimGoalIteration, runGoalIteration } = await import('../src/goals/scheduler.js');
    const { disposeCodexAppServers } =
      await import('../src/agents/codex/codex-app-server-adapter.js');
    const p: Project = {
      id: 'p',
      name: 'p',
      workspace_path: root,
      display_name: null,
      goal: '',
      team_rules: null,
      color: null,
      created_at: 0,
    };
    mock.method(projectsService, 'list', () => [p]);
    mock.method(projectsService, 'getByPath', () => p);
    writeFileSync(
      join(root, 'codex'),
      `#!/usr/bin/env node
const readline=require('node:readline');const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
if(m.method==='initialize')send({id:m.id,result:{}});
if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'budget-thread'}}});
if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'budget-turn'}}});send({method:'turn/started',params:{turn:{id:'budget-turn'}}});}
if(m.method==='turn/interrupt'){send({id:m.id,result:{}});send({method:'turn/completed',params:{turn:{id:'budget-turn',status:'interrupted'}}});}
});`,
      { mode: 0o755 },
    );
    const db = openProjectDb(root);
    const auth = openAuthDb();
    auth
      .prepare(
        "INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('owner','owner','test','admin',0,0)",
      )
      .run();
    db.prepare(
      "INSERT INTO channels(id,name,type,created_at) VALUES('ch','general','channel',0)",
    ).run();
    db.prepare(
      "INSERT INTO agents(id,name,runtime,env_vars_json,created_at) VALUES('a','dev','codex',?,0)",
    ).run(JSON.stringify({ PATH: root + ':' + process.env.PATH }));
    db.prepare("INSERT INTO channel_agents VALUES('ch','a')").run();
    try {
      const g = createGoal(
        db,
        { id: 'owner', username: 'owner', display_name: null, role: 'admin' },
        {
          channel_id: 'ch',
          agent_id: 'a',
          objective: 'long task',
          max_active_ms: 1000,
          client_request_id: 'create',
        },
      );
      const claim = claimGoalIteration();
      assert.ok(claim);
      await runGoalIteration(claim, { info: () => {}, warn: () => {}, error: () => {} });
      const final = goalRepo.get(db, g.id)!;
      assert.equal(final.status, 'paused');
      assert.equal(final.reason, 'budget_exhausted');
      assert.ok(final.active_ms >= 1000);
      assert.equal(
        db.prepare("SELECT 1 FROM goal_iterations WHERE status='queued'").get(),
        undefined,
      );
    } finally {
      disposeCodexAppServers();
      closeAllDbs();
      closeAuthDb();
      mock.restoreAll();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
