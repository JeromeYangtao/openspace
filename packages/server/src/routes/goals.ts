import type { FastifyInstance } from 'fastify';
import { getUserFromRequest } from '../auth/session.js';
import { canAccessChannel, canManageChannel } from '../auth/channel-access.js';
import { dbForProjectId } from './_helpers.js';
import {
  createGoal,
  actionGoal,
  goalRepo,
  assertGoalAccess,
  GoalError,
  goalsEnabled,
} from '../goals/service.js';
export async function goalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:projectId/channels/:channelId/goals', async (req, reply) => {
    const { projectId, channelId } = req.params as { projectId: string; channelId: string };
    const ctx = dbForProjectId(projectId);
    const user = getUserFromRequest(req);
    if (
      !ctx ||
      !ctx.db.prepare('SELECT 1 FROM channels WHERE id=?').get(channelId) ||
      !user ||
      !canAccessChannel(ctx.db, channelId, user)
    ) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    return {
      enabled: goalsEnabled(),
      goals: goalRepo.list(ctx.db, channelId),
      can_manage: canManageChannel(ctx.db, channelId, user),
    };
  });
  app.post('/api/projects/:projectId/channels/:channelId/goals', async (req, reply) => {
    const { projectId, channelId } = req.params as { projectId: string; channelId: string };
    const ctx = dbForProjectId(projectId);
    const user = getUserFromRequest(req);
    if (!ctx || !user) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    try {
      return createGoal(ctx.db, user, {
        ...(req.body as Omit<Parameters<typeof createGoal>[2], 'channel_id'>),
        channel_id: channelId,
      });
    } catch (e) {
      reply.code(e instanceof GoalError ? e.statusCode : 500);
      return { error: (e as Error).message };
    }
  });
  app.get('/api/projects/:projectId/goals/:goalId', async (req, reply) => {
    const { projectId, goalId } = req.params as { projectId: string; goalId: string };
    const ctx = dbForProjectId(projectId);
    const user = getUserFromRequest(req);
    const g = ctx ? goalRepo.get(ctx.db, goalId) : null;
    if (!ctx || !user || !g) {
      reply.code(404);
      return { error: 'not found' };
    }
    try {
      assertGoalAccess(ctx.db, g, user);
      return {
        goal: g,
        events: ctx.db.prepare('SELECT * FROM goal_events WHERE goal_id=? ORDER BY id').all(g.id),
        iterations: ctx.db
          .prepare('SELECT * FROM goal_iterations WHERE goal_id=? ORDER BY sequence')
          .all(g.id),
      };
    } catch (e) {
      reply.code(403);
      return { error: (e as Error).message };
    }
  });
  app.post('/api/projects/:projectId/goals/:goalId/actions', async (req, reply) => {
    const { projectId, goalId } = req.params as { projectId: string; goalId: string };
    const ctx = dbForProjectId(projectId);
    const user = getUserFromRequest(req);
    if (!ctx || !user) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    try {
      return actionGoal(ctx.db, user, goalId, req.body as Parameters<typeof actionGoal>[3]);
    } catch (e) {
      reply.code(e instanceof GoalError ? e.statusCode : 500);
      return { error: (e as Error).message };
    }
  });
  app.get('/api/projects/:projectId/goals/:goalId/events', async (req, reply) => {
    const { projectId, goalId } = req.params as { projectId: string; goalId: string };
    const ctx = dbForProjectId(projectId);
    const user = getUserFromRequest(req);
    const goal = ctx ? goalRepo.get(ctx.db, goalId) : null;
    if (!ctx || !user || !goal) {
      reply.code(404);
      return { error: 'not found' };
    }
    try {
      assertGoalAccess(ctx.db, goal, user);
      const after = Number((req.query as { after?: string }).after ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) throw new GoalError('Invalid cursor');
      return ctx.db
        .prepare('SELECT * FROM goal_events WHERE goal_id=? AND id>? ORDER BY id LIMIT 100')
        .all(goalId, after);
    } catch (e) {
      reply.code(e instanceof GoalError ? e.statusCode : 403);
      return { error: (e as Error).message };
    }
  });
}
