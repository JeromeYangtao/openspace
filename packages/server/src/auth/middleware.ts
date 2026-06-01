import type { FastifyReply, FastifyRequest } from 'fastify';
import { getUserFromRequest, serializeUser, type AuthUser } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

const PUBLIC_PREFIXES = ['/docs/', '/assets/'];
const PUBLIC_PATHS = new Set([
  '/',
  '/api/health',
  '/api/auth/me',
  '/api/auth/bootstrap-status',
  '/api/auth/bootstrap',
  '/api/auth/login',
  '/api/auth/logout',
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const url = new URL(req.url, 'http://localhost');
  if (isPublicPath(url.pathname)) return;
  if (!url.pathname.startsWith('/api/')) return;

  const user = getUserFromRequest(req);
  if (!user) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  req.user = user;
}

export function requireRequestUser(req: FastifyRequest): AuthUser {
  if (!req.user) {
    const user = getUserFromRequest(req);
    if (user) {
      req.user = user;
      return user;
    }
    throw new Error('unauthorized');
  }
  return req.user;
}

export function currentUserPayload(user: AuthUser) {
  return { user: serializeUser(user) };
}
