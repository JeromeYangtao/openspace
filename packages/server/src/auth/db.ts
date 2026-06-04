import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { dbPath } from '../config.js';

let authDb: DB | null = null;

export function openAuthDb(): DB {
  if (authDb) return authDb;
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      username        TEXT NOT NULL UNIQUE,
      display_name    TEXT,
      password_hash   TEXT NOT NULL,
      role            TEXT NOT NULL CHECK(role IN ('admin','member')),
      disabled_at     INTEGER,
      last_login_at   INTEGER,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash      TEXT NOT NULL UNIQUE,
      expires_at      INTEGER NOT NULL,
      created_at      INTEGER NOT NULL,
      last_seen_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);
  addColumnIfMissing(db, 'users', 'display_name', 'TEXT');
  addColumnIfMissing(db, 'users', 'disabled_at', 'INTEGER');
  addColumnIfMissing(db, 'users', 'last_login_at', 'INTEGER');
  authDb = db;
  return db;
}

export function closeAuthDb(): void {
  if (!authDb) return;
  try {
    authDb.close();
  } catch {
    /* ignore */
  }
  authDb = null;
}

function addColumnIfMissing(db: DB, table: string, column: string, definition: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/duplicate column name/i.test(message)) {
      throw e;
    }
  }
}
