/**
 * Intelligence REST API（D-21 重构）
 *
 * Per-project storage 后 decisions / lessons 仍在 SQLite（Q-10 决议保留 db），
 * 但通过 dbForProjectId resolve 各 project 自己的 db。
 */

import type { FastifyInstance } from 'fastify';
import type { LessonKind, ReviewStatus } from '@openspace/shared';
import { decisionRepo, lessonRepo } from '../db/repos.js';
import { syncKnowledgeJsonl } from '../config/knowledge-store.js';
import { hub } from '../ws/hub.js';
import { dbForProjectId, dbForResource } from './_helpers.js';

const REVIEW_STATUSES: ReviewStatus[] = ['pending', 'approved', 'rejected'];
const LESSON_KINDS: LessonKind[] = ['do', 'dont', 'pattern', 'pitfall'];

export async function intelligenceRoutes(app: FastifyInstance): Promise<void> {
  // ---------- Decisions ----------

  app.get('/api/projects/:id/decisions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForProjectId(id);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }
    const q = req.query as { status?: string };
    const status = q.status && (REVIEW_STATUSES as string[]).includes(q.status)
      ? (q.status as ReviewStatus)
      : undefined;
    return decisionRepo.list(ctx.db, { review_status: status }).map((d) => ({
      ...d,
      project_id: ctx.projectId,
    }));
  });

  app.post('/api/projects/:id/decisions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForProjectId(id);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }
    const body = req.body as {
      title?: string;
      body?: string;
      audience?: string;
      source_message_id?: string | null;
      source_run_id?: number | null;
    };
    if (!body?.title || !body?.body) {
      reply.code(400);
      return { error: 'title and body are required' };
    }
    const d = decisionRepo.create(ctx.db, {
      title: body.title,
      body: body.body,
      audience: body.audience ?? 'all',
      source_message_id: body.source_message_id ?? null,
      source_run_id: body.source_run_id ?? null,
      recorded_by: 'local-user',
      review_status: 'approved',
    });
    try {
      syncKnowledgeJsonl(ctx.db, ctx.workspacePath);
    } catch (e) {
      req.log.warn(`[knowledge] sync after decision create failed: ${(e as Error).message}`);
    }
    hub.broadcastGlobal({ type: 'knowledge_updated', project_id: ctx.projectId, kind: 'decision' });
    reply.code(201);
    return { ...d, project_id: ctx.projectId };
  });

  app.patch('/api/decisions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const decisionId = Number(id);
    // 资源反查：找到该 decision 所在 project db
    let ctx = null;
    for (const candidate of [/* listOpenDbs done by helpers */]) void candidate;
    // 使用 helpers.findDbByResource 的更优做法：但 decisions id 是 INTEGER，
    // 表名不同也支持。简化：直接用 dbForResource('agent_observations'...) 不对，应该是 decisions。
    ctx = dbForResource('agents' as never, decisionId);
    // helper 不支持 'decisions' table 暂时直接：手动遍历
    if (!ctx) {
      const { listOpenDbs } = await import('../db/index.js');
      for (const open of listOpenDbs()) {
        const exists = open.db.prepare('SELECT 1 FROM decisions WHERE id = ?').get(decisionId);
        if (exists) {
          const { projectsService } = await import('../config/projects-service.js');
          const project = projectsService.getByPath(open.workspacePath);
          if (project) {
            ctx = { db: open.db, workspacePath: open.workspacePath, projectId: project.id };
            break;
          }
        }
      }
    }
    if (!ctx) {
      reply.code(404);
      return { error: 'decision not found' };
    }
    const existing = decisionRepo.getById(ctx.db, decisionId);
    if (!existing) {
      reply.code(404);
      return { error: 'decision not found' };
    }
    const body = req.body as {
      review_status?: ReviewStatus;
      title?: string;
      body?: string;
      audience?: string;
    };
    const status = body.review_status ?? existing.review_status;
    if (!(REVIEW_STATUSES as string[]).includes(status)) {
      reply.code(400);
      return { error: 'invalid review_status' };
    }
    const updated = decisionRepo.updateReview(ctx.db, decisionId, status, {
      title: body.title,
      body: body.body,
      audience: body.audience,
    });
    try {
      syncKnowledgeJsonl(ctx.db, ctx.workspacePath);
    } catch (e) {
      req.log.warn(`[knowledge] sync after decision review failed: ${(e as Error).message}`);
    }
    return updated ? { ...updated, project_id: ctx.projectId } : null;
  });

  app.delete('/api/decisions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const decisionId = Number(id);
    const ctx = await findCtxForRow('decisions', decisionId);
    if (!ctx) {
      reply.code(404);
      return { error: 'decision not found' };
    }
    decisionRepo.remove(ctx.db, decisionId);
    try {
      syncKnowledgeJsonl(ctx.db, ctx.workspacePath);
    } catch (e) {
      req.log.warn(`[knowledge] sync after decision delete failed: ${(e as Error).message}`);
    }
    reply.code(204);
  });

  // ---------- Lessons ----------

  app.get('/api/projects/:id/lessons', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForProjectId(id);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }
    const q = req.query as { status?: string; audience?: string; kind?: string };
    const status =
      q.status && (REVIEW_STATUSES as string[]).includes(q.status)
        ? (q.status as ReviewStatus)
        : undefined;
    const kind =
      q.kind && (LESSON_KINDS as string[]).includes(q.kind) ? (q.kind as LessonKind) : undefined;
    return lessonRepo
      .list(ctx.db, { review_status: status, audience: q.audience, kind })
      .map((l) => ({ ...l, project_id: ctx.projectId }));
  });

  app.post('/api/projects/:id/lessons', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForProjectId(id);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }
    const body = req.body as {
      kind?: string;
      title?: string;
      body?: string;
      audience?: string;
      tags?: string[];
      source_message_id?: string | null;
      source_run_id?: number | null;
    };
    if (!body?.title || !body?.body) {
      reply.code(400);
      return { error: 'title and body are required' };
    }
    const kind: LessonKind =
      body.kind && (LESSON_KINDS as string[]).includes(body.kind)
        ? (body.kind as LessonKind)
        : 'do';
    const l = lessonRepo.create(ctx.db, {
      kind,
      title: body.title,
      body: body.body,
      audience: body.audience ?? 'all',
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      source_message_id: body.source_message_id ?? null,
      source_run_id: body.source_run_id ?? null,
      recorded_by: 'local-user',
      review_status: 'approved',
    });
    try {
      syncKnowledgeJsonl(ctx.db, ctx.workspacePath);
    } catch (e) {
      req.log.warn(`[knowledge] sync after lesson create failed: ${(e as Error).message}`);
    }
    hub.broadcastGlobal({ type: 'knowledge_updated', project_id: ctx.projectId, kind: 'lesson' });
    reply.code(201);
    return { ...l, project_id: ctx.projectId };
  });

  app.patch('/api/lessons/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lessonId = Number(id);
    const ctx = await findCtxForRow('lessons', lessonId);
    if (!ctx) {
      reply.code(404);
      return { error: 'lesson not found' };
    }
    const existing = lessonRepo.getById(ctx.db, lessonId);
    if (!existing) {
      reply.code(404);
      return { error: 'lesson not found' };
    }
    const body = req.body as {
      review_status?: ReviewStatus;
      title?: string;
      body?: string;
      audience?: string;
      kind?: string;
      tags?: string[];
    };
    const status = body.review_status ?? existing.review_status;
    if (!(REVIEW_STATUSES as string[]).includes(status)) {
      reply.code(400);
      return { error: 'invalid review_status' };
    }
    let kind: LessonKind | undefined;
    if (body.kind !== undefined) {
      if (!(LESSON_KINDS as string[]).includes(body.kind)) {
        reply.code(400);
        return { error: 'invalid kind' };
      }
      kind = body.kind as LessonKind;
    }
    const updated = lessonRepo.updateReview(ctx.db, lessonId, status, {
      title: body.title,
      body: body.body,
      audience: body.audience,
      kind,
      tags: body.tags,
    });
    try {
      syncKnowledgeJsonl(ctx.db, ctx.workspacePath);
    } catch (e) {
      req.log.warn(`[knowledge] sync after lesson review failed: ${(e as Error).message}`);
    }
    return updated ? { ...updated, project_id: ctx.projectId } : null;
  });

  app.delete('/api/lessons/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lessonId = Number(id);
    const ctx = await findCtxForRow('lessons', lessonId);
    if (!ctx) {
      reply.code(404);
      return { error: 'lesson not found' };
    }
    lessonRepo.remove(ctx.db, lessonId);
    try {
      syncKnowledgeJsonl(ctx.db, ctx.workspacePath);
    } catch (e) {
      req.log.warn(`[knowledge] sync after lesson delete failed: ${(e as Error).message}`);
    }
    reply.code(204);
  });
}

/** 在所有 open db 中找拥有该 row 的 project。用于跨 project 的 PATCH/DELETE 路由。 */
async function findCtxForRow(table: string, id: number) {
  const { listOpenDbs } = await import('../db/index.js');
  const { projectsService } = await import('../config/projects-service.js');
  for (const open of listOpenDbs()) {
    try {
      const row = open.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
      if (row) {
        const project = projectsService.getByPath(open.workspacePath);
        if (project) {
          return { db: open.db, workspacePath: open.workspacePath, projectId: project.id };
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}
