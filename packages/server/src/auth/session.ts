import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { openAuthDb } from './db.js';

const COOKIE_NAME = 'openspace_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: string;
  username: string;
  display_name: string | null;
  role: 'admin' | 'member';
}

interface SessionUserRow {
  id: string;
  username: string;
  display_name: string | null;
  role: 'admin' | 'member';
  expires_at: number;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  role: 'admin' | 'member';
  disabled_at: number | null;
}

interface AuthDb {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
}

export function countUsers(): number {
  return countUsersInDb(openAuthDb());
}

export function countUsersInDb(db: AuthDb): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  return row.count;
}

export function serializeUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
  };
}

export function listEnabledUsersByIds(ids: string[]): AuthUser[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = openAuthDb()
    .prepare(
      `SELECT id, username, display_name, role, disabled_at
       FROM users
       WHERE disabled_at IS NULL AND id IN (${placeholders})
       ORDER BY username ASC`,
    )
    .all(...ids) as UserRow[];
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
  }));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function cookieHeader(
  name: string,
  value: string,
  opts: { maxAge?: number; expires?: Date; secure?: boolean } = {},
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
  ];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function isSecureRequest(req: FastifyRequest): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return proto?.split(',')[0]?.trim() === 'https' || req.protocol === 'https';
}

export function clearSessionCookie(req: FastifyRequest, reply: FastifyReply): void {
  reply.header(
    'Set-Cookie',
    cookieHeader(COOKIE_NAME, '', {
      maxAge: 0,
      expires: new Date(0),
      secure: isSecureRequest(req),
    }),
  );
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function sessionTokenFromRequest(req: FastifyRequest): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] ?? null;
}

export function getUserFromToken(token: string): AuthUser | null {
  return getUserFromTokenInDb(token, openAuthDb());
}

function getUserFromTokenInDb(token: string, db: AuthDb): AuthUser | null {
  const tokenHash = hashToken(token);
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT users.id, users.username, users.display_name, users.role, sessions.expires_at
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND users.disabled_at IS NULL`,
    )
    .get(tokenHash) as SessionUserRow | undefined;
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, tokenHash);
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role };
}

export function getUserFromRequest(req: FastifyRequest): AuthUser | null {
  const token = sessionTokenFromRequest(req);
  if (!token) return null;
  return getUserFromToken(token);
}

export function createSession(
  db: AuthDb,
  userId: string,
): { token: string; expiresAt: number } {
  const now = Date.now();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(nanoid(), userId, hashToken(token), expiresAt, now, now);
  return { token, expiresAt };
}

export function setSessionCookie(
  req: FastifyRequest,
  reply: FastifyReply,
  token: string,
  expiresAt: number,
): void {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  reply.header(
    'Set-Cookie',
    cookieHeader(COOKIE_NAME, token, {
      maxAge,
      expires: new Date(expiresAt),
      secure: isSecureRequest(req),
    }),
  );
}

export function deleteSessionByToken(token: string): void {
  deleteSessionByTokenInDb(token, openAuthDb());
}

function deleteSessionByTokenInDb(token: string, db: AuthDb): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function deleteOtherSessions(userId: string, token: string): void {
  deleteOtherSessionsInDb(userId, token, openAuthDb());
}

function deleteOtherSessionsInDb(userId: string, token: string, db: AuthDb): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(
    userId,
    hashToken(token),
  );
}
