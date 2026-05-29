/**
 * Lightweight .env loader（Sprint 4-ext / S-1）
 *
 * 不引入 `dotenv` 依赖（保持 OpenSpace minimal philosophy），仅支持最常用语法：
 *   - KEY=value
 *   - KEY="value with spaces"
 *   - KEY='value'
 *   - 行首 # 注释
 *   - 已存在的 process.env 不会被覆盖（CLI 显式 export 优先）
 *
 * 查找顺序（首个命中即停）：
 *   1. OPENSPACE_ENV_FILE 环境变量指定的路径
 *   2. process.cwd()
 *   3. process.cwd() 上溯到 monorepo root（最多 5 层），找 .env
 *
 * 用途：Cursor SDK 的 CURSOR_API_KEY、未来的其他第三方凭证。
 */

import fs from 'node:fs';
import path from 'node:path';
import { readCursorSettings } from './config/cursor-settings.js';

export interface LoadEnvResult {
  loaded: boolean;
  source?: string;
  keysApplied: string[];
}

export function loadDotenv(): LoadEnvResult {
  const target = resolveEnvFile();
  if (!target) {
    return { loaded: false, keysApplied: [] };
  }

  let content: string;
  try {
    content = fs.readFileSync(target, 'utf-8');
  } catch {
    return { loaded: false, keysApplied: [] };
  }

  const applied: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;

    const key = line.slice(0, eqIdx).trim();
    if (!key) continue;

    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // shell-style export prefix tolerance: `export FOO=bar` → key="export FOO" 形式不该当成 key
    if (key.startsWith('export ')) {
      const realKey = key.slice('export '.length).trim();
      if (!realKey) continue;
      if (process.env[realKey] === undefined) {
        process.env[realKey] = value;
        applied.push(realKey);
      }
      continue;
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
      applied.push(key);
    }
  }

  return { loaded: true, source: target, keysApplied: applied };
}

// =============================================================================
// User settings.json 合并（Sprint 4-ext / S-1 收尾）
// =============================================================================

/**
 * 把 ~/.openspace/settings.json 的 cursor 配置合并进 process.env，作为 .env 之后的次优先级。
 * 已有 process.env.<key>（来自 shell / .env）的不会被覆盖。
 *
 * 调用时机：必须在 loadDotenv() 之后、createCursorAdapter() 之前。
 */
export interface MergeSettingsResult {
  loaded: boolean;
  source?: string;
  keysApplied: string[];
}

export function mergeUserSettings(): MergeSettingsResult {
  const s = readCursorSettings();
  if (!s.source) return { loaded: false, keysApplied: [] };

  const applied: string[] = [];

  if (s.backend && process.env.OPENSPACE_CURSOR_BACKEND === undefined) {
    process.env.OPENSPACE_CURSOR_BACKEND = s.backend;
    applied.push('OPENSPACE_CURSOR_BACKEND');
  }
  if (s.apiKey && process.env.CURSOR_API_KEY === undefined) {
    process.env.CURSOR_API_KEY = s.apiKey;
    applied.push('CURSOR_API_KEY');
  }

  return { loaded: true, source: s.source, keysApplied: applied };
}

function resolveEnvFile(): string | null {
  if (process.env.OPENSPACE_ENV_FILE) {
    const explicit = path.resolve(process.env.OPENSPACE_ENV_FILE);
    if (fs.existsSync(explicit)) return explicit;
  }

  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// =============================================================================
// Cursor SDK ripgrep path 自动配置（Sprint 4-ext）
// =============================================================================

/**
 * 自动定位 @cursor/sdk 自带的 ripgrep binary 并注入 CURSOR_RIPGREP_PATH 环境变量。
 *
 * SDK 内部 createLocalExecutor 会按以下顺序找 rg：
 *   1. process.env.CURSOR_RIPGREP_PATH  ← 我们注入这里
 *   2. 从 process.argv[1] 目录向上找 node_modules/@cursor/sdk-{platform}/bin/rg
 *   3. PATH 里的 `rg`
 *
 * pnpm 把 SDK 的 optionalDependency 平台包放在 .pnpm 间接路径里
 * （node_modules/.pnpm/@cursor+sdk-darwin-arm64@x.x.x/...），SDK 第 2 步的逻辑
 * 找不到，所以必须主动定位并注入。
 *
 * 不在 SDK 模式下（OPENSPACE_CURSOR_BACKEND != 'sdk'）直接 noop，避免无谓 IO。
 */
export interface ConfigureRgResult {
  configured: boolean;
  path?: string;
  reason?: string;
  alreadySet?: boolean;
}

export function configureCursorRipgrep(): ConfigureRgResult {
  if ((process.env.OPENSPACE_CURSOR_BACKEND ?? 'cli').toLowerCase() !== 'sdk') {
    return { configured: false, reason: 'OPENSPACE_CURSOR_BACKEND != sdk; skip' };
  }
  if (process.env.CURSOR_RIPGREP_PATH) {
    return { configured: true, path: process.env.CURSOR_RIPGREP_PATH, alreadySet: true };
  }

  const platform = `${process.platform}-${process.arch}`;
  // 与 SDK 内部查找列表保持同步
  const pkgs = [`@cursor/sdk-${platform}`, `@cursor/february-${platform}`];
  const rgBinName = process.platform === 'win32' ? 'rg.exe' : 'rg';

  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    for (const pkg of pkgs) {
      // 直接 hoisted 路径
      const direct = path.join(dir, 'node_modules', pkg, 'bin', rgBinName);
      if (fs.existsSync(direct)) {
        process.env.CURSOR_RIPGREP_PATH = direct;
        return { configured: true, path: direct };
      }
      // pnpm .pnpm 间接路径
      const pnpmDir = path.join(dir, 'node_modules', '.pnpm');
      if (fs.existsSync(pnpmDir)) {
        try {
          const flat = pkg.replace('/', '+');
          for (const entry of fs.readdirSync(pnpmDir)) {
            if (!entry.startsWith(`${flat}@`)) continue;
            const candidate = path.join(pnpmDir, entry, 'node_modules', pkg, 'bin', rgBinName);
            if (fs.existsSync(candidate)) {
              process.env.CURSOR_RIPGREP_PATH = candidate;
              return { configured: true, path: candidate };
            }
          }
        } catch {
          // .pnpm 目录读不动就忽略，继续向上找
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return {
    configured: false,
    reason: `no @cursor/sdk-${platform} ripgrep found in node_modules; SDK file ops will fail until system rg is installed or CURSOR_RIPGREP_PATH is set manually`,
  };
}
