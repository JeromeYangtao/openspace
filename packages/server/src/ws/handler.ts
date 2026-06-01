/**
 * WebSocket 连接处理（D-21 重构）：从 channel_id 反查 per-project db
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { ClientEvent, ServerEvent } from '@openspace/shared';
import { messageRepo } from '../db/repos.js';
import { routeUserMessage } from '../messaging/router.js';
import { hub } from './hub.js';
import { dbForResource } from '../routes/_helpers.js';

export function registerWSRoute(app: FastifyInstance): void {
  app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (socket: WebSocket) => {
      app.log.info('ws client connected');
      hub.register(socket);

      const send = (event: ServerEvent) => hub.send(socket, event);

      socket.on('message', (raw: Buffer) => {
        let parsed: ClientEvent;
        try {
          parsed = JSON.parse(raw.toString('utf8')) as ClientEvent;
        } catch {
          send({ type: 'error', code: 'invalid_json', message: 'invalid JSON' });
          return;
        }
        handleClientEvent(parsed, socket, app, send).catch((err: unknown) => {
          app.log.error({ err }, 'ws handler error');
          send({
            type: 'error',
            code: 'internal_error',
            message: err instanceof Error ? err.message : String(err),
          });
        });
      });

      socket.on('close', () => {
        app.log.info('ws client disconnected');
        hub.dispose(socket);
      });

      socket.on('error', (err: Error) => {
        app.log.warn({ err }, 'ws socket error');
      });
    });
  });
}

async function handleClientEvent(
  event: ClientEvent,
  socket: WebSocket,
  app: FastifyInstance,
  send: (e: ServerEvent) => void,
): Promise<void> {
  switch (event.type) {
    case 'ping':
      send({ type: 'pong' });
      return;

    case 'subscribe_channel': {
      const ctx = dbForResource('channels', event.channel_id);
      if (!ctx) {
        send({
          type: 'error',
          code: 'channel_not_found',
          message: `channel ${event.channel_id} not found`,
        });
        return;
      }
      hub.subscribe(socket, event.channel_id);
      const history = messageRepo.listChannelMain(ctx.db, event.channel_id, 10);
      send({ type: 'subscribed', channel_id: event.channel_id });
      for (const msg of history) {
        send({ type: 'message', message: msg });
      }
      return;
    }

    case 'unsubscribe_channel':
      hub.unsubscribe(socket, event.channel_id);
      return;

    case 'send_message': {
      const ctx = dbForResource('channels', event.channel_id);
      if (!ctx) {
        send({
          type: 'error',
          code: 'channel_not_found',
          message: `channel ${event.channel_id} not found`,
        });
        return;
      }
      await routeUserMessage(
        {
          channelId: event.channel_id,
          content: event.content,
          threadId: event.thread_id,
          asTask: event.as_task,
        },
        {
          db: ctx.db,
          logger: {
            info: (m) => app.log.info(m),
            warn: (m) => app.log.warn(m),
            error: (m) => app.log.error(m),
          },
        },
      );
      return;
    }

    case 'typing_start':
    case 'typing_stop':
      return;

    default:
      send({
        type: 'error',
        code: 'unknown_event',
        message: `unknown event type`,
      });
  }
}
