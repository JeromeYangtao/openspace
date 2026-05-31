/**
 * WebSocket 消息协议（对齐 PLAN.md MVP-3 + Sprint 2 CP4）
 */

import type {
  ChatMessage,
  MessageMetadata,
  Task,
  WorkflowRun,
  WorkflowRunStatus,
} from './types.js';
import type { AgentStatus, TaskStatus } from './constants.js';

// =============================================================================
// Client → Server
// =============================================================================
export type ClientEvent =
  | { type: 'subscribe_channel'; channel_id: string }
  | { type: 'unsubscribe_channel'; channel_id: string }
  | {
      type: 'send_message';
      channel_id: string;
      thread_id?: string;
      content: string;
      /** 发送后自动创建一个 task 引用此消息 */
      as_task?: boolean;
    }
  | { type: 'typing_start'; channel_id: string }
  | { type: 'typing_stop'; channel_id: string }
  | { type: 'ping' };

// =============================================================================
// Server → Client
// =============================================================================
export type ServerEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'message_stream'; message_id: string; delta: string }
  | AgentActivityEvent
  | {
      type: 'message_done';
      message_id: string;
      final_content: string;
      metadata: MessageMetadata;
    }
  | {
      type: 'agent_status';
      agent_id: string;
      status: AgentStatus;
      /**
       * v1.0 新增：Agent 状态发生在哪个 channel（D-1 / D-18 per-channel 派生）。
       * 兼容 v0 前端：可选字段，旧前端直接忽略；新前端按 channel 分派显示。
       */
      channel_id?: string;
      detail?: string;
    }
  | { type: 'system_event'; event: SystemEvent }
  | { type: 'task_update'; task: Task }
  | {
      /** Sprint 2 CP4：workflow run 状态变化（启动/推进/awaiting/完成/中止/失败） */
      type: 'workflow_run_update';
      run: WorkflowRun;
    }
  | { type: 'subscribed'; channel_id: string }
  | { type: 'pong' }
  /**
   * D-21 Sprint C：跨 project 全局事件，由 hub.broadcastGlobal 投递到所有连接。
   * Frontend Sidebar / Inbox 收到后 refresh 对应 store。
   */
  | { type: 'project_list_changed'; reason: 'opened' | 'closed' | 'deleted' | 'updated' }
  | { type: 'knowledge_updated'; project_id: string; kind: 'decision' | 'lesson' }
  | { type: 'error'; code: string; message: string };

/**
 * Agent 执行过程事件。
 *
 * 用于把 runtime adapter 产生的 thinking / tool / session / error 等细节实时返回前端。
 * 这类事件不参与最终消息正文拼接；前端可用于展示执行时间线、工具调用、报错和 token usage。
 */
export type AgentActivityEvent = {
  type: 'agent_activity';
  channel_id: string;
  agent_id: string;
  run_id: number;
  message_id: string;
  event: AgentActivityPayload;
};

export type AgentActivityPayload =
  | {
      type: 'run.status';
      status: 'queued' | 'starting' | 'working';
      detail?: string;
    }
  | {
      type: 'session.started';
      session_id: string;
      meta?: Record<string, unknown>;
    }
  | {
      type: 'session.completed';
      duration_ms?: number;
      usage?: Record<string, unknown>;
    }
  | { type: 'thinking.delta'; text: string }
  | { type: 'thinking.completed' }
  | { type: 'text.delta'; text: string }
  | { type: 'text.completed'; text: string }
  | {
      type: 'tool.started';
      call_id: string;
      tool: string;
      args: Record<string, unknown>;
      summary: string;
    }
  | {
      type: 'tool.completed';
      call_id: string;
      tool: string;
      success: boolean;
      result?: string;
      exit_code?: number;
      duration_ms?: number;
    }
  | {
      type: 'approval.required';
      call_id?: string;
      title: string;
      kind?: 'command' | 'file_change' | 'permissions';
      command?: string;
      reason?: string;
      supported: boolean;
    }
  | { type: 'error'; message: string; code?: string; recoverable?: boolean };

// =============================================================================
// 系统事件（嵌套进 ServerEvent.system_event）
// =============================================================================
export type SystemEvent =
  | { type: 'task_created'; channel_id: string; task_id: number; title: string }
  | { type: 'task_claimed'; channel_id: string; task_id: number; agent: string }
  | {
      type: 'task_moved';
      channel_id: string;
      task_id: number;
      from: TaskStatus;
      to: TaskStatus;
      by: string;
    }
  | { type: 'agent_error'; channel_id: string; agent: string; message: string }
  | { type: 'chain_limit_reached'; channel_id: string; detail: string }
  /** Sprint 2 CP3 / CP4：workflow 阶段性事件（嵌入到 system 消息 metadata 用于前端识别） */
  | {
      type: 'workflow_started';
      channel_id: string;
      run_id: number;
      workflow_name: string;
    }
  | {
      type: 'workflow_step';
      channel_id: string;
      run_id: number;
      step_id: string;
      owner: string;
    }
  | {
      type: 'workflow_awaiting_approval';
      channel_id: string;
      run_id: number;
      step_id: string;
    }
  | {
      type: 'workflow_finished';
      channel_id: string;
      run_id: number;
      status: WorkflowRunStatus;
    };
