import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { Goal, GoalAction } from '@openspace/shared';
import type { AuthUser } from '../auth/session.js';
import { canAccessChannel, canManageChannel } from '../auth/channel-access.js';
import { agentRepo, messageRepo } from '../db/repos.js';
import { hub } from '../ws/hub.js';
import { GOAL_COMMANDS } from './command-parser.js';

export const goalsEnabled = () => process.env.OPENSPACE_GOALS_ENABLED !== 'false';
export const terminalGoal = (g: Goal) => ['completed', 'cancelled'].includes(g.status);
export class GoalError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
interface Row extends Omit<Goal, 'requirements' | 'criteria'> {
  requirements_json: string;
  criteria_json: string;
}
function decode(row: Row): Goal {
  const { requirements_json, criteria_json, ...g } = row;
  return { ...g, requirements: JSON.parse(requirements_json), criteria: JSON.parse(criteria_json) };
}
export const goalRepo = {
  get(db: Database, id: string): Goal | null {
    const r = db.prepare('SELECT * FROM goals WHERE id=?').get(id) as Row | undefined;
    return r ? decode(r) : null;
  },
  list(db: Database, channelId?: string): Goal[] {
    return (
      channelId
        ? db
            .prepare('SELECT * FROM goals WHERE channel_id=? ORDER BY created_at DESC')
            .all(channelId)
        : db.prepare('SELECT * FROM goals ORDER BY updated_at').all()
    ).map((r) => decode(r as Row));
  },
  thread(db: Database, thread: string): Goal | null {
    return this.list(db).find((g) => g.thread_root_id === thread && !terminalGoal(g)) ?? null;
  },
};
export function saveGoal(
  db: Database,
  goal: Goal,
  type: string,
  actor: string | null = null,
): Goal {
  goal.version += 1;
  goal.updated_at = Date.now();
  db.prepare(
    `UPDATE goals SET requirements_json=?,criteria_json=?,status=?,reason=?,summary=?,version=?,generation=?,requirements_revision=?,rounds_used=?,max_rounds=?,active_ms=?,max_active_ms=?,no_progress=?,invalid_reports=?,updated_at=? WHERE id=?`,
  ).run(
    JSON.stringify(goal.requirements),
    JSON.stringify(goal.criteria),
    goal.status,
    goal.reason,
    goal.summary,
    goal.version,
    goal.generation,
    goal.requirements_revision,
    goal.rounds_used,
    goal.max_rounds,
    goal.active_ms,
    goal.max_active_ms,
    goal.no_progress,
    goal.invalid_reports,
    goal.updated_at,
    goal.id,
  );
  db.prepare(
    'INSERT INTO goal_events(goal_id,version,actor_id,type,payload_json,created_at) VALUES(?,?,?,?,?,?)',
  ).run(goal.id, goal.version, actor, type, JSON.stringify(goal), Date.now());
  return goal;
}
export function publishGoal(goal: Goal): void {
  hub.broadcast(goal.channel_id, { type: 'goal.updated', goal });
}
export interface Iteration {
  id: string;
  goal_id: string;
  sequence: number;
  kind: 'plan' | 'execute' | 'verify' | 'repair';
  generation: number;
  requirements_revision: number;
  status: string;
  started_at: number | null;
}
export function queueIteration(db: Database, g: Goal, kind: Iteration['kind']): void {
  if (
    db
      .prepare("SELECT 1 FROM goal_iterations WHERE goal_id=? AND status IN ('queued','running')")
      .get(g.id)
  )
    return;
  if (g.rounds_used >= g.max_rounds || g.active_ms >= g.max_active_ms) {
    g.status = 'paused';
    g.reason = 'budget_exhausted';
    return;
  }
  const sequence = (
    db
      .prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM goal_iterations WHERE goal_id=?')
      .get(g.id) as { n: number }
  ).n;
  db.prepare(
    "INSERT INTO goal_iterations(id,goal_id,sequence,kind,generation,requirements_revision,status) VALUES(?,?,?,?,?,?,'queued')",
  ).run(randomUUID(), g.id, sequence, kind, g.generation, g.requirements_revision);
  g.status = 'queued';
  g.reason = null;
}
const controls = new Map<string, () => void>();
const key = (db: Database, id: string) => `${db.name}:${id}`;
export function registerGoalControl(db: Database, id: string, abort: () => void): () => void {
  controls.set(key(db, id), abort);
  return () => controls.delete(key(db, id));
}
export function stopGoalExecution(db: Database, id: string): boolean {
  const abort = controls.get(key(db, id));
  if (!abort) return false;
  abort();
  return true;
}
export function assertGoalAccess(db: Database, g: Goal, user: AuthUser, control = false): void {
  if (
    !canAccessChannel(db, g.channel_id, user) ||
    (control && g.created_by !== user.id && !canManageChannel(db, g.channel_id, user))
  )
    throw new GoalError('无权访问或控制该 Goal', 403);
}
function limits(rounds?: number, ms?: number): void {
  if (
    (rounds !== undefined && (!Number.isInteger(rounds) || rounds < 1 || rounds > 100)) ||
    (ms !== undefined && (!Number.isInteger(ms) || ms < 1000 || ms > 86400000))
  )
    throw new GoalError('额度范围：1–100 轮，1 秒–24 小时');
}
export function createGoal(
  db: Database,
  user: AuthUser,
  input: {
    channel_id: string;
    agent_id: string;
    objective: string;
    thread_id?: string;
    source_message_id?: string;
    acceptance_criteria?: string[];
    max_rounds?: number;
    max_active_ms?: number;
    client_request_id: string;
  },
): Goal {
  if (!goalsEnabled()) throw new GoalError('Goal 功能未开启', 409);
  if (!db.prepare('SELECT 1 FROM channels WHERE id=?').get(input.channel_id))
    throw new GoalError('频道不存在', 404);
  if (!canAccessChannel(db, input.channel_id, user)) throw new GoalError('无权访问频道', 403);
  if (
    typeof input.client_request_id !== 'string' ||
    !input.client_request_id ||
    input.client_request_id.length > 200
  )
    throw new GoalError('client_request_id is required');
  const prior = db
    .prepare(
      'SELECT goal_id FROM goal_requests WHERE channel_id=? AND user_id=? AND client_request_id=?',
    )
    .get(input.channel_id, user.id, input.client_request_id) as { goal_id: string } | undefined;
  if (prior) return goalRepo.get(db, prior.goal_id)!;
  if (
    typeof input.objective !== 'string' ||
    !input.objective.trim() ||
    input.objective.length > 20000
  )
    throw new GoalError('请填写目标（最多 20000 字符）');
  const agent = agentRepo.listInChannel(db, input.channel_id).find((a) => a.id === input.agent_id);
  if (!agent || agent.runtime !== 'codex') throw new GoalError('请选择频道内的 Codex Agent');
  limits(input.max_rounds, input.max_active_ms);
  const rootId = input.thread_id ?? input.source_message_id;
  if (rootId) {
    const root = messageRepo.getById(db, rootId);
    if (!root || root.channel_id !== input.channel_id || root.parent_id)
      throw new GoalError('线程不属于当前频道');
  }
  const criteria = input.acceptance_criteria ?? [input.objective.trim()];
  if (
    !Array.isArray(criteria) ||
    !criteria.length ||
    criteria.length > 30 ||
    criteria.some((c) => typeof c !== 'string' || !c.trim() || c.length > 20000)
  )
    throw new GoalError('验收标准无效');
  const result = db.transaction(() => {
    const root =
      rootId ??
      messageRepo.create(db, {
        channel_id: input.channel_id,
        sender_type: 'user',
        sender_id: user.id,
        content: `/goal ${input.objective.trim()}`,
        metadata: null,
      }).id;
    if (goalRepo.thread(db, root)) throw new GoalError('该线程已有未终止 Goal', 409);
    const g: Goal = {
      id: randomUUID(),
      channel_id: input.channel_id,
      thread_root_id: root,
      agent_id: agent.id,
      created_by: user.id,
      objective: input.objective.trim(),
      requirements: [],
      criteria: criteria.map((text, i) => ({
        id: `c${i + 1}`,
        text,
        state: 'pending',
        evidence: [],
      })),
      status: 'queued',
      reason: null,
      summary: '',
      version: 0,
      generation: 1,
      requirements_revision: 1,
      rounds_used: 0,
      max_rounds: input.max_rounds ?? 20,
      active_ms: 0,
      max_active_ms: input.max_active_ms ?? 3600000,
      no_progress: 0,
      invalid_reports: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    db.prepare(
      'INSERT INTO goals(id,channel_id,thread_root_id,agent_id,created_by,objective,requirements_json,criteria_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      g.id,
      g.channel_id,
      g.thread_root_id,
      g.agent_id,
      g.created_by,
      g.objective,
      '[]',
      JSON.stringify(g.criteria),
      g.status,
      g.created_at,
      g.updated_at,
    );
    db.prepare('INSERT INTO goal_requests VALUES(?,?,?,?,?)').run(
      g.channel_id,
      user.id,
      input.client_request_id,
      g.id,
      'create',
    );
    queueIteration(db, g, 'plan');
    return saveGoal(db, g, 'created', user.id);
  })();
  const root = messageRepo.getById(db, result.thread_root_id)!;
  hub.broadcast(result.channel_id, { type: 'message', message: root });
  publishGoal(result);
  return result;
}
export function actionGoal(
  db: Database,
  user: AuthUser,
  id: string,
  input: {
    action: GoalAction;
    content?: string;
    expected_version?: number;
    client_request_id: string;
    max_rounds?: number;
    max_active_ms?: number;
  },
): Goal {
  const g = goalRepo.get(db, id);
  if (!g) throw new GoalError('Goal 不存在', 404);
  assertGoalAccess(db, g, user, true);
  if (
    !input ||
    typeof input.client_request_id !== 'string' ||
    !input.client_request_id ||
    input.client_request_id.length > 200
  )
    throw new GoalError('client_request_id is required');
  const prior = db
    .prepare(
      'SELECT goal_id FROM goal_requests WHERE channel_id=? AND user_id=? AND client_request_id=?',
    )
    .get(g.channel_id, user.id, input.client_request_id) as { goal_id: string } | undefined;
  if (prior) {
    if (prior.goal_id !== id) throw new GoalError('请求 ID 已被使用', 409);
    return g;
  }
  if (input.expected_version !== undefined && input.expected_version !== g.version)
    throw new GoalError('Goal 已更新，请刷新后重试', 409);
  if (terminalGoal(g)) throw new GoalError('该 Goal 已终止，请创建新 Goal', 409);
  if (['pausing', 'cancelling'].includes(g.status))
    throw new GoalError('正在停止上一轮，请稍后重试', 409);
  limits(input.max_rounds, input.max_active_ms);
  let shouldAbort = false;
  db.transaction(() => {
    const running = !!db
      .prepare("SELECT 1 FROM goal_iterations WHERE goal_id=? AND status='running'")
      .get(id);
    switch (input.action) {
      case 'pause':
      case 'cancel':
        g.generation++;
        g.status =
          input.action === 'cancel'
            ? running
              ? 'cancelling'
              : 'cancelled'
            : running
              ? 'pausing'
              : 'paused';
        g.reason = 'user_' + input.action;
        shouldAbort = running;
        break;
      case 'update':
        if (
          typeof input.content !== 'string' ||
          !input.content.trim() ||
          input.content.length > 20000
        )
          throw new GoalError('请填写补充要求');
        g.requirements.push(input.content.trim());
        g.requirements_revision++;
        g.generation++;
        g.no_progress = 0;
        g.invalid_reports = 0;
        g.criteria = g.criteria.map((c) => ({ ...c, state: 'pending', evidence: [] }));
        g.criteria.push({
          id: `c${g.criteria.length + 1}`,
          text: input.content.trim(),
          state: 'pending',
          evidence: [],
        });
        if (g.status === 'paused' || g.status === 'failed') {
          g.status = 'paused';
          g.reason = 'requirements_updated';
        } else {
          g.status = running ? 'pausing' : 'queued';
          g.reason = running ? 'requirements_updated' : null;
        }
        shouldAbort = running;
        break;
      case 'resume':
        if (!['paused', 'failed', 'awaiting_input'].includes(g.status) || running)
          throw new GoalError('当前状态不能恢复', 409);
        if (g.status === 'failed' && !input.content?.trim())
          throw new GoalError('失败后恢复需填写纠正信息');
        if (input.content && input.content.length > 20000) throw new GoalError('补充要求过长');
        if (input.content?.trim()) {
          g.requirements.push(input.content.trim());
          g.requirements_revision++;
          g.criteria = g.criteria.map((c) => ({ ...c, state: 'pending', evidence: [] }));
          g.criteria.push({
            id: `c${g.criteria.length + 1}`,
            text: input.content.trim(),
            state: 'pending',
            evidence: [],
          });
        }
        g.max_rounds = input.max_rounds ?? g.max_rounds;
        g.max_active_ms = input.max_active_ms ?? g.max_active_ms;
        if (g.rounds_used >= g.max_rounds || g.active_ms >= g.max_active_ms)
          throw new GoalError('额度已用尽，请增加总额度后继续', 409);
        g.generation++;
        g.status = 'queued';
        g.no_progress = 0;
        g.invalid_reports = 0;
        g.reason = null;
        break;
      case 'confirm':
        if (
          g.status !== 'awaiting_input' ||
          g.reason !== 'human_verification' ||
          !g.criteria.every((c) => c.state === 'passed' && c.evidence.length)
        )
          throw new GoalError('当前 Goal 不在等待人工验收', 409);
        g.status = 'completed';
        g.reason = null;
        break;
      default:
        throw new GoalError('未知 Goal 操作');
    }
    db.prepare(
      "UPDATE goal_iterations SET status='cancelled',ended_at=? WHERE goal_id=? AND status='queued'",
    ).run(Date.now(), id);
    if (g.status === 'queued') queueIteration(db, g, 'plan');
    saveGoal(db, g, input.action, user.id);
    db.prepare('INSERT INTO goal_requests VALUES(?,?,?,?,?)').run(
      g.channel_id,
      user.id,
      input.client_request_id,
      id,
      input.action,
    );
  })();
  if (shouldAbort) stopGoalExecution(db, id);
  publishGoal(g);
  return g;
}
export function pauseChannelGoals(
  db: Database,
  channelId: string,
  agentId?: string,
  reason = 'channel_stopped',
): void {
  for (const g of goalRepo
    .list(db, channelId)
    .filter((g) => !terminalGoal(g) && (!agentId || g.agent_id === agentId))) {
    db.transaction(() => {
      g.generation++;
      const running = !!db
        .prepare("SELECT 1 FROM goal_iterations WHERE goal_id=? AND status='running'")
        .get(g.id);
      g.status = running ? 'pausing' : 'paused';
      g.reason = reason;
      db.prepare(
        "UPDATE goal_iterations SET status='cancelled',ended_at=? WHERE goal_id=? AND status='queued'",
      ).run(Date.now(), g.id);
      saveGoal(db, g, 'paused');
    })();
    stopGoalExecution(db, g.id);
    publishGoal(g);
  }
}
export function goalCommandConflict(db: Database, command: string): boolean {
  return (
    GOAL_COMMANDS.includes(command) &&
    !!db.prepare('SELECT 1 FROM workflows WHERE trigger_command=?').get(command)
  );
}
