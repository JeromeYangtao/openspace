import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { MessageMetadata, TaskStatus } from '@openspace/shared';
import { LOCAL_USER_ID } from '@openspace/shared';
import { agentRepo, messageRepo, taskRepo } from '../db/repos.js';
import { hub } from '../ws/hub.js';
import { dbForResource, forEachProjectDb } from './_helpers.js';

const STATUS_EMOJI: Record<TaskStatus, string> = {
  todo: '📝',
  in_progress: '📌',
  in_review: '🔎',
  done: '✅',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

function getActorName(db: Database, actorId: string): string {
  if (actorId === LOCAL_USER_ID) return 'User';
  const agent = agentRepo.getById(db, actorId);
  return agent?.name ?? 'Unknown';
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/tasks', async (req) => {
    const query = req.query as { channel_id?: string; status?: TaskStatus };
    if (query.channel_id) {
      const ctx = dbForResource('channels', query.channel_id);
      if (!ctx) return [];
      return taskRepo.list(ctx.db, query);
    }
    return forEachProjectDb(({ db }) => taskRepo.list(db, query));
  });

  app.post('/api/tasks', async (req, reply) => {
    const body = req.body as {
      channel_id: string;
      title: string;
      assignee_agent_id?: string | null;
      source_message_id?: string | null;
      created_by?: string;
    };
    if (!body?.channel_id || !body?.title) {
      reply.code(400);
      return { error: 'channel_id and title are required' };
    }
    const ctx = dbForResource('channels', body.channel_id);
    if (!ctx) {
      reply.code(404);
      return { error: 'channel not found' };
    }
    const createdBy = body.created_by ?? LOCAL_USER_ID;
    const task = taskRepo.create(ctx.db, {
      channel_id: body.channel_id,
      title: body.title,
      assignee_agent_id: body.assignee_agent_id,
      source_message_id: body.source_message_id,
      created_by: createdBy,
    });

    const metadata: MessageMetadata = {
      system_event: { type: 'task_created', task_id: task.id, title: task.title },
      task_ref: {
        id: task.id,
        title: task.title,
        status: task.status,
        assignee_agent_id: task.assignee_agent_id,
      },
    };
    const sysMsg = messageRepo.create(ctx.db, {
      channel_id: body.channel_id,
      sender_type: 'system',
      sender_id: LOCAL_USER_ID,
      content: `📝 1 new task created: #${task.id} "${task.title}"`,
      metadata,
    });
    hub.broadcast(body.channel_id, { type: 'message', message: sysMsg });
    hub.broadcast(body.channel_id, { type: 'task_update', task });

    reply.code(201);
    return task;
  });

  app.get('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('tasks', Number(id));
    if (!ctx) {
      reply.code(404);
      return { error: 'task not found' };
    }
    const t = taskRepo.getById(ctx.db, Number(id));
    if (!t) {
      reply.code(404);
      return { error: 'task not found' };
    }
    return t;
  });

  app.patch('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('tasks', Number(id));
    if (!ctx) {
      reply.code(404);
      return { error: 'task not found' };
    }
    const body = req.body as {
      title?: string;
      status?: TaskStatus;
      assignee_agent_id?: string | null;
      by?: string;
    };
    const before = taskRepo.getById(ctx.db, Number(id));
    if (!before) {
      reply.code(404);
      return { error: 'task not found' };
    }
    const task = taskRepo.update(ctx.db, Number(id), body ?? {});
    if (!task) {
      reply.code(404);
      return { error: 'task not found' };
    }

    if (body?.status && body.status !== before.status) {
      const actor = body.by ?? LOCAL_USER_ID;
      const actorName = getActorName(ctx.db, actor);
      const emoji = STATUS_EMOJI[body.status];
      const content =
        body.status === 'in_progress'
          ? `${emoji} ${actorName} claimed #${task.id} "${task.title}"`
          : `${emoji} ${actorName} moved #${task.id} "${task.title}" to ${STATUS_LABEL[body.status]}`;

      const metadata: MessageMetadata = {
        system_event:
          body.status === 'in_progress'
            ? { type: 'task_claimed', task_id: task.id, agent: actorName }
            : {
                type: 'task_moved',
                task_id: task.id,
                from: before.status,
                to: body.status,
                by: actorName,
              },
        task_ref: {
          id: task.id,
          title: task.title,
          status: task.status,
          assignee_agent_id: task.assignee_agent_id,
        },
      };
      const sysMsg = messageRepo.create(ctx.db, {
        channel_id: task.channel_id,
        sender_type: 'system',
        sender_id: LOCAL_USER_ID,
        content,
        metadata,
      });
      hub.broadcast(task.channel_id, { type: 'message', message: sysMsg });
    }

    hub.broadcast(task.channel_id, { type: 'task_update', task });
    return task;
  });

  app.delete('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('tasks', Number(id));
    if (!ctx) {
      reply.code(404);
      return { error: 'task not found' };
    }
    const t = taskRepo.getById(ctx.db, Number(id));
    taskRepo.remove(ctx.db, Number(id));
    if (t) {
      hub.broadcast(t.channel_id, { type: 'task_update', task: { ...t, status: 'done' } });
    }
    reply.code(204);
  });
}
