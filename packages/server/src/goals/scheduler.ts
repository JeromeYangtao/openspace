import type { Database } from 'better-sqlite3';
import type { Goal } from '@openspace/shared';
import { listEnabledUsersByIds } from '../auth/session.js';
import { canAccessChannel } from '../auth/channel-access.js';
import { agentRepo, messageRepo } from '../db/repos.js';
import { openProjectDb, pinProjectDb } from '../db/index.js';
import { projectsService } from '../config/projects-service.js';
import { triggerAgent } from '../agents/engine.js';
import {
  goalRepo,
  saveGoal,
  publishGoal,
  queueIteration,
  registerGoalControl,
  type Iteration,
  goalsEnabled,
  stopGoalExecution,
} from './service.js';
import { parseGoalReport, REPORT_START, REPORT_END } from './report.js';

const activeWorkspaces = new Set<string>();
const recovered = new WeakSet<Database>();
export function recoverGoals(db: Database): void {
  if (recovered.has(db)) return;
  recovered.add(db);
  db.transaction(() => {
    for (const g of goalRepo.list(db)) {
      const running = db
        .prepare("SELECT 1 FROM goal_iterations WHERE goal_id=? AND status='running'")
        .get(g.id);
      if (
        running ||
        ['pausing', 'cancelling', 'running', 'verifying', 'awaiting_approval'].includes(g.status)
      ) {
        db.prepare(
          "UPDATE goal_iterations SET status='interrupted',ended_at=?,error='server_restarted' WHERE goal_id=? AND status='running'",
        ).run(Date.now(), g.id);
        db.prepare(
          "UPDATE goal_iterations SET status='cancelled',ended_at=? WHERE goal_id=? AND status='queued'",
        ).run(Date.now(), g.id);
        g.generation++;
        g.status = g.status === 'cancelling' ? 'cancelled' : 'paused';
        g.reason = 'server_restarted';
        saveGoal(db, g, 'recovered');
      } else if (g.status === 'queued') {
        queueIteration(db, g, 'execute');
        saveGoal(db, g, 'reconciled');
      }
    }
  })();
}
function ownerAllowed(db: Database, g: Goal): boolean {
  const user = listEnabledUsersByIds([g.created_by])[0];
  return (
    !!user &&
    canAccessChannel(db, g.channel_id, user) &&
    agentRepo
      .listInChannel(db, g.channel_id)
      .some((a) => a.id === g.agent_id && a.runtime === 'codex')
  );
}
export function claimGoalIteration(): {
  db: Database;
  goal: Goal;
  iteration: Iteration;
  release: () => void;
} | null {
  for (const p of projectsService.list()) {
    if (activeWorkspaces.has(p.workspace_path)) continue;
    let db: Database;
    try {
      db = openProjectDb(p.workspace_path);
      recoverGoals(db);
    } catch (e) {
      console.warn('[goal-scheduler] cannot open project', p.id, (e as Error).message);
      continue;
    }
    for (const g of goalRepo.list(db).sort((a, b) => a.updated_at - b.updated_at)) {
      if (!goalsEnabled() && !['completed', 'cancelled', 'paused'].includes(g.status)) {
        g.generation++;
        g.status = 'paused';
        g.reason = 'feature_disabled';
        db.prepare(
          "UPDATE goal_iterations SET status='cancelled' WHERE goal_id=? AND status='queued'",
        ).run(g.id);
        saveGoal(db, g, 'paused');
        publishGoal(g);
        continue;
      }
      if (g.status !== 'queued') continue;
      const recentFailure = db
        .prepare(
          "SELECT ended_at FROM goal_iterations WHERE goal_id=? AND status='failed' ORDER BY sequence DESC LIMIT 1",
        )
        .get(g.id) as { ended_at: number } | undefined;
      const failures = (
        db
          .prepare("SELECT COUNT(*) n FROM goal_iterations WHERE goal_id=? AND status='failed'")
          .get(g.id) as { n: number }
      ).n;
      if (recentFailure && Date.now() - recentFailure.ended_at < (failures > 1 ? 30000 : 5000))
        continue;
      const iteration = db
        .prepare(
          "SELECT * FROM goal_iterations WHERE goal_id=? AND status='queued' ORDER BY sequence LIMIT 1",
        )
        .get(g.id) as Iteration | undefined;
      if (!iteration) continue;
      if (iteration.generation !== g.generation) {
        db.prepare("UPDATE goal_iterations SET status='cancelled',ended_at=? WHERE id=?").run(
          Date.now(),
          iteration.id,
        );
        continue;
      }
      if (!ownerAllowed(db, g)) {
        g.status = 'paused';
        g.reason = 'access_revoked';
        saveGoal(db, g, 'paused');
        publishGoal(g);
        continue;
      }
      if (g.rounds_used >= g.max_rounds || g.active_ms >= g.max_active_ms) {
        g.status = 'paused';
        g.reason = 'budget_exhausted';
        saveGoal(db, g, 'paused');
        publishGoal(g);
        continue;
      }
      if (db.prepare("SELECT 1 FROM agent_run_jobs WHERE status='running'").get()) continue;
      db.transaction(() => {
        db.prepare(
          "UPDATE goal_iterations SET status='running',started_at=? WHERE id=? AND status='queued'",
        ).run(Date.now(), iteration.id);
        g.rounds_used++;
        g.status = iteration.kind === 'verify' ? 'verifying' : 'running';
        saveGoal(db, g, 'iteration_started');
      })();
      activeWorkspaces.add(p.workspace_path);
      const unpin = pinProjectDb(db);
      publishGoal(g);
      return {
        db,
        goal: g,
        iteration,
        release: () => {
          activeWorkspaces.delete(p.workspace_path);
          unpin();
        },
      };
    }
  }
  return null;
}
export function goalPrompt(g: Goal, i: Iteration): string {
  return `You are executing an OpenSpace Goal. Continue authorized work until the current task is done; use existing permission controls. Do not delegate via @mentions.\nGoal: ${g.objective}\nAdditional requirements: ${JSON.stringify(g.requirements)}\nRequired criteria (do not remove or weaken): ${JSON.stringify(g.criteria)}\nPrevious progress: ${g.summary}\nThis round: ${i.kind}. ${i.kind === 'verify' ? 'Independently recheck each criterion against actual artifacts/tests. Only claim completion_candidate when all criteria have evidence.' : i.kind === 'repair' ? 'Repair the missing/invalid report; do not repeat external side effects.' : 'Investigate, plan, implement, and test as needed. If unfinished identify the next concrete action.'}\nRemaining rounds including this round: ${g.max_rounds - g.rounds_used + 1}. Remaining active ms: ${g.max_active_ms - g.active_ms}.\nAt the end of your final answer append exactly one ${REPORT_START} JSON ${REPORT_END} block. It is internal control data, not a code fence. Required schema:\n${JSON.stringify({ schema_version: 1, goal_id: g.id, iteration_id: i.id, generation: g.generation, requirements_revision: g.requirements_revision, outcome: 'continue', summary: 'concrete progress', next_action: 'next concrete action', criteria: g.criteria })}\nAllowed outcome: continue, completion_candidate, needs_input, blocked. Criterion state: pending, passed, failed; evidence must be nonempty string references to real artifacts or test results when passed. Keep criterion id/text unchanged. Never claim completion based only on a successful response. If you require user confirmation or information use needs_input. ${g.requirements_revision > 1 ? 'Validate all added requirements too.' : ''}`;
}
export function settleGoalIteration(
  db: Database,
  id: string,
  result: {
    ok: boolean;
    fullText: string;
    duration_ms: number;
    errorMessage?: string;
    replyId?: string;
    active_ms?: number;
  },
): void {
  const i = db.prepare('SELECT * FROM goal_iterations WHERE id=?').get(id) as Iteration;
  const g = goalRepo.get(db, i.goal_id)!;
  db.transaction(() => {
    db.prepare(
      'UPDATE goal_iterations SET status=?,ended_at=?,active_ms=active_ms+?,reply_message_id=?,error=? WHERE id=?',
    ).run(
      result.ok ? 'done' : 'failed',
      Date.now(),
      result.active_ms ?? result.duration_ms,
      result.replyId ?? null,
      result.errorMessage ?? null,
      id,
    );
    g.active_ms += result.active_ms ?? result.duration_ms;
    if (g.generation !== i.generation) {
      if (g.status === 'cancelling') g.status = 'cancelled';
      else if (g.status === 'pausing') {
        if (g.reason === 'requirements_updated') {
          queueIteration(db, g, 'plan');
        } else g.status = 'paused';
      }
      saveGoal(db, g, 'iteration_stopped');
      return;
    }
    if (!result.ok) {
      if (
        /thread.*(?:not found|missing|invalid)|session.*(?:not found|expired|invalid)/i.test(
          result.errorMessage ?? '',
        )
      )
        db.prepare('DELETE FROM goal_runtime_sessions WHERE goal_id=?').run(g.id);
      const failures = (
        db
          .prepare("SELECT COUNT(*) n FROM goal_iterations WHERE goal_id=? AND status='failed'")
          .get(g.id) as { n: number }
      ).n;
      if (
        failures <= 2 &&
        /timeout|temporar|busy|rate.?limit|queue_full|connection|ECONN/i.test(
          result.errorMessage ?? '',
        )
      ) {
        queueIteration(db, g, 'execute');
        g.summary = '临时错误，等待退避后重试';
      } else {
        g.status = 'failed';
        g.reason = result.errorMessage ?? 'runtime_error';
      }
      saveGoal(db, g, 'failed');
      return;
    }
    if (g.active_ms >= g.max_active_ms) {
      g.status = 'paused';
      g.reason = 'budget_exhausted';
      saveGoal(db, g, 'paused');
      return;
    }
    try {
      const report = parseGoalReport(result.fullText, g, id);
      db.prepare('UPDATE goal_iterations SET report_json=? WHERE id=?').run(
        JSON.stringify(report),
        id,
      );
      const progressed =
        report.criteria.some(
          (c) =>
            c.state === 'passed' && g.criteria.find((old) => old.id === c.id)?.state !== 'passed',
        ) ||
        report.criteria.some((c) =>
          c.evidence.some((e) => !g.criteria.find((old) => old.id === c.id)?.evidence.includes(e)),
        );
      g.no_progress = progressed ? 0 : g.no_progress + 1;
      g.invalid_reports = 0;
      g.summary = report.summary;
      g.criteria = g.criteria.map((c) => {
        const updated = report.criteria.find((r) => r.id === c.id)!;
        return { ...c, state: updated.state, evidence: updated.evidence };
      });
      if (report.outcome === 'needs_input') {
        g.status = 'awaiting_input';
        g.reason = report.next_action;
      } else if (report.outcome === 'blocked') {
        g.status = 'paused';
        g.reason = report.next_action || 'blocked';
      } else if (
        report.outcome === 'completion_candidate' &&
        g.criteria.every((c) => c.state === 'passed' && c.evidence.length)
      ) {
        if (i.kind === 'verify') {
          const human =
            /人工验收|人工确认|human (?:approval|review)|manual (?:approval|review)/i.test(
              [g.objective, ...g.requirements].join('\n'),
            );
          g.status = human ? 'awaiting_input' : 'completed';
          g.reason = human ? 'human_verification' : null;
        } else queueIteration(db, g, 'verify');
      } else if (g.no_progress >= 3) {
        g.status = 'paused';
        g.reason = 'no_progress';
      } else queueIteration(db, g, 'execute');
    } catch (e) {
      g.invalid_reports++;
      if (g.invalid_reports > 1) {
        g.status = 'paused';
        g.reason = 'invalid_report';
      } else queueIteration(db, g, 'repair');
      g.summary = `报告校验失败：${(e as Error).message}`;
    }
    saveGoal(db, g, 'iteration_finished');
  })();
  publishGoal(g);
}
export async function runGoalIteration(
  claim: NonNullable<ReturnType<typeof claimGoalIteration>>,
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void },
): Promise<void> {
  const { db, goal: g, iteration: i } = claim;
  const root = messageRepo.getById(db, g.thread_root_id)!;
  const controller = new AbortController();
  const unregister = registerGoalControl(db, g.id, () => controller.abort());
  let last = Date.now(),
    activeMs = 0,
    waiting = false,
    waitStarted = 0;
  let chargedMs = 0;
  const charge = () => {
    const now = Date.now();
    if (!waiting) activeMs += now - last;
    last = now;
  };
  const timer = setInterval(() => {
    charge();
    db.prepare('UPDATE goal_iterations SET active_ms=? WHERE id=?').run(activeMs, i.id);
    db.prepare('UPDATE goals SET active_ms=active_ms+? WHERE id=?').run(activeMs - chargedMs, g.id);
    chargedMs = activeMs;
    if (
      activeMs >= g.max_active_ms - g.active_ms ||
      (waiting && Date.now() - waitStarted > 86400000) ||
      !goalsEnabled() ||
      !ownerAllowed(db, g)
    ) {
      const current = goalRepo.get(db, g.id)!;
      if (current.generation === i.generation) {
        current.generation++;
        current.status = 'pausing';
        current.reason = !goalsEnabled()
          ? 'feature_disabled'
          : waiting
            ? 'input_expired'
            : activeMs >= g.max_active_ms - g.active_ms
              ? 'budget_exhausted'
              : 'access_revoked';
        saveGoal(db, current, 'paused');
        publishGoal(current);
      }
      controller.abort();
    }
  }, 1000);
  timer.unref();
  try {
    const current = goalRepo.get(db, g.id)!;
    if (current.generation !== i.generation || !['running', 'verifying'].includes(current.status))
      controller.abort();
    const result = await triggerAgent(
      g.agent_id,
      {
        channelId: g.channel_id,
        triggerMessage: root,
        parentMessageId: g.thread_root_id,
        chainDepth: 0,
        goal: {
          id: g.id,
          iterationId: i.id,
          prompt: goalPrompt(g, i),
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'input.required' || event.type === 'approval.required') {
              charge();
              waiting = true;
              waitStarted = Date.now();
              const now = goalRepo.get(db, g.id)!;
              if (now.generation === i.generation) {
                now.status =
                  event.type === 'input.required' ? 'awaiting_input' : 'awaiting_approval';
                saveGoal(db, now, 'waiting');
                publishGoal(now);
              }
            } else if (
              event.type === 'input.resolved' ||
              event.type === 'approval.resolved' ||
              event.type === 'tool.started' ||
              event.type === 'text.delta'
            ) {
              if (waiting) {
                charge();
                waiting = false;
                const now = goalRepo.get(db, g.id)!;
                if (now.generation === i.generation) {
                  now.status = i.kind === 'verify' ? 'verifying' : 'running';
                  saveGoal(db, now, 'continued');
                  publishGoal(now);
                }
              }
            }
          },
        },
      },
      { db, logger },
    );
    charge();
    settleGoalIteration(db, i.id, {
      ...result,
      fullText: result.goalReportText ?? result.fullText,
      replyId: result.agentReplyMessage?.id,
      active_ms: activeMs - chargedMs,
    });
  } catch (e) {
    charge();
    settleGoalIteration(db, i.id, {
      ok: false,
      fullText: '',
      duration_ms: activeMs - chargedMs,
      errorMessage: (e as Error).message,
    });
  } finally {
    clearInterval(timer);
    unregister();
    claim.release();
  }
}

export async function stopAllGoals(): Promise<void> {
  for (const p of projectsService.list()) {
    const db = openProjectDb(p.workspace_path);
    for (const g of goalRepo.list(db))
      if (!['completed', 'cancelled', 'paused', 'failed'].includes(g.status)) {
        g.generation++;
        g.status = 'pausing';
        g.reason = 'server_shutdown';
        db.prepare(
          "UPDATE goal_iterations SET status='cancelled',ended_at=? WHERE goal_id=? AND status='queued'",
        ).run(Date.now(), g.id);
        saveGoal(db, g, 'paused');
        stopGoalExecution(db, g.id);
        if (
          !db
            .prepare("SELECT 1 FROM goal_iterations WHERE goal_id=? AND status='running'")
            .get(g.id)
        ) {
          g.status = 'paused';
          saveGoal(db, g, 'paused');
        }
      }
  }
  const deadline = Date.now() + 10000;
  while (activeWorkspaces.size && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
}
