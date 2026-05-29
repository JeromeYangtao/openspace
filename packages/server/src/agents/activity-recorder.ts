/**
 * ActivityRecorder — 按 D-3 规则写入 agent_activity 表
 *
 * 记录事件：
 *   - spawn 开始     → type=thinking
 *   - 首个 text/tool → type=working
 *   - tool.started   → type=working
 *   - tool.completed → type=output
 *   - session.completed → type=idle
 *   - error          → type=error
 *
 * 不记录：text.delta / thinking.delta（会爆炸）
 *
 * v1.0 修订（CP3 / K-3）：每次 append 带 channel_id，便于 Profile Activity Tab 按 channel 过滤。
 */

import type { Database } from 'better-sqlite3';
import { activityRepo } from '../db/repos.js';
import { summarizeToolArgs } from './summarize-tool-args.js';
import type { CLIEvent } from './types.js';

export class ActivityRecorder {
  private hasEmittedWorking = false;

  constructor(
    private db: Database,
    private agentId: string,
    /** v1.0 新增：活动归属的 channel（K-3） */
    private channelId: string | null = null,
  ) {}

  spawnStart(detail: string): void {
    activityRepo.append(this.db, {
      agent_id: this.agentId,
      channel_id: this.channelId,
      type: 'thinking',
      detail,
    });
  }

  recordEvent(event: CLIEvent): void {
    switch (event.type) {
      case 'text.delta':
      case 'thinking.delta':
        if (!this.hasEmittedWorking) {
          this.hasEmittedWorking = true;
          activityRepo.append(this.db, {
            agent_id: this.agentId,
            channel_id: this.channelId,
            type: 'working',
            detail: 'Started generating response',
          });
        }
        break;

      case 'tool.started': {
        this.hasEmittedWorking = true;
        const summary = summarizeToolArgs(event.tool, event.args);
        activityRepo.append(this.db, {
          agent_id: this.agentId,
          channel_id: this.channelId,
          type: 'working',
          detail: summary ? `${event.tool}: ${summary}` : event.tool,
        });
        break;
      }

      case 'tool.completed':
        activityRepo.append(this.db, {
          agent_id: this.agentId,
          channel_id: this.channelId,
          type: 'output',
          detail: `${event.tool} ${event.success ? '✓' : '✗'} exit=${event.exit_code ?? '?'}`,
        });
        break;

      case 'session.completed':
        activityRepo.append(this.db, {
          agent_id: this.agentId,
          channel_id: this.channelId,
          type: 'idle',
          detail: `Completed in ${event.duration_ms ?? '?'}ms`,
        });
        break;

      case 'error':
        activityRepo.append(this.db, {
          agent_id: this.agentId,
          channel_id: this.channelId,
          type: 'error',
          detail: `${event.code ?? 'error'}: ${event.message}`,
        });
        break;

      default:
        break;
    }
  }
}
