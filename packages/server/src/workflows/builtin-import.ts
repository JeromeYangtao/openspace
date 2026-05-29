/**
 * Builtin Workflow auto-import（Sprint 2 CP2）
 *
 * 在 Project 创建后调用一次，把 BUILTIN_TEMPLATES 全部 seed 到该 project 的 workflows 表。
 * 已存在同 trigger_command 的 workflow（用户已自定义 / 二次启动）会被跳过，不覆盖。
 */

import type { Database } from 'better-sqlite3';
import { workflowRepo } from '../db/repos.js';
import { BUILTIN_TEMPLATES } from './builtin-templates.js';
import { parseWorkflowYaml, WorkflowYamlError } from './yaml-parser.js';

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ command: string; reason: string }>;
}

export function importBuiltinsForProject(db: Database): ImportResult {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  for (const tpl of BUILTIN_TEMPLATES) {
    // 已存在同 trigger 则跳过（用户可能已编辑过）
    const existing = workflowRepo.getByTrigger(db, tpl.command);
    if (existing) {
      result.skipped += 1;
      continue;
    }

    // 校验模板 YAML（防止维护者误改导致无法启动）
    try {
      parseWorkflowYaml(tpl.yaml);
    } catch (e) {
      const reason = e instanceof WorkflowYamlError ? e.message : (e as Error).message;
      result.errors.push({ command: tpl.command, reason });
      continue;
    }

    workflowRepo.create(db, {
      name: tpl.name,
      description: tpl.description,
      trigger_command: tpl.command,
      definition_yaml: tpl.yaml,
      source: 'builtin',
    });
    result.imported += 1;
  }

  return result;
}
