/**
 * Runtime 检测：通过 `which <cmd>` 判断本地 CLI 是否安装。
 *
 * MVP 只有 Cursor 会被实际 spawn；其他 runtime 即使检测到也不可用（返回给前端显示 "coming soon"）。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Runtime } from '@openspace/shared';

const execFileAsync = promisify(execFile);

const RUNTIME_COMMANDS: Record<Runtime, string> = {
  cursor: 'cursor-agent',
  codex: 'codex',
  claude: 'claude',
  kimi: 'kimi',
  copilot: 'copilot',
  gemini: 'gemini',
};

export interface RuntimeDetectResult {
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
}

const cache = new Map<Runtime, { value: RuntimeDetectResult; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

export async function detectRuntime(runtime: Runtime): Promise<RuntimeDetectResult> {
  const cached = cache.get(runtime);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const value = await doDetect(runtime);
  cache.set(runtime, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function doDetect(runtime: Runtime): Promise<RuntimeDetectResult> {
  const cmd = RUNTIME_COMMANDS[runtime];
  try {
    const { stdout: pathOut } = await execFileAsync('which', [cmd], { timeout: 3000 });
    const path = pathOut.trim();
    if (!path) return { installed: false };

    // 尝试获取版本号
    let version: string | undefined;
    try {
      const { stdout } = await execFileAsync(cmd, ['--version'], { timeout: 3000 });
      version = stdout.trim().split('\n')[0];
    } catch {
      // 部分 CLI 的 --version 未必走 0 退出码，忽略
    }

    return { installed: true, path, version };
  } catch (err) {
    return {
      installed: false,
      error: (err as Error).message,
    };
  }
}
