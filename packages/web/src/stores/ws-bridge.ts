/**
 * WS → stores 的中继：订阅 wsClient 事件，分发到对应 store
 */

import type { ServerEvent } from '@openspace/shared';
import { wsClient } from '../lib/ws';
import { useAgentsStore } from './agents';
import { useApprovalsStore } from './approvals';
import { useMessagesStore } from './messages';
import { useProjectsStore } from './projects';
import { useWorkflowsStore } from './workflows';

let initialized = false;

export function initWSBridge(): void {
  if (initialized) return;
  initialized = true;

  wsClient.subscribe((event: ServerEvent) => {
    switch (event.type) {
      case 'message':
        useMessagesStore.getState().upsertMessage(event.message);
        break;
      case 'message_stream':
        useMessagesStore.getState().appendDelta(event.message_id, event.delta);
        break;
      case 'message_done':
        useMessagesStore
          .getState()
          .finalizeMessage(event.message_id, event.final_content, event.metadata);
        break;
      case 'agent_activity':
        useMessagesStore.getState().appendActivity(event);
        if (event.event.type === 'approval.required') {
          void useApprovalsStore.getState().refreshPending();
        }
        break;
      case 'workflow_run_update': {
        // CP4：runner 推进或终止时同步进度条
        useWorkflowsStore.getState().upsertRun(event.run);
        break;
      }
      case 'agent_status': {
        // CP8.3：状态完全由 agent_runs 派生（per-channel）。
        // - thinking/working/error/stopped：写入 per-channel map
        // - idle：表示该 channel 的 run 结束，从 map 移除
        const store = useAgentsStore.getState();
        if (event.channel_id) {
          if (event.status === 'idle') {
            store.clearChannelRun(event.agent_id, event.channel_id);
          } else {
            store.setChannelRunStatus(event.agent_id, event.channel_id, event.status);
          }
        }
        break;
      }
      case 'project_list_changed': {
        // D-21 Sprint C：服务端通知 project list 变化（open/close/delete/update）
        void useProjectsStore.getState().refresh();
        break;
      }
      case 'knowledge_updated': {
        // D-21 Sprint C：knowledge 同步事件，前端可决定是否 re-fetch
        // 当前 IntelligencePage 拉数据时直接 GET，不需要主动 refresh
        // 只在打印日志，便于调试
        if (typeof console !== 'undefined') {
          console.debug('[ws] knowledge_updated', event.project_id, event.kind);
        }
        break;
      }
      default:
        break;
    }
  });
}
