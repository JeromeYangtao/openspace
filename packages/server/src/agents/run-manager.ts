/**
 * Agent Run Manager
 *
 * 后台 run 控制层：集中托管正在执行的 agent_run、心跳和 abort。
 * SQLite 仍是事实来源；内存 Map 只保存当前 server 进程能直接控制的 AbortController。
 */

import type { Database } from 'better-sqlite3';
import { agentRunJobRepo, agentRunRepo } from '../db/repos.js';
import { listOpenDbs } from '../db/index.js';

const HEARTBEAT_INTERVAL_MS = 5_000;
const SERVER_INSTANCE_ID = `${process.pid}-${Date.now().toString(36)}`;

interface ActiveRun {
  db: Database;
  aborter: AbortController;
  heartbeat: ReturnType<typeof setInterval>;
}

const activeRuns = new Map<number, ActiveRun>();

export function serverInstanceId(): string {
  return SERVER_INSTANCE_ID;
}

export function registerAgentRun(db: Database, runId: number): AbortSignal {
  const existing = activeRuns.get(runId);
  if (existing) {
    return existing.aborter.signal;
  }

  const aborter = new AbortController();
  agentRunRepo.touchHeartbeat(db, runId);
  const heartbeat = setInterval(() => {
    try {
      agentRunRepo.touchHeartbeat(db, runId);
    } catch {
      /* db may be closing during shutdown */
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  activeRuns.set(runId, { db, aborter, heartbeat });
  return aborter.signal;
}

export function completeAgentRun(runId: number): void {
  const active = activeRuns.get(runId);
  if (!active) return;
  clearInterval(active.heartbeat);
  activeRuns.delete(runId);
}

/** 中止指定 agent_run。返回是否真的有当前进程托管的 worker 被发了 abort 信号。 */
export function abortAgentRun(agentRunId: number): boolean {
  const active = activeRuns.get(agentRunId);
  if (!active) return false;
  try {
    active.aborter.abort();
  } catch {
    /* ignore */
  }
  return true;
}

export function abortSingleAgentRun(db: Database, agentRunId: number): boolean {
  const run = agentRunRepo.getById(db, agentRunId);
  if (!run || run.ended_at !== null) return false;

  const aborted = abortAgentRun(agentRunId);
  if (!aborted) {
    agentRunRepo.stop(db, agentRunId, 'stopped: no active worker in this server');
  }
  return true;
}

/**
 * 中止某 channel 内所有活跃 agent_runs。
 *
 * 当前进程托管的 run 会先 abort，让 engine 做最终收尾；已经失联的 stale run 直接标记 stopped。
 */
export function abortChannelAgentRuns(db: Database, channelId: string): number {
  const runs = agentRunRepo.listActiveInChannel(db, channelId);
  let count = 0;
  for (const run of runs) {
    if (abortAgentRun(run.id)) {
      count += 1;
      continue;
    }
    agentRunRepo.stop(db, run.id, 'stopped: no active worker in this server');
    count += 1;
  }
  count += agentRunJobRepo.cancelForChannel(db, channelId, 'cancelled by user');
  return count;
}

export function recoverInterruptedAgentRuns(options?: {
  logger?: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
}): { stopped: number } {
  let stopped = 0;
  for (const open of listOpenDbs()) {
    try {
      const active = agentRunRepo.listActive(open.db);
      for (const run of active) {
        agentRunRepo.stop(open.db, run.id, 'interrupted by OpenSpace server restart');
        stopped += 1;
      }
    } catch (e) {
      options?.logger?.warn(
        { err: e, workspace_path: open.workspacePath },
        '[run-manager] failed to recover interrupted runs',
      );
    }
  }
  if (stopped > 0) {
    options?.logger?.info(
      { stopped },
      '[run-manager] recovered interrupted agent runs',
    );
  }
  return { stopped };
}

export function snapshotRunManager(): {
  server_instance_id: string;
  active_runs: number;
} {
  return {
    server_instance_id: SERVER_INSTANCE_ID,
    active_runs: activeRuns.size,
  };
}
