import type { FastifyBaseLogger } from 'fastify';
import { listCodexAppServerStatuses } from './codex-app-server-adapter.js';
import { hub } from '../ws/hub.js';

const DEFAULT_INTERVAL_MS = 10_000;

let monitorTimer: NodeJS.Timeout | null = null;

export function startCodexRuntimeMonitor(options?: {
  intervalMs?: number;
  logger?: Pick<FastifyBaseLogger, 'warn'>;
}): void {
  if (monitorTimer) return;

  const publish = () => {
    try {
      hub.broadcastGlobal({
        type: 'codex_runtime_status',
        statuses: listCodexAppServerStatuses(),
      });
    } catch (e) {
      options?.logger?.warn({ err: e }, 'failed to publish Codex runtime status');
    }
  };

  publish();
  monitorTimer = setInterval(publish, options?.intervalMs ?? DEFAULT_INTERVAL_MS);
  monitorTimer.unref();
}

export function stopCodexRuntimeMonitor(): void {
  if (!monitorTimer) return;
  clearInterval(monitorTimer);
  monitorTimer = null;
}
