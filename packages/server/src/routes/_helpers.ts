/**
 * Routes helpers — Per-Project Storage 重构后用来 resolve 请求对应的 db handle
 *
 * 设计：
 *   - 大多数 route handler 收到的是 channel_id / agent_id / message_id 等资源 id；
 *     用 findDbByResource 反查到 (db, workspacePath)。
 *   - 全局视图（如 GET /api/inbox）需要遍历 listOpenDbs 自己合并。
 *   - 新建场景（POST /api/channels）必须通过 query / body 显式传 project_id。
 *
 * 启动时建议 warm-up：openProjectDb(workspacePath) for each recent project，
 * 否则 findDbByResource 会因为 db 没打开而漏匹配。
 */

import type { Database } from 'better-sqlite3';
import { findDbByResource, listOpenDbs, openProjectDb } from '../db/index.js';
import { projectsService } from '../config/projects-service.js';

export interface ProjectDbContext {
  db: Database;
  workspacePath: string;
  projectId: string;
}

/** 启动期把 ~/.openspace/projects.json 中所有 recent project 的 db 都打开（warm up）*/
export function warmUpAllProjects(): { opened: number; errors: string[] } {
  const errors: string[] = [];
  let opened = 0;
  for (const p of projectsService.list()) {
    try {
      openProjectDb(p.workspace_path);
      opened += 1;
    } catch (e) {
      errors.push(`${p.workspace_path}: ${(e as Error).message}`);
    }
  }
  return { opened, errors };
}

/** 用 project id 拿 db handle */
export function dbForProjectId(projectId: string): ProjectDbContext | null {
  const p = projectsService.getById(projectId);
  if (!p) return null;
  return { db: openProjectDb(p.workspace_path), workspacePath: p.workspace_path, projectId };
}

/** 用 project name (slug) 拿 db handle */
export function dbForProjectName(name: string): ProjectDbContext | null {
  const p = projectsService.getByName(name);
  if (!p) return null;
  return { db: openProjectDb(p.workspace_path), workspacePath: p.workspace_path, projectId: p.id };
}

/** 资源反查（channels/agents/...）*/
export function dbForResource(
  table: Parameters<typeof findDbByResource>[0],
  id: string | number,
): ProjectDbContext | null {
  const found = findDbByResource(table, id);
  if (!found) return null;
  const project = projectsService.getByPath(found.workspacePath);
  if (!project) return null;
  return {
    db: found.db,
    workspacePath: found.workspacePath,
    projectId: project.id,
  };
}

/** 遍历所有打开的项目 db，逐个 callback 收集结果（全局视图用）*/
export function forEachProjectDb<T>(
  fn: (ctx: ProjectDbContext) => T[],
): T[] {
  const out: T[] = [];
  for (const { db, workspacePath } of listOpenDbs()) {
    const project = projectsService.getByPath(workspacePath);
    if (!project) continue;
    try {
      out.push(...fn({ db, workspacePath, projectId: project.id }));
    } catch {
      /* ignore single-project errors */
    }
  }
  return out;
}
