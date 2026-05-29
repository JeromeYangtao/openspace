/**
 * Cursor Backend 用户设置（Sprint 4-ext / S-1 收尾）
 *
 * 持久化用户在 UI 配置的 Cursor backend 选项（cli/sdk）+ API key。
 * 路径：`~/.openspace/settings.json`（与 openspace.db 同目录，跨 Project 全局）。
 *
 * 与 .env 的优先级（启动时合并）：
 *   1. shell export 的环境变量（CI / 显式 override 最高）
 *   2. `.env`（项目根 / `OPENSPACE_ENV_FILE` 指定）
 *   3. `~/.openspace/settings.json`（UI 配置）  ← 本模块
 *   4. defaults（cli / 无 key）
 *
 * 写入触发：UI Settings 页 Save 按钮调 POST /api/settings/cursor 时持久化。
 * 写入后立即更新 process.env，运行时下一次 createCursorAdapter() 即生效，无需重启 server。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';

const SETTINGS_PATH = resolve(config.openspaceHome, 'settings.json');

export type CursorBackend = 'cli' | 'sdk';

export interface CursorSettingsFile {
  cursor?: {
    backend?: CursorBackend;
    apiKey?: string | null;
  };
}

export interface LoadedCursorSettings {
  source: string | null;
  backend?: CursorBackend;
  apiKey?: string | null;
}

/**
 * 读取 settings.json；不存在返回 `{ source: null }`，不抛错。
 */
export function readCursorSettings(): LoadedCursorSettings {
  if (!existsSync(SETTINGS_PATH)) {
    return { source: null };
  }
  try {
    const raw = readFileSync(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as CursorSettingsFile;
    const c = parsed.cursor ?? {};
    return {
      source: SETTINGS_PATH,
      backend: c.backend === 'sdk' ? 'sdk' : c.backend === 'cli' ? 'cli' : undefined,
      apiKey: typeof c.apiKey === 'string' && c.apiKey.length > 0 ? c.apiKey : undefined,
    };
  } catch {
    // 损坏的 JSON 视为不存在；UI 重新保存一次即可恢复
    return { source: null };
  }
}

/**
 * 写入 settings.json。
 *
 * 行为：
 *   - 合并已有内容（不动其他 key），仅更新 `cursor.*`
 *   - apiKey === null → 显式清除
 *   - apiKey === undefined → 保留原值
 *   - backend === undefined → 保留原值
 *   - 立即更新 process.env，让运行时 next createCursorAdapter() 生效
 */
export interface WriteCursorSettingsInput {
  backend?: CursorBackend;
  apiKey?: string | null;
}

export function writeCursorSettings(input: WriteCursorSettingsInput): LoadedCursorSettings {
  // 合并已有
  let existing: CursorSettingsFile = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      existing = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as CursorSettingsFile;
    } catch {
      existing = {};
    }
  }
  const cursor = { ...(existing.cursor ?? {}) };

  if (input.backend !== undefined) {
    cursor.backend = input.backend;
  }
  if (input.apiKey === null) {
    cursor.apiKey = null;
  } else if (input.apiKey !== undefined) {
    cursor.apiKey = input.apiKey;
  }

  const merged: CursorSettingsFile = { ...existing, cursor };

  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');

  // 运行时同步：UI 改完立即生效，下一次 createCursorAdapter() 自然读新值。
  // 注意：仅当用户没在更高优先级 (shell env / .env) 显式 override 时，写 process.env 才有意义。
  // 这里始终写，保持 settings.json 与 process.env 一致；shell env override 的场景 server
  // 启动期已经把它读进 process.env，本次 write 会覆盖 —— 我们认为 UI 操作晚于 shell 启动，
  // 用户意图是改当前会话；如果不是，重启 server 时优先级会自动回到 shell env > settings.json。
  if (cursor.backend) {
    process.env.OPENSPACE_CURSOR_BACKEND = cursor.backend;
  }
  if (cursor.apiKey === null) {
    delete process.env.CURSOR_API_KEY;
  } else if (typeof cursor.apiKey === 'string') {
    process.env.CURSOR_API_KEY = cursor.apiKey;
  }

  return readCursorSettings();
}

/**
 * 检查 settings.json 文件是否存在 + 读权限正常（用于状态卡片展示）。
 */
export function settingsFileInfo(): { path: string; exists: boolean; sizeBytes?: number } {
  if (!existsSync(SETTINGS_PATH)) {
    return { path: SETTINGS_PATH, exists: false };
  }
  try {
    const s = statSync(SETTINGS_PATH);
    return { path: SETTINGS_PATH, exists: true, sizeBytes: s.size };
  } catch {
    return { path: SETTINGS_PATH, exists: true };
  }
}

export const SETTINGS_FILE_PATH = SETTINGS_PATH;
