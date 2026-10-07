import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { ChatMessage, GoalAction } from '@openspace/shared';
import { listEnabledUsersByIds } from '../auth/session.js';
import { agentRepo } from '../db/repos.js';
import { hub } from '../ws/hub.js';
import { isEveryoneMention } from '../messaging/mentions.js';
import { parseGoalCommand } from './command-parser.js';
import {
  actionGoal,
  createGoal,
  goalRepo,
  GoalError,
  goalCommandConflict,
  publishGoal,
  terminalGoal,
} from './service.js';
export function handleGoalMessage(
  db: Database,
  message: ChatMessage,
  userId: string,
  requestId?: string,
): boolean {
  const cmd = parseGoalCommand(message.content);
  const threadGoal = message.parent_id ? goalRepo.thread(db, message.parent_id) : null;
  if (!cmd && (!threadGoal || message.content.trim().startsWith('/'))) return false;
  if (
    cmd?.name === '/goal' &&
    !agentRepo.listInChannel(db, message.channel_id).some((a) => a.runtime === 'codex')
  )
    throw new GoalError('频道没有可用 Codex Agent，请先添加');
  const user = listEnabledUsersByIds([userId])[0];
  if (!user) throw new GoalError('用户不存在或已停用', 403);
  const client_request_id = requestId ?? randomUUID();
  if (!cmd) {
    actionGoal(db, user, threadGoal!.id, {
      action: 'update',
      content: message.content,
      client_request_id,
    });
    return true;
  }
  if (goalCommandConflict(db, cmd.name))
    throw new GoalError(
      `${cmd.name} 与已有 Workflow 冲突，请先更名 Workflow；可从 Goal 表单创建`,
      409,
    );
  if (cmd.name === '/goal') {
    if (cmd.agentNames.length > 1 || cmd.agentNames.some(isEveryoneMention))
      throw new GoalError('首版 Goal 只支持一个负责人，请指定单个 Agent');
    const agents = agentRepo
      .listInChannel(db, message.channel_id)
      .filter((a) => a.runtime === 'codex');
    const explicit = cmd.agentNames[0];
    const agent = explicit
      ? agents.find((a) => a.name === explicit)
      : agents.length === 1
        ? agents[0]
        : undefined;
    if (explicit && !agent) throw new GoalError('负责人须是频道内的 Codex Agent');
    if (!cmd.args || !agent) {
      hub.broadcast(message.channel_id, {
        type: 'goal.compose_required',
        channel_id: message.channel_id,
        thread_id: message.parent_id ?? undefined,
        objective: cmd.args,
        agent_id: agent?.id,
        user_id: user.id,
      });
      return true;
    }
    createGoal(db, user, {
      channel_id: message.channel_id,
      agent_id: agent.id,
      objective: cmd.args,
      thread_id: message.parent_id ?? undefined,
      source_message_id: message.parent_id ? undefined : message.id,
      client_request_id,
    });
    return true;
  }
  let args = cmd.args;
  let goal = threadGoal;
  const first = args.split(/\s+/)[0];
  const byId = first ? goalRepo.get(db, first) : null;
  if (byId) {
    if (byId.channel_id !== message.channel_id) throw new GoalError('Goal 不属于当前频道', 403);
    goal = byId;
    args = args.slice(first!.length).trim();
  }
  if (!goal) {
    const choices = goalRepo.list(db, message.channel_id).filter((g) => !terminalGoal(g));
    if (choices.length === 1) goal = choices[0]!;
    else throw new GoalError('请在线程中操作，或在命令后指定 Goal ID');
  }
  if (cmd.name === '/goal-status') {
    publishGoal(goal);
    return true;
  }
  const action = cmd.name.slice('/goal-'.length) as GoalAction;
  actionGoal(db, user, goal.id, { action, content: args, client_request_id });
  return true;
}
