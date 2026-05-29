/**
 * Seed — Per-Project Storage 重构后此模块已基本退役（D-21）。
 *
 * 旧版本：在中央 db 启动时检测是否需要预置初始数据。
 * 新版本：项目数据全部在 <workspace>/.openspace/openspace.db，启动期不再有"中央 db 初始化"概念。
 * 仅留个 stub log 让旧版调用站不破坏。
 */

import { existsSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { config } from '../config.js';
import { projectsStore } from '../config/projects-store.js';

export async function runStartupCheck(
  logger?: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<void> {
  const log = (msg: string) => logger?.info?.(msg) ?? console.log(msg);
  const warn = (msg: string) => logger?.warn?.(msg) ?? console.warn(msg);

  const recent = projectsStore.list();
  log(`[startup] ${recent.length} project(s) tracked in ~/.openspace/projects.json`);

  // 检测旧版中央 db
  const legacyDbPath = pathResolve(config.openspaceHome, 'openspace.db');
  if (existsSync(legacyDbPath)) {
    warn(
      `[startup] legacy central db found at ${legacyDbPath} (per-project storage migration discarded data). ` +
        `Move or delete it manually if you want to free disk: \`mv ${legacyDbPath} ${legacyDbPath}.legacy-$(date +%Y%m%d)\``,
    );
  }
}
