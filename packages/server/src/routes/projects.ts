/**
 * Projects REST API（D-21 重构）
 *
 * Per-Project Storage 后的 API 形态：
 *   GET    /api/projects                       — 列出 ~/.openspace/projects.json 中的全部 recent
 *   GET    /api/projects/:id                   — 单个项目（id = nanoid，存于 project.json）
 *   GET    /api/projects/by-name/:name         — 按 slug 查
 *   POST   /api/projects/open                  — 打开 / 创建 project（Cursor 风格 open folder）
 *   PATCH  /api/projects/:id                   — 改 project.json 元数据
 *   POST   /api/projects/:id/close             — 仅从 recent 移除（保留 .openspace/）
 *   POST   /api/projects/:id/delete-storage    — rm -rf <path>/.openspace/（不可撤销）
 *   GET    /api/projects/:id/onboarding        — 当前 onboarding 摘要
 *   POST   /api/projects/:id/onboarding/run    — 触发 Onboarder 重新生成
 *   POST   /api/projects/suggest-team          — Team Architect（无 project 创建依赖）
 *
 * 历史 POST /api/projects（带向导字段）由 OpenProjectDialog 走 /open 替代。
 * 历史 DELETE /api/projects/:id 由 /close 与 /delete-storage 双按钮替代（Q-11）。
 */

import type { FastifyInstance } from 'fastify';
import { GOAL_MAX_LENGTH } from '@openspace/shared';
import { onboardingRepo } from '../db/repos.js';
import { closeProjectDb, openProjectDb } from '../db/index.js';
import { projectsService } from '../config/projects-service.js';
import { suggestTeam } from '../system-agents/team-architect.js';
import { runOnboarderForProject } from '../system-agents/onboarder.js';
import { importBuiltinsForProject } from '../workflows/builtin-import.js';
import { hub } from '../ws/hub.js';

