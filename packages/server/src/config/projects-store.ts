/**
 * Global Projects Store — `~/.openspace/projects.json`
 *
 * Per-Project Storage 改造（D-21）后，OpenSpace 不再用 SQL `projects` 表。
 * 全局只维护"用户开过的项目路径列表"。每个项目的实际元数据放在
 * `<workspace>/.openspace/project.json`（见 `project-meta.ts`）。
 *
 * 文件格式：
 * {
 *   "version": 1,
 *   "recent": [
 *     { "id": "abc123", "path": "/Users/x/code/proj-a", "lastOpened": 1730000000000 },
 *     { "id": "def456", "path": "/Users/x/code/proj-b", "lastOpened": 1729000000000 }
 *   ]
 * }
 *
 * 关键约束：
 *   - id 是项目的稳定 ID（nanoid，与 project.json 中的 id 同源）
 *   - path 唯一（同一目录不会出现两次；ensureUniqueName 在 OpenProjectDialog 控制重名）
 *   - 文件损坏 / 不存在 → 视为空列表（启动期不阻塞）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const STORE_PATH = path.resolve(config.openspaceHome, 'projects.json');

export interface ProjectRecentEntry {
  id: string;
  path: string;
  lastOpened: number;
}

interface StoreFile {
  version: number;
  recent: ProjectRecentEntry[];
}

const EMPTY: StoreFile = { version: 1, recent: [] };

function read(): StoreFile {
  if (!existsSync(STORE_PATH)) return EMPTY;
  try {
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf-8')) as StoreFile;
    return {
      version: raw.version ?? 1,
      recent: Array.isArray(raw.recent) ? raw.recent : [],
    };
  } catch {
    return EMPTY;
  }
}

function write(store: StoreFile): void {
  mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

export const projectsStore = {
  list(): ProjectRecentEntry[] {
    return read().recent.slice().sort((a, b) => b.lastOpened - a.lastOpened);
  },

  getById(id: string): ProjectRecentEntry | null {
    return read().recent.find((p) => p.id === id) ?? null;
  },

  getByPath(workspacePath: string): ProjectRecentEntry | null {
    const norm = path.resolve(workspacePath);
    return read().recent.find((p) => path.resolve(p.path) === norm) ?? null;
  },

  /** 添加 / 更新一条记录（同 path 视为同一条，更新 lastOpened）*/
  upsert(entry: { id: string; path: string }): ProjectRecentEntry {
    const store = read();
    const norm = path.resolve(entry.path);
    const ts = Date.now();
    const idx = store.recent.findIndex((p) => path.resolve(p.path) === norm);
    if (idx >= 0) {
      const next: ProjectRecentEntry = { ...store.recent[idx]!, id: entry.id, lastOpened: ts };
      store.recent[idx] = next;
      write(store);
      return next;
    }
    const next: ProjectRecentEntry = { id: entry.id, path: entry.path, lastOpened: ts };
    store.recent.push(next);
    write(store);
    return next;
  },

  /** 仅更新 lastOpened（用户切换 project 时） */
  touch(id: string): void {
    const store = read();
    const idx = store.recent.findIndex((p) => p.id === id);
    if (idx < 0) return;
    store.recent[idx]! = { ...store.recent[idx]!, lastOpened: Date.now() };
    write(store);
  },

  /** 从 recent 移除（不动磁盘 .openspace/） */
  remove(id: string): void {
    const store = read();
    store.recent = store.recent.filter((p) => p.id !== id);
    write(store);
  },
};

export const PROJECTS_STORE_PATH = STORE_PATH;
