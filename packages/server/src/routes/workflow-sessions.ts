/**
 * Workflow Sessions REST API（D-21 重构）
 */

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { Project } from '@openspace/shared';
import { LOCAL_USER_ID } from '@openspace/shared';
import {
  agentRepo,
  workflowRepo,
  workflowSessionRepo,
} from '../db/repos.js';
import { runFacilitator } from '../system-agents/facilitator.js';
import { parseWorkflowYaml, WorkflowYamlError } from '../workflows/yaml-parser.js';
import { deriveResponsibilitiesForWorkflow } from '../workflows/derive-responsibilities.js';
import { dbForProjectId } from './_helpers.js';
import { projectsService } from '../config/projects-service.js';

export async function workflowSessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:id/workflow-sessions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForProjectId(id);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }
    return workflowSessionRepo.list(ctx.db).map((s) => ({ ...s, project_id: ctx.projectId }));
  });

  app.post('/api/projects/:id/workflow-sessions', async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    const ctx = dbForProjectId(projectId);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }
    const project = projectsService.getById(projectId);
    if (!project) {
      reply.code(404);
      return { error: 'project not found' };
    }
    const body = req.body as { goal_input?: string };
    if (!body?.goal_input || typeof body.goal_input !== 'string') {
      reply.code(400);
      return { error: 'goal_input is required' };
    }

    const session = workflowSessionRepo.create(ctx.db, {
      goal_input: body.goal_input.trim(),
      started_by: LOCAL_USER_ID,
    });

    void facilitateInBackground(ctx.db, session.id, project, {
      info: (m) => req.log.info(m),
      warn: (m) => req.log.warn(m),
    }).catch((e: Error) => req.log.warn(`[facilitator] ${e.message}`));

    reply.code(201);
    return { ...session, project_id: ctx.projectId };
  });

  app.get('/api/workflow-sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = await findCtxForRow('workflow_sessions', Number(id));
    if (!ctx) {
      reply.code(404);
      return { error: 'session not found' };
    }
    const s = workflowSessionRepo.getById(ctx.db, Number(id));
    return s ? { ...s, project_id: ctx.projectId } : null;
  });

  app.post('/api/workflow-sessions/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = await findCtxForRow('workflow_sessions', Number(id));
    if (!ctx) {
      reply.code(404);
      return { error: 'session not found' };
    }
    const session = workflowSessionRepo.getById(ctx.db, Number(id));
    if (!session) {
      reply.code(404);
      return { error: 'session not found' };
    }
    if (session.status !== 'awaiting_approval' || !session.draft_yaml) {
      reply.code(409);
      return { error: `session is ${session.status}; cannot approve` };
    }
    const body = (req.body ?? {}) as {
      name?: string;
      trigger_command?: string;
    };

    let definition;
    try {
      definition = parseWorkflowYaml(session.draft_yaml);
    } catch (e) {
      const msg = e instanceof WorkflowYamlError ? e.message : (e as Error).message;
      reply.code(400);
      return { error: `draft YAML invalid: ${msg}` };
    }
    const trigger = body.trigger_command ?? definition.trigger.command;
    const name = body.name ?? definition.name;

    const conflict = workflowRepo.getByTrigger(ctx.db, trigger);
    if (conflict) {
      reply.code(409);
      return {
        error: `trigger_command "${trigger}" already used by workflow "${conflict.name}"`,
      };
    }

    const wf = workflowRepo.create(ctx.db, {
      name,
      description: definition.description ?? null,
      trigger_command: trigger,
      definition_yaml: session.draft_yaml,
      source: 'user',
    });
    try {
      deriveResponsibilitiesForWorkflow(ctx.db, wf.id);
    } catch (e) {
      req.log.warn(`[workflow-session] derive failed: ${(e as Error).message}`);
    }

    const updated = workflowSessionRepo.update(ctx.db, session.id, {
      status: 'approved',
      workflow_id: wf.id,
      ended: true,
    });
    return {
      session: updated ? { ...updated, project_id: ctx.projectId } : null,
      workflow: { ...wf, project_id: ctx.projectId },
    };
  });

  app.post('/api/workflow-sessions/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = await findCtxForRow('workflow_sessions', Number(id));
    if (!ctx) {
      reply.code(404);
      return { error: 'session not found' };
    }
    const session = workflowSessionRepo.getById(ctx.db, Number(id));
    if (!session) {
      reply.code(404);
      return { error: 'session not found' };
    }
    if (session.status === 'approved' || session.status === 'archived') {
      reply.code(409);
      return { error: `session is ${session.status}; cannot reject` };
    }
    const updated = workflowSessionRepo.update(ctx.db, session.id, {
      status: 'rejected',
      ended: true,
    });
    return updated ? { ...updated, project_id: ctx.projectId } : null;
  });

  app.post('/api/workflow-sessions/:id/archive', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = await findCtxForRow('workflow_sessions', Number(id));
    if (!ctx) {
      reply.code(404);
      return { error: 'session not found' };
    }
    const session = workflowSessionRepo.getById(ctx.db, Number(id));
    if (!session) {
      reply.code(404);
      return { error: 'session not found' };
    }
    const updated = workflowSessionRepo.update(ctx.db, session.id, {
      status: 'archived',
      ended: true,
    });
    return updated ? { ...updated, project_id: ctx.projectId } : null;
  });
}

async function facilitateInBackground(
  db: Database,
  sessionId: number,
  project: Project,
  logger: { info: (m: string) => void; warn: (m: string) => void },
): Promise<void> {
  const session = workflowSessionRepo.getById(db, sessionId);
  if (!session || session.status !== 'drafting') return;
  const agents = agentRepo.list(db);
  const out = await runFacilitator(
    { project, agents, goal_input: session.goal_input },
    logger,
  );
  if (!out.ok) {
    workflowSessionRepo.update(db, sessionId, {
      status: 'failed',
      fallback_reason: out.fallback_reason ?? 'unknown',
      ended: true,
    });
    return;
  }
  workflowSessionRepo.update(db, sessionId, {
    status: 'awaiting_approval',
    draft_yaml: out.yaml ?? '',
    rationale: out.rationale ?? null,
  });
}

/** 跨 db 反查 row 所在 project（用法同 intelligence.ts findCtxForRow）*/
async function findCtxForRow(table: string, id: number) {
  const { listOpenDbs } = await import('../db/index.js');
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
