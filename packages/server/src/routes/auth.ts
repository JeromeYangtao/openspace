import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { openAuthDb } from '../auth/db.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  clearSessionCookie,
  countUsers,
  countUsersInDb,
  createSession,
  deleteOtherSessions,
  deleteSessionByToken,
  getUserFromRequest,
  serializeUser,
  sessionTokenFromRequest,
  setSessionCookie,
} from '../auth/session.js';

const MIN_PASSWORD_LENGTH = 8;

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: 'admin' | 'member';
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/bootstrap-status', async () => ({
    required: countUsers() === 0,
  }));

  app.get('/api/auth/me', async (req, reply) => {
    const user = getUserFromRequest(req);
    if (!user) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    return { user: serializeUser(user) };
  });

  app.post('/api/auth/bootstrap', async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const username = normalizeUsername(body.username);
    const password = body.password ?? '';
    const validation = validateCredentials(username, password);
    if (validation) {
      reply.code(400);
      return { error: validation };
    }

    const db = openAuthDb();
    const passwordHash = await hashPassword(password);
    const result = db.transaction(() => {
      if (countUsersInDb(db) > 0) return null;
      const now = Date.now();
      const id = nanoid();
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, 'admin', ?, ?)`,
      ).run(id, username, passwordHash, now, now);
      const session = createSession(db, id);
      return {
        user: { id, username, role: 'admin' as const },
        session,
      };
    })();

    if (!result) {
      reply.code(403);
      return { error: 'bootstrap is closed' };
    }

    setSessionCookie(req, reply, result.session.token, result.session.expiresAt);
    return { user: serializeUser(result.user) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const username = normalizeUsername(body.username);
    const password = body.password ?? '';
    if (!username || !password) {
      reply.code(400);
      return { error: 'username and password are required' };
    }

    const db = openAuthDb();
    const row = db
      .prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?')
      .get(username) as UserRow | undefined;
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      reply.code(401);
      return { error: 'invalid username or password' };
    }

    const session = createSession(db, row.id);
    setSessionCookie(req, reply, session.token, session.expiresAt);
    return {
      user: serializeUser({ id: row.id, username: row.username, role: row.role }),
    };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = sessionTokenFromRequest(req);
    if (token) deleteSessionByToken(token);
    clearSessionCookie(req, reply);
    return { ok: true };
  });

  app.post('/api/auth/change-password', async (req, reply) => {
    const user = getUserFromRequest(req);
    if (!user) {
      reply.code(401);
      return { error: 'unauthorized' };
    }

    const body = (req.body ?? {}) as { currentPassword?: string; newPassword?: string };
    const currentPassword = body.currentPassword ?? '';
    const newPassword = body.newPassword ?? '';
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      reply.code(400);
      return { error: `new password must be at least ${MIN_PASSWORD_LENGTH} characters` };
    }

    const db = openAuthDb();
    const row = db
      .prepare('SELECT id, username, password_hash, role FROM users WHERE id = ?')
      .get(user.id) as UserRow | undefined;
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      reply.code(401);
      return { error: 'current password is incorrect' };
    }

    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      await hashPassword(newPassword),
      Date.now(),
      user.id,
    );
    const token = sessionTokenFromRequest(req);
    if (token) deleteOtherSessions(user.id, token);
    return { ok: true };
  });
}

function normalizeUsername(input: string | undefined): string {
  return (input ?? '').trim().toLowerCase();
}

function validateCredentials(username: string, password: string): string | null {
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return 'username must be 3-40 characters: lowercase letters, numbers, dot, underscore, or dash';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}
