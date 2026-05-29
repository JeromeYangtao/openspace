/**
 * Workflows store (Sprint 2 CP4)
 *
 * 维护：
 *   - workflowsByProject: 该 project 内可用的 workflow 列表（用于 /command 提示）
 *   - runsByThread: 当前已知的 workflow runs（按 thread_id 索引；通常 1 thread 对应 1 active run）
 *
 * 数据来源：
 *   - listProjectWorkflows() 切换 project 时拉一次
 *   - getActiveWorkflowRun(channelId, threadId) 打开 thread 时拉一次
 *   - WS workflow_run_update 实时更新
 */

import { create } from 'zustand';
import type { Workflow, WorkflowRun } from '@openspace/shared';
import { getActiveWorkflowRun, listProjectWorkflows } from '../lib/api';

interface WorkflowsState {
  /** key = project_id；value = 该 project 的 workflow 列表 */
  workflowsByProject: Map<string, Workflow[]>;
  /** key = thread_id；value = 该 thread 内当前/最新 run */
  runsByThread: Map<string, WorkflowRun>;
  /** key = workflow_id（用于 thread 进度条显示工作流名 / 解析步骤）*/
  workflowsById: Map<string, Workflow>;
  /**
   * Sprint 3 CP5：已经自动跳转过 thread 的 run id。
   * 用户可能手动关 thread，后续 workflow_run_update 事件不应再次自动打开。
   */
  autoJumpedRunIds: Set<number>;

  fetchProjectWorkflows: (projectId: string) => Promise<Workflow[]>;
  fetchActiveRun: (channelId: string, threadId: string) => Promise<WorkflowRun | null>;
  upsertRun: (run: WorkflowRun) => void;
  upsertWorkflow: (wf: Workflow) => void;
  /** 标记该 run 已被自动 jump（avoid 后续 update 反复触发） */
  markAutoJumped: (runId: number) => void;
  hasAutoJumped: (runId: number) => boolean;
  getRunByThread: (threadId: string) => WorkflowRun | undefined;
  getProjectWorkflows: (projectId: string) => Workflow[];
}

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
  workflowsByProject: new Map(),
  runsByThread: new Map(),
  workflowsById: new Map(),
  autoJumpedRunIds: new Set(),

  fetchProjectWorkflows: async (projectId) => {
    const list = await listProjectWorkflows(projectId);
    set((s) => {
      const next = new Map(s.workflowsByProject);
      next.set(projectId, list);
      const byId = new Map(s.workflowsById);
      for (const wf of list) byId.set(wf.id, wf);
      return { workflowsByProject: next, workflowsById: byId };
    });
    return list;
  },

  fetchActiveRun: async (channelId, threadId) => {
    try {
      const res = await getActiveWorkflowRun(channelId, threadId);
      if (!res.run) return null;
      const { workflow, ...run } = res.run;
      set((s) => {
        const nextRuns = new Map(s.runsByThread);
        if (run.thread_id) nextRuns.set(run.thread_id, run);
        const nextWfs = workflow
          ? new Map(s.workflowsById).set(workflow.id, workflow)
          : s.workflowsById;
        return { runsByThread: nextRuns, workflowsById: nextWfs };
      });
      return run;
    } catch (e) {
      console.error('[workflows] fetchActiveRun failed', e);
      return null;
    }
  },

  upsertRun: (run) =>
    set((s) => {
      const next = new Map(s.runsByThread);
      if (run.thread_id) next.set(run.thread_id, run);
      return { runsByThread: next };
    }),

  upsertWorkflow: (wf) =>
    set((s) => {
      const next = new Map(s.workflowsById);
      next.set(wf.id, wf);
      const byProj = new Map(s.workflowsByProject);
      const list = byProj.get(wf.project_id) ?? [];
      const idx = list.findIndex((x) => x.id === wf.id);
      if (idx >= 0) {
        const newList = [...list];
        newList[idx] = wf;
        byProj.set(wf.project_id, newList);
      } else {
        byProj.set(wf.project_id, [...list, wf]);
      }
      return { workflowsById: next, workflowsByProject: byProj };
    }),

  markAutoJumped: (runId) =>
    set((s) => {
      if (s.autoJumpedRunIds.has(runId)) return {};
      const next = new Set(s.autoJumpedRunIds);
      next.add(runId);
      return { autoJumpedRunIds: next };
    }),

  hasAutoJumped: (runId) => get().autoJumpedRunIds.has(runId),

  getRunByThread: (threadId) => get().runsByThread.get(threadId),
  getProjectWorkflows: (projectId) => get().workflowsByProject.get(projectId) ?? [],
}));
