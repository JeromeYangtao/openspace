/**
 * Knowledge Store — `<workspace>/.openspace/knowledge/{decisions,lessons}.jsonl`
 *
 * D-21 Sprint C：把 reviewed='approved' 的 decisions/lessons 同步到 JSONL 文件，
 * 让团队可以将这部分知识入 git，与代码一起走 PR review / 历史回溯。
 *
 * 覆盖式简化版（v0）：
 *   - 触发时机：approve 操作（updateReview('approved') 后）→ 整体重写 jsonl
 *   - 数据来源：decisionRepo.list / lessonRepo.list 仅 review_status='approved'
 *   - 行格式：每行一个 JSON 对象（含全部字段）
 *
 * 简化代价：每次 approve 整体重写文件，IO 比"增量 append"重；
 * 但行数实际上很少（< 100），重写成本可忽略。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import type { Decision, Lesson } from '@openspace/shared';
import { decisionRepo, lessonRepo } from '../db/repos.js';
import { projectOpenSpaceDir } from './project-meta.js';

const KNOWLEDGE_DIR_NAME = 'knowledge';
const DECISIONS_FILE = 'decisions.jsonl';
const LESSONS_FILE = 'lessons.jsonl';

function knowledgeDir(workspacePath: string): string {
  return path.join(projectOpenSpaceDir(workspacePath), KNOWLEDGE_DIR_NAME);
}

function ensureDir(workspacePath: string): string {
  const dir = knowledgeDir(workspacePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** 把 db 里所有 approved 的 decisions 整体写到 decisions.jsonl */
export function rewriteDecisionsJsonl(db: Database, workspacePath: string): void {
  const dir = ensureDir(workspacePath);
  const rows = decisionRepo.list(db, { review_status: 'approved', limit: 10_000 });
  const lines = rows.map((d) => JSON.stringify(toJsonRow(d))).join('\n');
  writeFileSync(path.join(dir, DECISIONS_FILE), lines.length ? `${lines}\n` : '', 'utf-8');
}

/** 把 db 里所有 approved 的 lessons 整体写到 lessons.jsonl */
export function rewriteLessonsJsonl(db: Database, workspacePath: string): void {
  const dir = ensureDir(workspacePath);
  const rows = lessonRepo.list(db, { review_status: 'approved', limit: 10_000 });
  const lines = rows.map((l) => JSON.stringify(toJsonRow(l))).join('\n');
  writeFileSync(path.join(dir, LESSONS_FILE), lines.length ? `${lines}\n` : '', 'utf-8');
}

/**
 * 同步 decisions + lessons jsonl（一次写两个文件）。
 * 调用方：approve / reject / update / delete 后调一次即可。
 */
export function syncKnowledgeJsonl(db: Database, workspacePath: string): void {
  rewriteDecisionsJsonl(db, workspacePath);
  rewriteLessonsJsonl(db, workspacePath);
}

function toJsonRow<T extends Decision | Lesson>(row: T): Omit<T, 'project_id'> {
  // project_id 在 jsonl 里没意义（文件本身在 project 目录里），跳过
  const copy = { ...row } as Partial<T>;
  delete (copy as Record<string, unknown>).project_id;
  return copy as Omit<T, 'project_id'>;
}
