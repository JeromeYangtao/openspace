/**
 * Per-Workspace Project Meta — `<workspace>/.openspace/project.json`
 *
 * 项目元数据写在用户自己的代码仓库里，跟着 git 仓库走。
 * 与 `~/.openspace/projects.json`（全局 recent list）配合：
 *   - 全局：仅 id / path / lastOpened
 *   - 项目级：name / display_name / goal / team_rules / color / created_at
 *
 * 文件格式：
 * {
 *   "version": 1,
 *   "id": "abc123",
 *   "name": "my-proj",
 *   "display_name": "My Project",
 *   "goal": "...",
 *   "team_rules": null,
 *   "color": "#FFD93D",
 *   "created_at": 1730000000000
 * }
 *
 * 关键约束（D-21）：
 *   - workspace_path 是文件夹本身（运行时拼），不存
 *   - id 来自 nanoid，永久稳定
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface ProjectMetaFile {
  version: number;
  id: string;
  name: string;
  display_name: string | null;
  goal: string;
  team_rules: string | null;
  color: string | null;
  created_at: number;
}

export const PROJECT_META_DIR_NAME = '.openspace';
export const PROJECT_META_FILE_NAME = 'project.json';

export function projectMetaPath(workspacePath: string): string {
  return path.join(workspacePath, PROJECT_META_DIR_NAME, PROJECT_META_FILE_NAME);
}

export function projectOpenSpaceDir(workspacePath: string): string {
  return path.join(workspacePath, PROJECT_META_DIR_NAME);
}

export function readProjectMeta(workspacePath: string): ProjectMetaFile | null {
  const file = projectMetaPath(workspacePath);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as ProjectMetaFile;
  } catch {
    return null;
  }
}

export function writeProjectMeta(
  workspacePath: string,
  meta: Omit<ProjectMetaFile, 'version'>,
): ProjectMetaFile {
  const openspaceDir = projectOpenSpaceDir(workspacePath);
  mkdirSync(openspaceDir, { recursive: true });
  const file = projectMetaPath(workspacePath);
  const full: ProjectMetaFile = { version: 1, ...meta };
  writeFileSync(file, `${JSON.stringify(full, null, 2)}\n`, 'utf-8');
  return full;
}

export function updateProjectMeta(
  workspacePath: string,
  patch: Partial<Omit<ProjectMetaFile, 'version' | 'id' | 'created_at'>>,
): ProjectMetaFile | null {
  const existing = readProjectMeta(workspacePath);
  if (!existing) return null;
  const updated: ProjectMetaFile = {
    ...existing,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.display_name !== undefined ? { display_name: patch.display_name } : {}),
    ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
    ...(patch.team_rules !== undefined ? { team_rules: patch.team_rules } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
  };
  writeFileSync(
    projectMetaPath(workspacePath),
    `${JSON.stringify(updated, null, 2)}\n`,
    'utf-8',
  );
  return updated;
}
