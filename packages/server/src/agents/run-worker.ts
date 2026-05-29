/**
 * Lightweight background worker for persisted agent run jobs.
 *
 * 第一版只做单进程内轮询：SQLite 保存 queued/running 状态，服务重启后 queued 继续，
 * running 标记 failed，避免 UI 假死。真正分布式 lease 可以之后再加。
 */

import type { Database } from 'better-sqlite3';
import { MAX_CONCURRENT_PROCESSES } from '@openspace/shared';
import {
  agentRepo,
  agentRunJobRepo,
  messageRepo,
  type AgentRunJob,
} from '../db/repos.js';
import { listOpenDbs } from '../db/index.js';
import { triggerAgent } from './engine.js';
import { enqueueChainedAgentRuns } from '../messaging/router.js';

const POLL_INTERVAL_MS = 1_000;

interface WorkerLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

let started = false;
let active = 0;
let timer: ReturnType<typeof setInterval> | null = null;

export function startRunWorker(options: { logger: WorkerLogger }): void {
  if (started) return;
  started = true;
  recoverInterruptedJobs(options);
  timer = setInterval(() => {
    void tick(options);
  }, POLL_INTERVAL_MS);
  timer.unref();
  void tick(options);
}

export function stopRunWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}

export function snapshotRunWorker(): { active: number; started: boolean } {
  return { active, started };
}

function recoverInterruptedJobs(options: { logger: WorkerLogger }): void {
  let failed = 0;
  for (const open of listOpenDbs()) {
    try {
      failed += agentRunJobRepo.recoverInterrupted(
        open.db,
        'interrupted by OpenSpace server restart',
      );
    } catch (e) {
      options.logger.warn(
        { err: e, workspace_path: open.workspacePath },
        '[run-worker] failed to recover interrupted jobs',
      );
    }
  }
  if (failed > 0) {
    options.logger.info({ failed }, '[run-worker] recovered interrupted jobs');
  }
}

async function tick(options: { logger: WorkerLogger }): Promise<void> {
  while (active < MAX_CONCURRENT_PROCESSES) {
    const claimed = claimNextJob();
    if (!claimed) return;
    active += 1;
    void runJob(claimed.db, claimed.job, options)
      .catch((e) => {
        options.logger.error({ err: e, job_id: claimed.job.id }, '[run-worker] job crashed');
        try {
          agentRunJobRepo.fail(claimed.db, claimed.job.id, (e as Error).message);
        } catch {
          /* ignore */
        }
      })
      .finally(() => {
        active -= 1;
        void tick(options);
      });
  }
}

function claimNextJob(): { db: Database; job: AgentRunJob } | null {
  for (const open of listOpenDbs()) {
    const job = agentRunJobRepo.claimNext(open.db);
    if (job) return { db: open.db, job };
  }
  return null;
}

async function runJob(
  db: Database,
  job: AgentRunJob,
  options: { logger: WorkerLogger },
): Promise<void> {
  const logger = {
    info: (m: string) => options.logger.info({ job_id: job.id, msg: m }, '[run-worker]'),
    warn: (m: string) => options.logger.warn({ job_id: job.id, msg: m }, '[run-worker]'),
    error: (m: string) => options.logger.error({ job_id: job.id, msg: m }, '[run-worker]'),
  };

  const agent = agentRepo.getById(db, job.agent_id);
  const triggerMessage = messageRepo.getById(db, job.trigger_message_id);
  if (!agent || !triggerMessage) {
    agentRunJobRepo.fail(db, job.id, 'agent or trigger message not found');
    return;
  }

  const result = await triggerAgent(
    agent.id,
    {
      channelId: job.channel_id,
      triggerMessage,
      parentMessageId: job.parent_message_id ?? undefined,
      chainDepth: job.chain_depth,
    },
    { db, logger },
  );

  if (result.ok) {
    agentRunJobRepo.complete(db, job.id);
    await enqueueChainedAgentRuns(
      agent,
      {
        channelId: job.channel_id,
        parentMessageId: job.parent_message_id ?? undefined,
        chainDepth: job.chain_depth,
      },
      result,
      { db, logger },
    );
  } else {
    agentRunJobRepo.fail(db, job.id, result.errorMessage ?? 'agent run failed');
  }
}
