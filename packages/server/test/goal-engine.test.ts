import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, mock } from 'node:test';
import type { Project } from '@openspace/shared';
import { projectsService } from '../src/config/projects-service.js';
import { openProjectDb, closeAllDbs } from '../src/db/index.js';
import { createGoal, goalRepo } from '../src/goals/service.js';
import { triggerAgent } from '../src/agents/engine.js';
import { goalPrompt, settleGoalIteration } from '../src/goals/scheduler.js';
import type { Iteration } from '../src/goals/service.js';
import { disposeCodexAppServers } from '../src/agents/codex/codex-app-server-adapter.js';
const fake = `#!/usr/bin/env node
const readline=require('node:readline');
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize')send({id:m.id,result:{}});
 if(m.method==='thread/start'||m.method==='thread/resume')send({id:m.id,result:{thread:{id:'goal-test-session'}}});
 if(m.method==='turn/start'){
   const prompt=m.params.input[0].text;
   const report=JSON.parse(prompt.split('Required schema:\\n')[1].split('\\n')[0]);
   report.outcome='completion_candidate';report.summary='Created artifact and checked it';report.criteria=report.criteria.map(c=>({...c,state:'passed',evidence:['artifact.txt exists']}));
   require('node:fs').writeFileSync('artifact.txt','done');
   send({id:m.id,result:{turn:{id:'turn-test'}}});
   send({method:'item/agentMessage/delta',params:{delta:'Artifact complete. <openspace-goal-report>'+JSON.stringify(report)+'</openspace-goal-report>'}});
   send({method:'turn/completed',params:{turn:{id:'turn-test',status:'completed'}}});
 }
});
`;
test(
  'Goal engine executes, isolates session, strips internal report, and verifies separately',
  { timeout: 15000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'goal-engine-'));
    const p: Project = {
      id: 'p',
      name: 'p',
      workspace_path: root,
      display_name: null,
      goal: 'test project',
      team_rules: null,
      color: null,
      created_at: 0,
    };
    mock.method(projectsService, 'getByPath', () => p);
    writeFileSync(join(root, 'codex'), fake, { mode: 0o755 });
    const db = openProjectDb(root);
    db.prepare(
      "INSERT INTO channels(id,name,type,created_at) VALUES('ch','general','channel',0)",
    ).run();
    db.prepare(
      "INSERT INTO agents(id,name,runtime,env_vars_json,created_at) VALUES('a','dev','codex',?,0)",
    ).run(JSON.stringify({ PATH: root + ':' + process.env.PATH }));
    db.prepare("INSERT INTO channel_agents VALUES('ch','a')").run();
    const user = { id: 'owner', username: 'owner', display_name: null, role: 'admin' as const };
    try {
      let g = createGoal(db, user, {
        channel_id: 'ch',
        agent_id: 'a',
        objective: 'Create artifact.txt',
        client_request_id: 'create',
      });
      for (let round = 0; round < 2; round++) {
        const i = db
          .prepare("SELECT * FROM goal_iterations WHERE goal_id=? AND status='queued'")
          .get(g.id) as Iteration;
        db.prepare("UPDATE goal_iterations SET status='running' WHERE id=?").run(i.id);
        const rootMessage = (await import('../src/db/repos.js')).messageRepo.getById(
          db,
          g.thread_root_id,
        )!;
        const result = await triggerAgent(
          g.agent_id,
          {
            channelId: 'ch',
            triggerMessage: rootMessage,
            parentMessageId: g.thread_root_id,
            goal: {
              id: g.id,
              iterationId: i.id,
              prompt: goalPrompt(g, i),
              signal: new AbortController().signal,
              onEvent: () => {},
            },
          },
          { db },
        );
        assert.equal(result.ok, true);
        assert.ok(result.goalReportText?.includes('<openspace-goal-report>'));
        assert.equal(result.fullText, 'Artifact complete.');
        assert.equal(
          (db.prepare('SELECT COUNT(*) n FROM runtime_sessions').get() as { n: number }).n,
          0,
        );
        assert.equal(
          (
            db
              .prepare('SELECT session_id FROM goal_runtime_sessions WHERE goal_id=?')
              .get(g.id) as { session_id: string }
          ).session_id,
          'goal-test-session',
        );
        settleGoalIteration(db, i.id, {
          ...result,
          fullText: result.goalReportText!,
          replyId: result.agentReplyMessage.id,
        });
        g = goalRepo.get(db, g.id)!;
        assert.equal(g.status, round === 0 ? 'queued' : 'completed');
      }
    } finally {
      disposeCodexAppServers();
      closeAllDbs();
      mock.restoreAll();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
