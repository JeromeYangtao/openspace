import type { FastifyInstance } from 'fastify';
import type { ReasoningEffort, Runtime } from '@openspace/shared';
import { agentRepo, agentRunRepo, activityRepo, runtimeSessionRepo, workflowRepo } from '../db/repos.js';
import { deriveResponsibilitiesForWorkflow } from '../workflows/derive-responsibilities.js';
import { projectsService } from '../config/projects-service.js';
import {
  dbForProjectId,
  dbForResource,
  forEachProjectDb,
} from './_helpers.js';
import { canAccessChannel } from '../auth/channel-access.js';
import { getUserFromRequest } from '../auth/session.js';
import { abortSingleAgentRun } from '../agents/run-manager.js';
import { compactCodexThread } from '../agents/codex-app-server-adapter.js';

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // 列出 agent；可选 ?project_id= 过滤
  app.get('/api/agents', async (req) => {
    const query = req.query as { project_id?: string };
    if (query.project_id) {
      const ctx = dbForProjectId(query.project_id);
      if (!ctx) return [];
      return agentRepo.list(ctx.db).map((a) => ({ ...a, project_id: ctx.projectId }));
    }
    return forEachProjectDb(({ db, projectId }) =>
      agentRepo.list(db).map((a) => ({ ...a, project_id: projectId })),
    );
  });

  app.get('/api/agent-runs/active', async () => {
    return forEachProjectDb(({ db, projectId }) =>
      agentRunRepo.listActive(db).map((run) => ({ ...run, project_id: projectId })),
    );
  });

  app.post('/api/agent-runs/:id/abort', async (req, reply) => {
    const { id } = req.params as { id: string };
    const runId = Number(id);
    if (!Number.isFinite(runId)) {
      reply.code(400);
      return { error: 'invalid run id' };
    }
    const ctx = dbForResource('agent_runs', runId);
    if (!ctx) {
      reply.code(404);
      return { error: 'agent run not found' };
    }
    const run = agentRunRepo.getById(ctx.db, runId);
    if (!run) {
      reply.code(404);
      return { error: 'agent run not found' };
    }
    const user = getUserFromRequest(req);
    if (!user || !canAccessChannel(ctx.db, run.channel_id, user)) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    const stopped = abortSingleAgentRun(ctx.db, runId);
    return { ok: true, stopped };
  });

  // 创建 agent（必须带 project_id）
  app.post('/api/agents', async (req, reply) => {
    const body = req.body as {
      name: string;
      /**
       * Sprint 8 / Lo-26: 团队角色标签（implementer / reviewer / qa / architect / scribe / ...）。
       * 用于 workflow YAML 占位符（@implementer 等）路由。可选；缺失走 byName 兼容路径。
       */
      role?: string | null;
      description?: string | null;
      runtime: Runtime;
      model?: string | null;
      reasoning?: ReasoningEffort | null;
      thinking?: boolean | null;
      context?: '300k' | '1m' | null;
      env_vars?: Record<string, string>;
      avatar?: string | null;
      project_id?: string | null;
    };
    if (!body?.name || !body?.runtime) {
      reply.code(400);
      return { error: 'name and runtime are required' };
    }
    if (!body.project_id) {
      reply.code(400);
      return { error: 'project_id is required (D-21: agent must belong to a project)' };
    }
    const ctx = dbForProjectId(body.project_id);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }
    if (agentRepo.getByName(ctx.db, body.name)) {
      reply.code(409);
      return { error: `agent with name "${body.name}" already exists in this project` };
    }

    const agent = agentRepo.create(ctx.db, body);

    // 重新 derive 该 project 内 workflow 的 responsibilities，让 'unresolved:<name>' 升级
    const wfs = workflowRepo.list(ctx.db);
    for (const wf of wfs) {
      try {
        deriveResponsibilitiesForWorkflow(ctx.db, wf.id);
      } catch (e) {
        req.log.warn(
          { err: e, workflow: wf.name, agent: agent.name },
          '[workflows] failed to re-derive after agent create',
        );
      }
    }

    reply.code(201);
    return { ...agent, project_id: ctx.projectId };
  });

  // 详情
  app.get('/api/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('agents', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    const a = agentRepo.getById(ctx.db, id);
    if (!a) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    return { ...a, project_id: ctx.projectId };
  });

  // 更新
  app.patch('/api/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('agents', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    const body = req.body as Parameters<typeof agentRepo.update>[2];
    const a = agentRepo.update(ctx.db, id, body ?? {});
    if (!a) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    return { ...a, project_id: ctx.projectId };
  });

  // 删除
  app.delete('/api/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('agents', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    agentRepo.remove(ctx.db, id);
    reply.code(204);
  });

  // 启动 / 停止 / 重启 — 仅校验存在
  app.post('/api/agents/:id/start', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!dbForResource('agents', id)) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    return { ok: true };
  });

  app.post('/api/agents/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!dbForResource('agents', id)) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    return { ok: true };
  });

  app.post('/api/agents/:id/restart', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!dbForResource('agents', id)) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    return { ok: true };
  });

  app.post('/api/agents/:id/compact', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { channel_id?: string };
    const channelId = body?.channel_id;
    if (!channelId) {
      reply.code(400);
      return { error: 'channel_id is required' };
    }

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
    const user = getUserFromRequest(req);
    if (!user || !canAccessChannel(ctx.db, channelId, user)) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    if (agent.runtime !== 'codex') {
      reply.code(400);
      return { error: 'manual compact is only available for Codex agents' };
    }

    const sessionId = runtimeSessionRepo.get(ctx.db, {
      runtime: agent.runtime,
      agent_id: agent.id,
      channel_id: channelId,
    });
    if (!sessionId) {
      reply.code(404);
      return { error: 'no Codex session found for this agent in this channel' };
    }

    const project = projectsService.getById(ctx.projectId);
    try {
      const result = await compactCodexThread({
        threadId: sessionId,
        workingDirectory: project?.workspace_path,
        model: agent.model,
      });
      return result;
    } catch (e) {
      req.log.warn({ err: e, agent_id: id, channel_id: channelId }, '[agents] compact failed');
      reply.code(500);
      return { error: (e as Error).message };
    }
  });

  app.get('/api/agents/:id/activity', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('agents', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    const query = req.query as { limit?: string; before?: string; channel_id?: string };
    const limit = query.limit ? Math.min(200, Number(query.limit)) : 50;
    const before = query.before ? Number(query.before) : undefined;
    return activityRepo.list(ctx.db, id, limit, before, query.channel_id);
  });

  app.get('/api/agents/:id/status', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('agents', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'agent not found' };
    }
    const activeRuns = agentRunRepo.listActiveForAgent(ctx.db, id);
    const perChannel: Record<string, 'thinking' | 'working' | 'error' | 'stopped'> = {};
    for (const run of activeRuns) {
      perChannel[run.channel_id] = run.status;
    }
    return {
      agent_id: id,
      per_channel: perChannel,
      any_active: activeRuns.length > 0,
    };
  });
}
