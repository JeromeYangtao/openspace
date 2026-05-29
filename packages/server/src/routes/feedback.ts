/**
 * Agent Feedback REST API（D-21 重构）
 */

import type { FastifyInstance } from 'fastify';
import { LOCAL_USER_ID } from '@openspace/shared';
import { agentRepo, feedbackRepo } from '../db/repos.js';
import { runCoachForAgent } from '../system-agents/coach.js';
import { EVALUATOR_WINDOW_MS } from '@openspace/shared';
import { dbForResource } from './_helpers.js';
import { listOpenDbs } from '../db/index.js';

async function findCtxForFeedback(id: number) {
  for (const open of listOpenDbs()) {
    try {
      const row = open.db.prepare('SELECT 1 FROM agent_feedback WHERE id = ?').get(id);
      if (row) return { db: open.db, workspacePath: open.workspacePath };
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agents/:id/feedback', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('agents', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    if (!agentRepo.getById(ctx.db, id)) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    return feedbackRepo.listByAgent(ctx.db, id);
  });

  app.post('/api/agents/:id/feedback/run-coach', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('agents', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    const agent = agentRepo.getById(ctx.db, id);
    if (!agent) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    const since = Date.now() - EVALUATOR_WINDOW_MS;
    try {
      const feedback = await runCoachForAgent(ctx.db, agent, since, {
        info: (m) => req.log.info(m),
        warn: (m) => req.log.warn(m),
        error: (m) => req.log.error(m),
      });
      return { feedback };
    } catch (e) {
      reply.code(500);
      return { error: (e as Error).message };
    }
  });

  app.post('/api/feedback/:id/apply', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = await findCtxForFeedback(Number(id));
    if (!ctx) {
      reply.code(404);
      return { error: 'feedback not found' };
    }
    const fb = feedbackRepo.getById(ctx.db, Number(id));
    if (!fb) {
      reply.code(404);
      return { error: 'feedback not found' };
    }
    if (fb.status !== 'pending') {
      reply.code(409);
      return { error: `feedback is already ${fb.status}` };
    }
    agentRepo.update(ctx.db, fb.agent_id, { description: fb.description_after });
    return feedbackRepo.setStatus(ctx.db, fb.id, 'applied', LOCAL_USER_ID);
  });

  app.post('/api/feedback/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = await findCtxForFeedback(Number(id));
    if (!ctx) {
      reply.code(404);
      return { error: 'feedback not found' };
    }
    const fb = feedbackRepo.getById(ctx.db, Number(id));
    if (!fb) {
      reply.code(404);
      return { error: 'feedback not found' };
    }
    if (fb.status !== 'pending') {
      reply.code(409);
      return { error: `feedback is already ${fb.status}` };
    }
    return feedbackRepo.setStatus(ctx.db, fb.id, 'rejected', LOCAL_USER_ID);
  });

  app.post('/api/feedback/:id/rollback', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = await findCtxForFeedback(Number(id));
    if (!ctx) {
      reply.code(404);
      return { error: 'feedback not found' };
    }
    const fb = feedbackRepo.getById(ctx.db, Number(id));
    if (!fb) {
      reply.code(404);
      return { error: 'feedback not found' };
    }
    if (fb.status !== 'applied') {
      reply.code(409);
      return { error: `only applied feedback can be rolled back; status=${fb.status}` };
    }
    agentRepo.update(ctx.db, fb.agent_id, { description: fb.description_before });
    return feedbackRepo.setStatus(ctx.db, fb.id, 'rolled_back', LOCAL_USER_ID);
  });
}
