/**
 * 并发控制队列（D-5）
 *
 * 保持最多 MAX_CONCURRENT 个任务并发执行。
 * 超出时按 FIFO 进入 waiting 队列，waiting 满时立即拒绝。
 *
 * 用法:
 *   const result = await concurrencyQueue.run(async () => { ... });
 *   → 返回 { ok: true, result } | { ok: false, reason: 'queue_full' }
 */

import { MAX_CONCURRENT_PROCESSES, QUEUE_MAX_SIZE } from '@openspace/shared';

type Task<T> = () => Promise<T>;

interface QueueEntry<T> {
  task: Task<T>;
  resolve: (v: { ok: true; result: T }) => void;
  reject: (e: unknown) => void;
}

class ConcurrencyQueue {
  private running = 0;
  private waiting: QueueEntry<unknown>[] = [];

  async run<T>(
    task: Task<T>,
  ): Promise<{ ok: true; result: T } | { ok: false; reason: 'queue_full' }> {
    if (this.running < MAX_CONCURRENT_PROCESSES) {
      return this.execute(task);
    }

    if (this.waiting.length >= QUEUE_MAX_SIZE) {
      return { ok: false, reason: 'queue_full' };
    }

    // 入队等待
    return new Promise((resolve, reject) => {
      this.waiting.push({
        task: task as Task<unknown>,
        resolve: resolve as QueueEntry<unknown>['resolve'],
        reject,
      });
    });
  }

  private async execute<T>(task: Task<T>): Promise<{ ok: true; result: T }> {
    this.running += 1;
    try {
      const result = await task();
      return { ok: true, result };
    } finally {
      this.running -= 1;
      this.flushWaiting();
    }
  }

  private flushWaiting(): void {
    while (this.running < MAX_CONCURRENT_PROCESSES && this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (!next) break;
      // fire-and-forget；内部的 execute 会返回一个新的 Promise，我们把它接到 next.resolve 上
      this.execute(next.task)
        .then((r) => next.resolve(r))
        .catch((e) => next.reject(e));
    }
  }

  snapshot() {
    return { running: this.running, waiting: this.waiting.length };
  }
}

export const concurrencyQueue = new ConcurrencyQueue();
