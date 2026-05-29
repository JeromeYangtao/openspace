/**
 * Workflow 进度条（Sprint 2 CP4）
 *
 * 显示在 ThreadPanel 顶部当 thread 绑定一个 workflow_run 时。
 *
 * - 顶部：workflow 名 + 当前 step + 状态图标
 * - 中部：步骤序列（已完成 ✓ / 当前 ● / 未到 ○）
 * - 底部：awaiting_approval 时提示用户输入 /approve 或 /reject
 *
 * 数据：
 *   - runsByThread store 里的 WorkflowRun
 *   - workflowsById store 里的 Workflow（拿 definition_yaml 解析步骤序）
 */

import { useEffect, useMemo, useState } from 'react';
import { parse as parseYaml } from 'yaml';
import type { WorkflowRun } from '@openspace/shared';
import { cn } from '../lib/cn';
import { abortWorkflowRun } from '../lib/api';
import { useWorkflowsStore } from '../stores/workflows';

interface Props {
  channelId: string;
  threadId: string;
}

export function WorkflowProgress({ channelId, threadId }: Props) {
  const run = useWorkflowsStore((s) => s.runsByThread.get(threadId));
  const workflowsById = useWorkflowsStore((s) => s.workflowsById);
  const fetchActive = useWorkflowsStore((s) => s.fetchActiveRun);
  const [aborting, setAborting] = useState(false);

  // 第一次打开 thread 时拉一次（若 store 里没有）
  useEffect(() => {
    if (!run) {
      void fetchActive(channelId, threadId);
    }
  }, [run, channelId, threadId, fetchActive]);

  const workflow = run ? workflowsById.get(run.workflow_id) : null;

  const steps = useMemo(() => {
    if (!workflow) return [];
    return parseStepsFromYaml(workflow.definition_yaml);
  }, [workflow]);

  if (!run || !workflow) return null;

  const onAbort = async () => {
    if (aborting) return;
    if (!confirm(`Abort workflow "${workflow.name}"?`)) return;
    setAborting(true);
    try {
      await abortWorkflowRun(run.id);
    } catch (e) {
      console.error('abort failed', e);
    } finally {
      setAborting(false);
    }
  };

  const visibleSteps = steps.filter((s) => s.action !== 'close_thread');
  const currentIdx = visibleSteps.findIndex((s) => s.id === run.current_step);
  const totalCount = visibleSteps.length;
  const positionLabel =
    currentIdx >= 0 ? `Step ${currentIdx + 1}/${totalCount}` : `${totalCount} steps`;

  return (
    <div className="border-b-2 border-black bg-accent-yellow px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <StatusIcon status={run.status} />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm truncate">
            {workflow.name}
            <span className="ml-2 text-[11px] font-mono text-text-secondary">
              {positionLabel}
            </span>
          </div>
          <div className="text-[11px] font-mono text-text-secondary truncate">
            {statusLabel(run.status)}
            {run.current_step && (
              <>
                {' · '}
                <code className="bg-bg-card px-1 rounded">{run.current_step}</code>
              </>
            )}
          </div>
        </div>
        {(run.status === 'running' || run.status === 'awaiting_approval') && (
          <button
            onClick={() => void onAbort()}
            disabled={aborting}
            className="px-2 py-1 text-[11px] font-mono font-bold border-2 border-black rounded bg-bg-card hover:bg-accent-red disabled:opacity-50"
            title="Abort this workflow run"
          >
            ABORT
          </button>
        )}
      </div>

      {visibleSteps.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {visibleSteps.map((s, i) => (
            <StepPill key={s.id} step={s} state={pillState(i, currentIdx, run.status)} />
          ))}
        </div>
      )}

      {/* awaiting_approval 提示 UI 已迁移到 ApprovalCard 组件（CP2） */}
    </div>
  );
}

// ---------- helpers ----------

interface StepLite {
  id: string;
  owner: string;
  action?: string;
  description?: string;
}

function parseStepsFromYaml(yamlText: string): StepLite[] {
  try {
    const parsed = parseYaml(yamlText) as { steps?: unknown };
    if (!Array.isArray(parsed?.steps)) return [];
    return parsed.steps
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => ({
        id: typeof s.id === 'string' ? s.id : '?',
        owner: typeof s.owner === 'string' ? s.owner : '',
        action: typeof s.action === 'string' ? s.action : undefined,
        description: typeof s.description === 'string' ? s.description : undefined,
      }));
  } catch (e) {
    console.warn('[workflow] failed to parse steps for progress display', e);
    return [];
  }
}

function pillState(
  i: number,
  currentIdx: number,
  status: WorkflowRun['status'],
): 'done' | 'current' | 'todo' {
  if (status === 'completed') return 'done';
  if (currentIdx < 0) return 'todo';
  if (i < currentIdx) return 'done';
  if (i === currentIdx) return 'current';
  return 'todo';
}

function StepPill({
  step,
  state,
}: {
  step: StepLite;
  state: 'done' | 'current' | 'todo';
}) {
  const cls =
    state === 'done'
      ? 'bg-[#b8e98c] border-black'
      : state === 'current'
        ? 'bg-accent-pink border-black font-bold animate-pulse'
        : 'bg-bg-card border-black/40 text-text-secondary';
  const icon = state === 'done' ? '✓' : state === 'current' ? '●' : '○';
  return (
    <div
      className={cn(
        'flex items-center gap-1 px-2 py-0.5 border-2 rounded font-mono text-[10px] whitespace-nowrap',
        cls,
      )}
      title={step.description ?? step.id}
    >
      <span>{icon}</span>
      <span>{step.id}</span>
      {step.owner && <span className="text-[9px] opacity-70">→ {step.owner}</span>}
    </div>
  );
}

function StatusIcon({ status }: { status: WorkflowRun['status'] }) {
  if (status === 'running') {
    return <span className="text-base">⚙</span>;
  }
  if (status === 'awaiting_approval') {
    return <span className="text-base">⏸</span>;
  }
  if (status === 'completed') {
    return <span className="text-base">✅</span>;
  }
  if (status === 'aborted') {
    return <span className="text-base">⛔</span>;
  }
  return <span className="text-base">⚠</span>;
}

function statusLabel(status: WorkflowRun['status']): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'awaiting_approval':
      return 'Awaiting approval';
    case 'completed':
      return 'Completed';
    case 'aborted':
      return 'Aborted';
    case 'failed':
      return 'Failed';
  }
}
