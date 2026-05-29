/**
 * Workflows REST API（D-21 重构）
 */

import type { FastifyInstance } from 'fastify';
import {
  channelRepo,
  responsibilityRepo,
  workflowRepo,
  workflowRunRepo,
} from '../db/repos.js';
import { parseWorkflowYaml, WorkflowYamlError } from '../workflows/yaml-parser.js';
import { abortWorkflowRun } from '../workflows/runner.js';
import { deriveResponsibilitiesForWorkflow } from '../workflows/derive-responsibilities.js';
import {
  dbForProjectId,
  dbForResource,
  forEachProjectDb,
} from './_helpers.js';

const COMMAND_RE = /^\/[a-z][a-z0-9-]*$/;

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects/:id/workflows', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForProjectId(id);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }
    return workflowRepo.list(ctx.db).map((w) => ({ ...w, project_id: ctx.projectId }));
  });

  app.post('/api/projects/:id/workflows', async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    const ctx = dbForProjectId(projectId);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }

    const body = req.body as {
      name?: string;
      description?: string | null;
      trigger_command?: string;
      definition_yaml?: string;
    };

    if (!body?.name || typeof body.name !== 'string') {
      reply.code(400);
      return { error: 'name is required' };
    }
    if (!body.trigger_command || typeof body.trigger_command !== 'string') {
      reply.code(400);
      return { error: 'trigger_command is required (e.g. "/new-feature")' };
    }
    if (!COMMAND_RE.test(body.trigger_command)) {
      reply.code(400);
      return {
        error: 'trigger_command must match /^\\/[a-z][a-z0-9-]*$/ (e.g. "/new-feature")',
      };
    }
    if (!body.definition_yaml || typeof body.definition_yaml !== 'string') {
      reply.code(400);
      return { error: 'definition_yaml is required' };
    }

    let definition;
    try {
      definition = parseWorkflowYaml(body.definition_yaml);
    } catch (e) {
      if (e instanceof WorkflowYamlError) {
        reply.code(400);
        return { error: `invalid YAML: ${e.message}` };
      }
      throw e;
    }
    if (definition.trigger.command !== body.trigger_command) {
      reply.code(400);
      return {
        error: `trigger_command mismatch: body says "${body.trigger_command}" but YAML says "${definition.trigger.command}"`,
      };
    }

    const existing = workflowRepo.getByTrigger(ctx.db, body.trigger_command);
    if (existing) {
      reply.code(409);
      return {
        error: `trigger_command "${body.trigger_command}" already used by workflow "${existing.name}" in this project`,
      };
    }

    const wf = workflowRepo.create(ctx.db, {
      name: body.name,
      description: body.description ?? null,
      trigger_command: body.trigger_command,
      definition_yaml: body.definition_yaml,
      source: 'user',
    });

    try {
      const res = deriveResponsibilitiesForWorkflow(ctx.db, wf.id);
      if (res.unresolved.length > 0) {
        req.log.warn(
          { workflow: wf.name, unresolved: res.unresolved },
          '[workflows] derived responsibilities have unresolved agents',
        );
      }
    } catch (e) {
      req.log.warn({ err: e, workflow: wf.name }, '[workflows] derive failed');
    }

    reply.code(201);
    return { ...wf, project_id: ctx.projectId };
  });

  app.get('/api/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('workflows', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'workflow not found' };
    }
    const wf = workflowRepo.getById(ctx.db, id);
    if (!wf) {
      reply.code(404);
      return { error: 'workflow not found' };
    }
    return { ...wf, project_id: ctx.projectId };
  });

  app.patch('/api/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('workflows', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'workflow not found' };
    }
    const wf = workflowRepo.getById(ctx.db, id);
    if (!wf) {
      reply.code(404);
      return { error: 'workflow not found' };
    }
    const body = req.body as Partial<{
      name: string;
      description: string | null;
      trigger_command: string;
      definition_yaml: string;
    }>;
    if (body.trigger_command !== undefined && !COMMAND_RE.test(body.trigger_command)) {
      reply.code(400);
      return { error: 'trigger_command must match /^\\/[a-z][a-z0-9-]*$/' };
    }
    if (body.definition_yaml !== undefined) {
      try {
        const def = parseWorkflowYaml(body.definition_yaml);
        const triggerCmd = body.trigger_command ?? wf.trigger_command;
        if (def.trigger.command !== triggerCmd) {
          reply.code(400);
          return { error: `trigger_command mismatch: ${triggerCmd} vs YAML ${def.trigger.command}` };
        }
      } catch (e) {
        if (e instanceof WorkflowYamlError) {
          reply.code(400);
          return { error: `invalid YAML: ${e.message}` };
        }
        throw e;
      }
    }
    if (body.trigger_command !== undefined && body.trigger_command !== wf.trigger_command) {
      const conflict = workflowRepo.getByTrigger(ctx.db, body.trigger_command);
      if (conflict && conflict.id !== id) {
        reply.code(409);
        return { error: `trigger_command "${body.trigger_command}" already used` };
      }
    }
    const updated = workflowRepo.update(ctx.db, id, body);
    if (updated && body.definition_yaml !== undefined) {
      try {
        deriveResponsibilitiesForWorkflow(ctx.db, updated.id);
      } catch (e) {
        req.log.warn({ err: e, workflow: updated.name }, '[workflows] re-derive failed');
      }
    }
    return updated ? { ...updated, project_id: ctx.projectId } : null;
  });

  app.delete('/api/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('workflows', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'workflow not found' };
    }
    workflowRepo.remove(ctx.db, id);
    reply.code(204);
  });

  app.get('/api/workflows/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('workflows', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'workflow not found' };
    }
    const wf = workflowRepo.getById(ctx.db, id);
    if (!wf) {
      reply.code(404);
      return { error: 'workflow not found' };
    }
    const filename = `${wf.name.replace(/[^a-z0-9_-]+/gi, '-')}.workflow.yaml`;
    reply
      .header('Content-Type', 'application/x-yaml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`);
    return wf.definition_yaml;
  });

  app.post('/api/projects/:id/workflows/import', async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    const ctx = dbForProjectId(projectId);
    if (!ctx) {
      reply.code(404);
      return { error: 'project not found' };
    }
    const body = req.body as {
      definition_yaml?: string;
      name?: string;
      description?: string | null;
      trigger_command?: string;
      overwrite?: boolean;
    };
    if (!body?.definition_yaml || typeof body.definition_yaml !== 'string') {
      reply.code(400);
      return { error: 'definition_yaml is required' };
    }
    let definition;
    try {
      definition = parseWorkflowYaml(body.definition_yaml);
    } catch (e) {
      if (e instanceof WorkflowYamlError) {
        reply.code(400);
        return { error: `invalid YAML: ${e.message}` };
      }
      throw e;
    }
    const triggerCommand = body.trigger_command ?? definition.trigger.command;
    if (!COMMAND_RE.test(triggerCommand)) {
      reply.code(400);
      return { error: 'trigger_command must match /^\\/[a-z][a-z0-9-]*$/' };
    }
    if (body.trigger_command && definition.trigger.command !== body.trigger_command) {
      reply.code(400);
      return {
        error: `trigger_command mismatch: body "${body.trigger_command}" vs YAML "${definition.trigger.command}"`,
      };
    }
    const name = body.name ?? definition.name;
    const description = body.description ?? definition.description ?? null;
    const existing = workflowRepo.getByTrigger(ctx.db, triggerCommand);
    if (existing && !body.overwrite) {
      reply.code(409);
      return {
        error: `trigger_command "${triggerCommand}" already exists. Pass overwrite=true to replace.`,
        existing: { ...existing, project_id: ctx.projectId },
      };
    }
    let wf;
    if (existing && body.overwrite) {
      wf = workflowRepo.update(ctx.db, existing.id, {
        name,
        description,
        trigger_command: triggerCommand,
        definition_yaml: body.definition_yaml,
      });
      try {
        deriveResponsibilitiesForWorkflow(ctx.db, existing.id);
      } catch {
        /* ignore */
      }
    } else {
      wf = workflowRepo.create(ctx.db, {
        name,
        description,
        trigger_command: triggerCommand,
        definition_yaml: body.definition_yaml,
        source: 'user',
      });
      try {
        deriveResponsibilitiesForWorkflow(ctx.db, wf.id);
      } catch {
        /* ignore */
      }
    }
    reply.code(existing ? 200 : 201);
    return {
      imported: wf ? { ...wf, project_id: ctx.projectId } : null,
      mode: existing ? 'updated' : 'created',
    };
  });

  app.get('/api/workflows/:id/runs', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('workflows', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'workflow not found' };
    }
    return workflowRunRepo.listByWorkflow(ctx.db, id);
  });

  app.get('/api/workflows/:id/responsibilities', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('workflows', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'workflow not found' };
    }
    return responsibilityRepo.listByWorkflow(ctx.db, id);
  });

  // 跨 project 活跃 runs（Inbox 视图）— 遍历所有打开的 db
  app.get('/api/workflow-runs', async (req) => {
    const query = req.query as {
      status?: 'running' | 'awaiting_approval' | 'completed' | 'aborted' | 'failed';
    };
    return forEachProjectDb(({ db, projectId }) => {
      const runs = workflowRunRepo.listActive(db, query.status ? { status: query.status } : undefined);
      return runs.map((r) => {
        const wf = workflowRepo.getById(db, r.workflow_id);
        const ch = channelRepo.getById(db, r.channel_id);
        return {
          ...r,
          project_id: projectId,
          workflow: wf ? { ...wf, project_id: projectId } : null,
          channel: ch ? { ...ch, project_id: projectId } : null,
        };
      });
    });
  });

  app.get('/api/workflow-runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('workflow_runs', Number(id));
    if (!ctx) {
      reply.code(404);
      return { error: 'workflow run not found' };
    }
    const run = workflowRunRepo.getById(ctx.db, Number(id));
    if (!run) {
      reply.code(404);
      return { error: 'workflow run not found' };
    }
    const wf = workflowRepo.getById(ctx.db, run.workflow_id);
    return { ...run, workflow: wf };
  });

  app.post('/api/workflow-runs/:id/abort', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('workflow_runs', Number(id));
    if (!ctx) {
      reply.code(404);
      return { error: 'workflow run not found' };
    }
    const body = (req.body ?? {}) as { reason?: string };
    const runId = Number(id);
    const run = workflowRunRepo.getById(ctx.db, runId);
    if (!run) {
      reply.code(404);
      return { error: 'workflow run not found' };
    }
    if (run.status !== 'running' && run.status !== 'awaiting_approval') {
      reply.code(409);
      return { error: `run is already ${run.status}` };
    }
    abortWorkflowRun(ctx.db, runId, body.reason ?? 'aborted by user');
    return workflowRunRepo.getById(ctx.db, runId);
  });

  app.get('/api/channels/:id/active-workflow-run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('channels', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'channel not found' };
    }
    const query = req.query as { thread_id?: string };
    const run = workflowRunRepo.getActive(ctx.db, id, query.thread_id ?? null);
    if (!run) return { run: null };
    const wf = workflowRepo.getById(ctx.db, run.workflow_id);
    return { run: { ...run, workflow: wf } };
  });
}
