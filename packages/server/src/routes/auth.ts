import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
  display_name: string | null;
  password_hash: string;
  role: 'admin' | 'member';
  disabled_at: number | null;
  last_login_at: number | null;
  created_at: number;
  updated_at: number;
}

type UserRole = 'admin' | 'member';

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
    const body = (req.body ?? {}) as { username?: string; displayName?: string; password?: string };
    const username = normalizeUsername(body.username);
    const displayName = normalizeDisplayName(body.displayName) ?? username;
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
        `INSERT INTO users
           (id, username, display_name, password_hash, role, last_login_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'admin', ?, ?, ?)`,
      ).run(id, username, displayName, passwordHash, now, now, now);
      const session = createSession(db, id);
      return {
        user: { id, username, display_name: displayName, role: 'admin' as const },
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
      .prepare(
        `SELECT id, username, display_name, password_hash, role, disabled_at, last_login_at, created_at, updated_at
         FROM users WHERE username = ?`,
      )
      .get(username) as UserRow | undefined;
    if (!row || row.disabled_at || !(await verifyPassword(password, row.password_hash))) {
      reply.code(401);
      return { error: 'invalid username or password' };
    }

    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), row.id);
    const session = createSession(db, row.id);
    setSessionCookie(req, reply, session.token, session.expiresAt);
    return {
      user: serializeUser({
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
      }),
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

  app.patch('/api/auth/profile', async (req, reply) => {
    const user = getUserFromRequest(req);
    if (!user) {
      reply.code(401);
      return { error: 'unauthorized' };
    }

    const body = (req.body ?? {}) as {
      username?: string;
      displayName?: string | null;
    };
    const updates: string[] = [];
    const values: unknown[] = [];
    const db = openAuthDb();
    const row = getUserRow(db, user.id);
    if (!row) {
      reply.code(404);
      return { error: 'user not found' };
    }

    if ('username' in body) {
      const username = normalizeUsername(body.username);
      const validation = validateUsername(username);
      if (validation) {
        reply.code(400);
        return { error: validation };
      }
      if (username !== row.username) {
        const existing = db
          .prepare('SELECT id FROM users WHERE username = ? AND id != ?')
          .get(username, user.id);
        if (existing) {
          reply.code(409);
          return { error: 'username already exists' };
        }
        updates.push('username = ?');
        values.push(username);
      }
    }

    if ('displayName' in body) {
      updates.push('display_name = ?');
      values.push(normalizeDisplayName(body.displayName ?? undefined));
    }

    if (updates.length === 0) {
      return userToPublic(row);
    }

    updates.push('updated_at = ?');
    values.push(Date.now(), user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return userToPublic(getUserRow(db, user.id)!);
  });

  app.get('/api/users', async () => listUsers({ includeDisabled: true }));

  app.get('/api/admin/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return listUsers({ includeDisabled: true });
  });

  app.post('/api/admin/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = (req.body ?? {}) as {
      username?: string;
      displayName?: string;
      password?: string;
    };
    const username = normalizeUsername(body.username);
    const displayName = normalizeDisplayName(body.displayName) ?? username;
    const password = body.password ?? '';
    const validation = validateCredentials(username, password);
    if (validation) {
      reply.code(400);
      return { error: validation };
    }

    const db = openAuthDb();
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      reply.code(409);
      return { error: 'username already exists' };
    }
    const now = Date.now();
    const id = nanoid();
    db.prepare(
      `INSERT INTO users
         (id, username, display_name, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, username, displayName, await hashPassword(password), 'member', now, now);
    return userToPublic({
      id,
      username,
      display_name: displayName,
      password_hash: '',
      role: 'member',
      disabled_at: null,
      last_login_at: null,
      created_at: now,
      updated_at: now,
    });
  });

  app.patch('/api/admin/users/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { displayName?: string | null; role?: UserRole };
    const db = openAuthDb();
    const row = getUserRow(db, id);
    if (!row) {
      reply.code(404);
      return { error: 'user not found' };
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    if ('displayName' in body) {
      updates.push('display_name = ?');
      values.push(normalizeDisplayName(body.displayName ?? undefined));
    }
    if (body.role === 'admin' || body.role === 'member') {
      if (row.role === 'admin' && body.role !== row.role) {
        reply.code(400);
        return { error: 'admin role cannot be changed' };
      }
      updates.push('role = ?');
      values.push(body.role);
    }
    if (updates.length === 0) {
      reply.code(400);
      return { error: 'no fields to update' };
    }
    updates.push('updated_at = ?');
    values.push(Date.now(), id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return userToPublic(getUserRow(db, id)!);
  });

  app.post('/api/admin/users/:id/reset-password', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { password?: string };
    const password = body.password ?? '';
    if (password.length < MIN_PASSWORD_LENGTH) {
      reply.code(400);
      return { error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` };
    }
    const db = openAuthDb();
    const row = getUserRow(db, id);
    if (!row) {
      reply.code(404);
      return { error: 'user not found' };
    }
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      await hashPassword(password),
      Date.now(),
      id,
    );
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    return { ok: true };
  });

  app.post('/api/admin/users/:id/disable', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const admin = getUserFromRequest(req);
    if (admin?.id === id) {
      reply.code(400);
      return { error: 'cannot disable yourself' };
    }
    const db = openAuthDb();
    const row = getUserRow(db, id);
    if (!row) {
      reply.code(404);
      return { error: 'user not found' };
    }
    db.prepare('UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?').run(
      Date.now(),
      Date.now(),
      id,
    );
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    return userToPublic(getUserRow(db, id)!);
  });

  app.post('/api/admin/users/:id/enable', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const db = openAuthDb();
    const row = getUserRow(db, id);
    if (!row) {
      reply.code(404);
      return { error: 'user not found' };
    }
    db.prepare('UPDATE users SET disabled_at = NULL, updated_at = ? WHERE id = ?').run(
      Date.now(),
      id,
    );
    return userToPublic(getUserRow(db, id)!);
  });
}

function normalizeUsername(input: string | undefined): string {
  return (input ?? '').trim().toLowerCase();
}

function validateCredentials(username: string, password: string): string | null {
  const usernameError = validateUsername(username);
  if (usernameError) return usernameError;
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

function validateUsername(username: string): string | null {
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return 'username must be 3-40 characters: lowercase letters, numbers, dot, underscore, or dash';
  }
  return null;
}

function normalizeDisplayName(input: string | undefined): string | null {
  const trimmed = (input ?? '').trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user = getUserFromRequest(req);
  if (!user) {
    reply.code(401);
    reply.send({ error: 'unauthorized' });
    return false;
  }
  if (user.role !== 'admin') {
    reply.code(403);
    reply.send({ error: 'admin required' });
    return false;
  }
  return true;
}

function listUsers(opts: { includeDisabled?: boolean } = {}) {
  const where = opts.includeDisabled ? '' : 'WHERE disabled_at IS NULL';
  const rows = openAuthDb()
    .prepare(
      `SELECT id, username, display_name, password_hash, role, disabled_at, last_login_at, created_at, updated_at
       FROM users ${where}
       ORDER BY created_at ASC`,
    )
    .all() as UserRow[];
  return rows.map(userToPublic);
}

function getUserRow(db: ReturnType<typeof openAuthDb>, id: string): UserRow | null {
  const row = db
    .prepare(
      `SELECT id, username, display_name, password_hash, role, disabled_at, last_login_at, created_at, updated_at
       FROM users WHERE id = ?`,
    )
    .get(id) as UserRow | undefined;
  return row ?? null;
}

function userToPublic(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    disabled_at: row.disabled_at,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
