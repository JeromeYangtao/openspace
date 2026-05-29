/**
 * 服务端运行时配置（D-10: 启动方式与环境变量）
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { DEFAULT_PORT_SERVER } from '@openspace/shared';

export const config = {
  port: Number(process.env.OPENSPACE_PORT_SERVER ?? DEFAULT_PORT_SERVER),
  host: process.env.OPENSPACE_HOST ?? '127.0.0.1',
  openspaceHome: process.env.OPENSPACE_HOME ?? resolve(homedir(), '.openspace'),
  defaultWorkspace:
    process.env.OPENSPACE_DEFAULT_WORKSPACE ?? process.env.INIT_CWD ?? process.cwd(),
  logLevel: (process.env.OPENSPACE_LOG_LEVEL ?? 'info') as 'error' | 'warn' | 'info' | 'debug',
  /** CORS 允许的前端 origin（开发态） */
  webOrigin: process.env.OPENSPACE_WEB_ORIGIN ?? 'https://openspace.hermes-inc.com',
} as const;

export function dbPath(): string {
  return resolve(config.openspaceHome, 'openspace.db');
}

// CP8.5：D-8 v1.0 修订后 agent 不再有独立 workspace。
// `agentWorkspacePath` 已删除；Agent cwd 取自 `project.workspace_path`（D-13）。
