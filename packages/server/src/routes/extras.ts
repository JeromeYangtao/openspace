/**
 * 全局视图 API（D-21 重构）
 *   - /api/messages/search  全文搜索消息（跨所有 open project）
 *   - /api/threads          全局 thread 列表
 *   - /api/messages/:id/save / unsave
 *   - /api/saved            列出已收藏消息
 */

import type { FastifyInstance } from 'fastify';
import type { ChatMessage, MessageMetadata, SenderType } from '@openspace/shared';
import { dbForResource, forEachProjectDb } from './_helpers.js';
import { canAccessChannel } from '../auth/channel-access.js';
import { getUserFromRequest } from '../auth/session.js';

interface RawRow {
  id: string;
  channel_id: string;
  sender_type: string;
  sender_id: string | null;
  content: string;
  metadata_json: string | null;
  parent_id: string | null;
  reply_count: number;
  created_at: number;
}

function rowToMessage(r: RawRow): ChatMessage {
  const metadata = r.metadata_json ? (JSON.parse(r.metadata_json) as MessageMetadata) : null;
  return {
    id: r.id,
    channel_id: r.channel_id,
    sender_type: r.sender_type as SenderType,
    sender_id: r.sender_id,
    content: r.content,
    metadata: compactMessageMetadata(metadata),
    parent_id: r.parent_id,
    reply_count: r.reply_count,
    created_at: r.created_at,
  };
}

function compactMessageMetadata(metadata: MessageMetadata | null): MessageMetadata | null {
  if (!metadata?.tool_calls?.length) return metadata;
  return {
    ...metadata,
    tool_calls: metadata.tool_calls.map((call) => {
      const { result: _result, args: _args, ...rest } = call;
      return {
        ...rest,
        args: {},
      };
    }),
  };
}

export async function extraRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/messages/search', async (req) => {
    const user = getUserFromRequest(req);
    if (!user) return [] as ChatMessage[];
    const query = req.query as { q?: string; channel_id?: string; limit?: string };
    const q = (query.q ?? '').trim();
    if (!q) return [] as ChatMessage[];
    const limit = query.limit ? Math.min(100, Number(query.limit)) : 30;
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;

    if (query.channel_id) {
      const ctx = dbForResource('channels', query.channel_id);
      if (!ctx) return [];
      if (!canAccessChannel(ctx.db, query.channel_id, user)) return [];
      const rows = ctx.db
        .prepare(
          `SELECT * FROM messages
           WHERE channel_id = ? AND content LIKE ? ESCAPE '\\'
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(query.channel_id, like, limit) as RawRow[];
      return rows.map(rowToMessage);
    }
    return forEachProjectDb(({ db }) =>
      (db
        .prepare(
          `SELECT * FROM messages
           WHERE content LIKE ? ESCAPE '\\'
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(like, limit) as RawRow[])
        .filter((row) => canAccessChannel(db, row.channel_id, user))
        .map(rowToMessage),
    ).slice(0, limit);
  });

  app.get('/api/threads', async (req) => {
    const user = getUserFromRequest(req);
    if (!user) return [] as ChatMessage[];
    const query = req.query as { limit?: string };
    const limit = query.limit ? Math.min(200, Number(query.limit)) : 100;
    return forEachProjectDb(({ db }) =>
      (db
        .prepare(
          `SELECT * FROM messages
           WHERE parent_id IS NULL AND reply_count > 0
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(limit) as RawRow[])
        .filter((row) => canAccessChannel(db, row.channel_id, user))
        .map(rowToMessage),
    ).slice(0, limit);
  });

  app.post('/api/messages/:id/save', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('messages', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'message not found' };
    }
    const exists = ctx.db.prepare('SELECT id, channel_id FROM messages WHERE id = ?').get(id) as
      | { id: string; channel_id: string }
      | undefined;
    if (!exists) {
      reply.code(404);
      return { error: 'message not found' };
    }
    const user = getUserFromRequest(req);
    if (!user || !canAccessChannel(ctx.db, exists.channel_id, user)) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    ctx.db
      .prepare('INSERT OR REPLACE INTO saved_messages (message_id, saved_at) VALUES (?, ?)')
      .run(id, Date.now());
    return { ok: true };
  });

  app.delete('/api/messages/:id/save', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('messages', id);
    if (!ctx) {
      reply.code(404);
      return { error: 'message not found' };
    }
    const message = ctx.db.prepare('SELECT channel_id FROM messages WHERE id = ?').get(id) as
      | { channel_id: string }
      | undefined;
    if (!message) {
      reply.code(404);
      return { error: 'message not found' };
    }
    const user = getUserFromRequest(req);
    if (!user || !canAccessChannel(ctx.db, message.channel_id, user)) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    ctx.db.prepare('DELETE FROM saved_messages WHERE message_id = ?').run(id);
    reply.code(204);
  });

  app.post('/api/messages/saved-status', async (req) => {
    const user = getUserFromRequest(req);
    const body = req.body as { ids?: string[] };
    const ids = Array.from(new Set((body?.ids ?? []).filter(Boolean))).slice(0, 200);
    const status: Record<string, boolean> = Object.fromEntries(ids.map((id) => [id, false]));
    if (!user || ids.length === 0) return status;

    const placeholders = ids.map(() => '?').join(',');
    forEachProjectDb(({ db }) => {
      const rows = db
        .prepare(
          `SELECT s.message_id, m.channel_id
           FROM saved_messages s
           JOIN messages m ON m.id = s.message_id
           WHERE s.message_id IN (${placeholders})`,
        )
        .all(...ids) as Array<{ message_id: string; channel_id: string }>;
      for (const row of rows) {
        if (canAccessChannel(db, row.channel_id, user)) {
          status[row.message_id] = true;
        }
      }
      return [];
    });
    return status;
  });

  app.get('/api/messages/:id/saved', async (req) => {
    const { id } = req.params as { id: string };
    const ctx = dbForResource('messages', id);
    if (!ctx) return { saved: false };
    const message = ctx.db.prepare('SELECT channel_id FROM messages WHERE id = ?').get(id) as
      | { channel_id: string }
      | undefined;
    const user = getUserFromRequest(req);
    if (!message || !user || !canAccessChannel(ctx.db, message.channel_id, user)) {
      return { saved: false };
    }
    const row = ctx.db.prepare('SELECT 1 FROM saved_messages WHERE message_id = ?').get(id);
    return { saved: !!row };
  });

  app.get('/api/saved', async (req) => {
    const user = getUserFromRequest(req);
    if (!user) return [] as ChatMessage[];
    return forEachProjectDb(({ db }) =>
      (db
        .prepare(
          `SELECT m.* FROM saved_messages s
           JOIN messages m ON m.id = s.message_id
           ORDER BY s.saved_at DESC
           LIMIT 200`,
        )
        .all() as RawRow[])
        .filter((row) => canAccessChannel(db, row.channel_id, user))
        .map(rowToMessage),
    ).slice(0, 200);
  });
}
