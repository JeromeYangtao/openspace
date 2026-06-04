/**
 * WebSocket 连接处理（D-21 重构）：从 channel_id 反查 per-project db
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { ClientEvent, ServerEvent } from '@openspace/shared';
import { routeUserMessage } from '../messaging/router.js';
import { hub } from './hub.js';
import { dbForResource } from '../routes/_helpers.js';
import { getUserFromRequest } from '../auth/session.js';
import { config } from '../config.js';

export function registerWSRoute(app: FastifyInstance): void {
  app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
      if (!isAllowedOrigin(req.headers.origin, req.headers.host)) {
        socket.close(1008, 'forbidden origin');
        return;
      }
      const user = getUserFromRequest(req);
      if (!user) {
        socket.close(1008, 'unauthorized');
        return;
      }
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
        handleClientEvent(parsed, socket, app, send, user.id).catch((err: unknown) => {
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

function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  const allowed = new Set<string>();
  if (host) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  if (config.webOrigin) {
    allowed.add(config.webOrigin);
  }
  return allowed.has(origin);
}

async function handleClientEvent(
  event: ClientEvent,
  socket: WebSocket,
  app: FastifyInstance,
  send: (e: ServerEvent) => void,
  userId: string,
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
      send({ type: 'subscribed', channel_id: event.channel_id });
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
          userId,
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
