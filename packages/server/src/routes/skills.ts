/**
 * Skill Matrix REST API（D-21 重构）
 */

import type { FastifyInstance } from 'fastify';
import { agentRepo, skillRepo } from '../db/repos.js';
import { dbForProjectId, dbForResource } from './_helpers.js';

export async function skillRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agents/:id/skills', async (req, reply) => {
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
    return skillRepo.listByAgent(ctx.db, id).map((s) => ({ ...s, project_id: ctx.projectId }));
  });

  app.get('/api/projects/:id/skills', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForProjectId(id);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }
    return skillRepo.list(ctx.db).map((s) => ({ ...s, project_id: ctx.projectId }));
  });

  app.get('/api/projects/:id/skill-suggest', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForProjectId(id);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }
    const q = req.query as { keyword?: string };
    if (!q.keyword || !q.keyword.trim()) return [];
    return skillRepo.suggestAgents(ctx.db, q.keyword.trim(), 5);
  });
}
