/**
 * ActivityRecorder — 按 D-3 规则写入 agent_activity 表
 *
 * 不记录 text.delta / thinking.delta 的每个增量，只在首次增量时写 working。
 * Activity 写入失败不能影响正在运行的 agent。
 */

import type { Database } from 'better-sqlite3';
import { activityRepo } from '../db/repos.js';
import { summarizeToolArgs } from './summarize-tool-args.js';
import type { CLIEvent } from './types.js';

type ActivityType = 'thinking' | 'working' | 'output' | 'idle' | 'error';

export class ActivityRecorder {
  private hasEmittedWorking = false;
  private disabled = false;

  constructor(
    private db: Database,
    private agentId: string,
    private channelId: string | null = null,
  ) {}

  spawnStart(detail: string): void {
    this.append('thinking', detail);
  }

  recordEvent(event: CLIEvent): void {
    try {
      switch (event.type) {
        case 'text.delta':
        case 'thinking.delta':
          if (!this.hasEmittedWorking) {
            this.hasEmittedWorking = true;
            this.append('working', 'Started generating response');
          }
          break;

        case 'progress.updated':
          this.hasEmittedWorking = true;
          this.append('working', `${event.source}: ${event.summary}`);
          break;

        case 'tool.started': {
          this.hasEmittedWorking = true;
          const summary = summarizeToolArgs(event.tool, event.args);
          this.append('working', summary ? `${event.tool}: ${summary}` : event.tool);
          break;
        }

        case 'tool.completed':
          this.append(
            'output',
            `${event.tool} ${event.success ? '✓' : '✗'} exit=${event.exit_code ?? '?'}`,
          );
          break;

        case 'approval.required':
          this.append(
            event.supported ? 'working' : 'error',
            event.command ? `${event.title}: ${event.command}` : event.title,
          );
          break;

        case 'session.completed':
          this.append('idle', `Completed in ${event.duration_ms ?? '?'}ms`);
          break;

        case 'error':
          this.append('error', `${event.code ?? 'error'}: ${event.message}`);
          break;

        default:
          break;
      }
    } catch {
      /* Activity recording must never interrupt an active agent run. */
    }
  }

  private append(type: ActivityType, detail: string): void {
    if (this.disabled || !this.db.open) {
      this.disabled = true;
      return;
    }

    try {
      activityRepo.append(this.db, {
        agent_id: this.agentId,
        channel_id: this.channelId,
        type,
        detail,
      });
    } catch (e) {
      if (isClosedDbError(e)) {
        this.disabled = true;
      }
      /* Ignore closed DB handles or transient activity-write failures. */
    }
  }
}

function isClosedDbError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /database connection is not open|database is not open|closed database/i.test(message);
}