const NAME_SLUG_RE = /^[a-z0-9_-]+$/;

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // ---------- list ----------
  app.get('/api/projects', async () => projectsService.list());

  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = projectsService.getById(id);
    if (!p) {
      reply.code(404);
      return { error: 'project not found' };
    }
    return p;
  });

  app.get('/api/projects/by-name/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const p = projectsService.getByName(name);
    if (!p) {
      reply.code(404);
      return { error: 'project not found' };
    }
    return p;
  });

  // ---------- open / create ----------
  app.post('/api/projects/open', async (req, reply) => {
    const body = req.body as {
      workspace_path?: string;
      name?: string;
      display_name?: string | null;
      goal?: string;
      team_rules?: string | null;
      color?: string | null;
    };
    if (!body?.workspace_path || typeof body.workspace_path !== 'string') {
      reply.code(400);
      return { error: 'workspace_path is required' };
    }
    if (body.name !== undefined && !NAME_SLUG_RE.test(body.name)) {
      reply.code(400);
      return {
        error: 'name must be URL-safe: lowercase letters, digits, "-" and "_" only',
      };
    }
    if (body.goal !== undefined && body.goal.length > GOAL_MAX_LENGTH) {
      reply.code(400);
      return {
        error: `goal too long: ${body.goal.length} > ${GOAL_MAX_LENGTH} chars`,
      };
    }

    let result: ReturnType<typeof projectsService.open>;
    try {
      result = projectsService.open({
        workspace_path: body.workspace_path,
        name: body.name,
        display_name: body.display_name ?? null,
        goal: body.goal,
        team_rules: body.team_rules ?? null,
        color: body.color ?? null,
      });
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message };
    }

    // 触发 per-project db 创建
    const db = openProjectDb(result.project.workspace_path);

    if (result.isNew) {
      // 新建 project：seed builtin workflows + 异步触发 onboarder + 写 .gitignore
      try {
        const importRes = importBuiltinsForProject(db);
        req.log.info(
          { project_id: result.project.id, ...importRes },
          '[workflows] builtin templates imported',
        );
      } catch (e) {
        req.log.warn(
          { err: e, project_id: result.project.id },
          '[workflows] failed to import builtin templates',
        );
      }
      void runOnboarderForProject(db, result.project, {
        info: (m) => req.log.info(m),
        warn: (m) => req.log.warn(m),
      }).catch((e: Error) => req.log.warn(`[onboarder] ${e.message}`));
      try {
        projectsService.ensureGitignore(result.project.workspace_path);
      } catch (e) {
        req.log.warn(`[projects] ensureGitignore failed: ${(e as Error).message}`);
      }
      try {
        projectsService.ensureReadme(result.project.workspace_path);
      } catch (e) {
        req.log.warn(`[projects] ensureReadme failed: ${(e as Error).message}`);
      }
    }

    hub.broadcastGlobal({ type: 'project_list_changed', reason: 'opened' });

    reply.code(result.isNew ? 201 : 200);
    return { project: result.project, is_new: result.isNew };
  });

  // ---------- onboarding ----------
  app.get('/api/projects/:id/onboarding', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = projectsService.getById(id);
    if (!p) {
      reply.code(404);
      return { error: 'project not found' };
    }
    const db = openProjectDb(p.workspace_path);
    const onb = onboardingRepo.get(db);
    return onb ? { ...onb, project_id: p.id } : { project_id: p.id, ready: false };
  });

  app.post('/api/projects/:id/onboarding/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = projectsService.getById(id);
    if (!p) {
      reply.code(404);
      return { error: 'project not found' };
    }
    const db = openProjectDb(p.workspace_path);
    try {
      await runOnboarderForProject(db, p, {
        info: (m) => req.log.info(m),
        warn: (m) => req.log.warn(m),
      });
      const got = onboardingRepo.get(db);
      return got ? { ...got, project_id: p.id } : null;
    } catch (e) {
      reply.code(500);
      return { error: (e as Error).message };
    }
  });

  // ---------- update ----------
  app.patch('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<{
      name: string;
      display_name: string | null;
      goal: string;
      team_rules: string | null;
      color: string | null;
    }>;

    if (!body) {
      reply.code(400);
      return { error: 'empty body' };
    }
    if (body.name !== undefined && !NAME_SLUG_RE.test(body.name)) {
      reply.code(400);
      return {
        error: 'name must be URL-safe: lowercase letters, digits, "-" and "_" only',
      };
    }
    if (body.goal !== undefined && body.goal.length > GOAL_MAX_LENGTH) {
      reply.code(400);
      return {
        error: `goal too long: ${body.goal.length} > ${GOAL_MAX_LENGTH} chars`,
      };
    }
    if (body.name) {
      const existing = projectsService.getByName(body.name);
      if (existing && existing.id !== id) {
        reply.code(409);
        return { error: `project with name "${body.name}" already exists` };
      }
    }

    const p = projectsService.update(id, body);
    if (!p) {
      reply.code(404);
      return { error: 'project not found' };
    }
    hub.broadcastGlobal({ type: 'project_list_changed', reason: 'updated' });
    return p;
  });

  // ---------- close (Q-11) ----------
  app.post('/api/projects/:id/close', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = projectsService.getById(id);
    if (!p) {
      reply.code(404);
      return { error: 'project not found' };
    }
    closeProjectDb(p.workspace_path);
    projectsService.close(id);
    hub.broadcastGlobal({ type: 'project_list_changed', reason: 'closed' });
    reply.code(204);
  });

  // ---------- delete-storage (Q-11) ----------
  app.post('/api/projects/:id/delete-storage', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { confirm_name?: string };
    const p = projectsService.getById(id);
    if (!p) {
      reply.code(404);
      return { error: 'project not found' };
    }
    if (body.confirm_name !== p.name) {
      reply.code(400);
      return {
        error: `confirm_name must equal "${p.name}" to delete this project's .openspace/ storage`,
      };
    }
    closeProjectDb(p.workspace_path);
    projectsService.deleteStorage(id);
    hub.broadcastGlobal({ type: 'project_list_changed', reason: 'deleted' });
    reply.code(204);
  });

  // ---------- suggest-team（无 project 创建依赖）----------
  app.post('/api/projects/suggest-team', async (req, reply) => {
    const body = req.body as {
      goal?: string;
      workspace_path?: string;
      workspace_hint?: { stack?: string; readme_excerpt?: string };
    };
    if (!body?.goal || typeof body.goal !== 'string') {
      reply.code(400);
      return { error: 'goal is required' };
    }
    if (body.goal.length > GOAL_MAX_LENGTH) {
      reply.code(400);
      return {
        error: `goal too long: ${body.goal.length} > ${GOAL_MAX_LENGTH} chars`,
      };
    }
    if (!body.workspace_path || typeof body.workspace_path !== 'string') {
      reply.code(400);
      return { error: 'workspace_path is required' };
    }

    req.log.info(
      { goal_len: body.goal.length, workspace_path: body.workspace_path },
      '[team-architect] suggestion requested',
    );

    const result = await suggestTeam({
      goal: body.goal,
      workspace_path: body.workspace_path,
      workspace_hint: body.workspace_hint,
    });

    if (result.is_fallback) {
      req.log.warn(
        { reason: result.fallback_reason },
        '[team-architect] returned fallback team',
      );
    } else {
      req.log.info(
        { agents: result.agents.map((a) => a.name).join(', ') },
        '[team-architect] suggested team',
      );
    }

    return result;
  });
}
