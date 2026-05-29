import type { FastifyInstance } from 'fastify';
import { channelRepo, agentRepo, messageRepo } from '../db/repos.js';
import { abortChannelAgentRuns } from '../agents/engine.js';
import {
  dbForProjectId,
  dbForResource,
  forEachProjectDb,
} from './_helpers.js';

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  // 列出频道；可选 ?project_id= 过滤
  app.get('/api/channels', async (req) => {
    const query = req.query as { project_id?: string };
    if (query.project_id) {
      const ctx = dbForProjectId(query.project_id);
      if (!ctx) return [];
      return channelRepo.list(ctx.db).map((c) => ({ ...c, project_id: ctx.projectId }));
    }
    // 全局：遍历所有 open project，合并 channels 列表
    return forEachProjectDb(({ db, projectId }) =>
      channelRepo.list(db).map((c) => ({ ...c, project_id: projectId })),
    );
  });

  // 创建频道（必须带 project_id 指明归属）
  app.post('/api/channels', async (req, reply) => {
    const body = req.body as {
      id?: string;
      name: string;
      description?: string | null;
      type?: 'channel' | 'dm';
      project_id?: string | null;
    };
    if (!body?.name) {
      reply.code(400);
      return { error: 'name is required' };
    }
    if (!body.project_id) {
      reply.code(400);
      return { error: 'project_id is required (D-21: channel must belong to a project)' };
    }
    const ctx = dbForProjectId(body.project_id);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }
    const channel = channelRepo.create(ctx.db, {
      id: body.id,
      name: body.name,
      description: body.description ?? null,
      type: body.type ?? 'channel',
    });
    return { ...channel, project_id: ctx.projectId };
  });

  // 频道详情
  app.get('/api/channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('channels', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'channel not found' };
    }
    const ch = channelRepo.getById(ctx.db, id);
    if (!ch) {
      reply.code(404);
      return { error: 'channel not found' };
    }
    return { ...ch, project_id: ctx.projectId };
  });

  // 更新频道
  app.patch('/api/channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('channels', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'channel not found' };
    }
    const body = req.body as { name?: string; description?: string | null };
    const ch = channelRepo.update(ctx.db, id, body ?? {});
    if (!ch) {
      reply.code(404);
      return { error: 'channel not found' };
    }
    return { ...ch, project_id: ctx.projectId };
  });

  // 删除频道
  app.delete('/api/channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('channels', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'channel not found' };
    }
    channelRepo.remove(ctx.db, id);
    reply.code(204);
  });

  // 频道主线消息列表
  app.get('/api/channels/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('channels', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'channel not found' };
    }
    const query = req.query as { limit?: string; before?: string; parent_id?: string };
    const limit = query.limit ? Math.min(200, Number(query.limit)) : 50;

    if (query.parent_id) {
      return messageRepo.listThread(ctx.db, query.parent_id);
    }
    return messageRepo.listChannelMain(ctx.db, id, limit, query.before);
  });

  // 频道内 agent 列表
  app.get('/api/channels/:id/agents', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('channels', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'channel not found' };
    }
    return agentRepo.listInChannel(ctx.db, id);
  });

  // 加入 agent
  app.post('/api/channels/:id/agents', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('channels', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'channel not found' };
    }
    const { agent_id } = req.body as { agent_id: string };
    if (!agent_id) {
      reply.code(400);
      return { error: 'agent_id is required' };
    }
    agentRepo.addToChannel(ctx.db, id, agent_id);
    reply.code(201);
    return { ok: true };
  });

  // 移除 agent
  app.delete('/api/channels/:id/agents/:agentId', async (req, reply) => {
    const { id, agentId } = req.params as { id: string; agentId: string };
    const ctx = dbForResource('channels', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'channel not found' };
    }
    agentRepo.removeFromChannel(ctx.db, id, agentId);
    reply.code(204);
  });

  // Stop all agents in channel
  app.post('/api/channels/:id/stop-all', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('channels', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'channel not found' };
    }
    const killed = abortChannelAgentRuns(ctx.db, id);
    return { stopped: killed };
  });
}
