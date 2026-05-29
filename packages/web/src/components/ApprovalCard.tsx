/**
 * Approval Card（Sprint 3 CP2）
 *
 * 替代 Sprint 2 的 "⏸ Reply /approve..." 文字提示。
 *
 * 当 thread 内 workflow_run.status === 'awaiting_approval' 时渲染：
 *   - 显示 workflow / 当前 step 信息
 *   - 显示前一 step 的输出摘要（来自 state_json.step_outputs[input]）
 *   - 操作：Approve / Reject (with optional reason) / Abort
 *
 * 实际推进通过 WebSocket send_message 发送 /approve 或 /reject 指令到 thread。
 * 后端 MessageRouter 解析指令 → advanceWithUserAction（Sprint 2 CP3 已落地）。
 */

import { useMemo, useState } from 'react';
import { parse as parseYaml } from 'yaml';
import { abortWorkflowRun } from '../lib/api';
import { wsClient } from '../lib/ws';
import { useWorkflowsStore } from '../stores/workflows';
import { cn } from '../lib/cn';

interface Props {
  channelId: string;
  threadId: string;
}

interface StepLite {
  id: string;
  owner: string;
  description?: string;
  action?: string;
  on_approve?: string;
  on_reject?: string;
  input?: string;
}

interface RunStateLite {
  step_outputs: Record<string, { summary?: string }>;
  initial_input?: string;
  last_rejection_reason?: string;
}

export function ApprovalCard({ channelId, threadId }: Props) {
  const run = useWorkflowsStore((s) => s.runsByThread.get(threadId));
  const workflow = useWorkflowsStore((s) =>
    run ? s.workflowsById.get(run.workflow_id) : null,
  );

  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const steps = useMemo<StepLite[]>(() => {
    if (!workflow) return [];
    return parseSteps(workflow.definition_yaml);
  }, [workflow]);

  const state = useMemo<RunStateLite>(() => {
    if (!run) return { step_outputs: {} };
    try {
      const parsed = JSON.parse(run.state_json) as Partial<RunStateLite>;
      return { step_outputs: parsed.step_outputs ?? {}, initial_input: parsed.initial_input, last_rejection_reason: parsed.last_rejection_reason };
    } catch {
      return { step_outputs: {} };
    }
  }, [run]);

  if (!run || !workflow) return null;
  if (run.status !== 'awaiting_approval') return null;

  const currentStep = steps.find((s) => s.id === run.current_step);
  if (!currentStep) return null;

  // 前一步：currentStep.input 显式声明 / 否则取最近一个有 output 的 step
  const prevStepId =
    currentStep.input ?? findLastCompletedStep(steps, currentStep, state);
  const prevOutput = prevStepId ? state.step_outputs[prevStepId] : undefined;
  const prevStep = prevStepId ? steps.find((s) => s.id === prevStepId) : null;

  const sendCommand = (cmd: string) => {
    wsClient.send({
      type: 'send_message',
      channel_id: channelId,
      thread_id: threadId,
      content: cmd,
    });
  };

  const onApprove = () => {
    if (submitting) return;
    setSubmitting(true);
    sendCommand('/approve');
    setTimeout(() => setSubmitting(false), 1500);
  };

  const onReject = () => {
    if (submitting) return;
    setSubmitting(true);
    const trimmed = reason.trim();
    const cmd = trimmed ? `/reject ${trimmed}` : '/reject';
    sendCommand(cmd);
    setReason('');
    setShowReject(false);
    setTimeout(() => setSubmitting(false), 1500);
  };

  const onAbort = async () => {
    if (submitting) return;
    if (!confirm(`Abort workflow "${workflow.name}"?`)) return;
    setSubmitting(true);
    try {
      await abortWorkflowRun(run.id);
    } catch (e) {
      console.error('abort failed', e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="my-3 border-2 border-black rounded-lg bg-bg-card shadow-[4px_4px_0_0_#000] overflow-hidden">
      <header className="bg-accent-pink border-b-2 border-black px-3 py-2 flex items-center gap-2">
        <span className="text-base">⏸</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">Approval needed</div>
          <div className="text-[11px] font-mono text-text-secondary truncate">
            {workflow.name} · step "{currentStep.id}"
          </div>
        </div>
      </header>

      <div className="px-3 py-3 space-y-3">
        {currentStep.description && (
          <div className="text-sm">{currentStep.description}</div>
        )}

        {prevOutput?.summary && (
          <details className="group">
            <summary className="cursor-pointer text-[12px] font-mono text-text-secondary hover:underline">
              ▸ Output of previous step
              {prevStep ? ` "${prevStep.id}"` : ''}
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto bg-bg-main border-2 border-black/30 rounded p-2 text-[11px] font-mono whitespace-pre-wrap break-words">
              {prevOutput.summary}
            </pre>
          </details>
        )}

        {state.last_rejection_reason && (
          <div className="text-[11px] font-mono p-2 border-2 border-accent-orange rounded bg-accent-yellow/30">
            Previous rejection reason: {state.last_rejection_reason}
          </div>
        )}

        {!showReject ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onApprove}
              disabled={submitting}
              className={cn(
                'flex-1 px-3 py-2 border-2 border-black rounded font-bold text-sm',
                submitting
                  ? 'bg-[#b8e98c]/50 cursor-not-allowed'
                  : 'bg-[#b8e98c] hover:brightness-105',
              )}
            >
              ✓ Approve
            </button>
            <button
              onClick={() => setShowReject(true)}
              disabled={submitting}
              className="flex-1 px-3 py-2 border-2 border-black rounded font-bold text-sm bg-accent-orange/40 hover:brightness-105 disabled:opacity-50"
            >
              ↩ Reject…
            </button>
            <button
              onClick={() => void onAbort()}
              disabled={submitting}
              title="Abort the workflow run"
              className="px-3 py-2 border-2 border-black rounded font-bold text-sm bg-bg-card hover:bg-accent-red disabled:opacity-50"
            >
              Abort
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              autoFocus
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional: explain what needs to change…"
              className="w-full px-2 py-1.5 border-2 border-black rounded bg-bg-card text-sm focus:outline-none focus:ring-2 focus:ring-accent-pink resize-none"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  onReject();
                }
              }}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={onReject}
                disabled={submitting}
                className="flex-1 px-3 py-1.5 border-2 border-black rounded font-bold text-sm bg-accent-orange hover:brightness-105 disabled:opacity-50"
              >
                Send Reject
              </button>
              <button
                onClick={() => {
                  setShowReject(false);
                  setReason('');
                }}
                disabled={submitting}
                className="px-3 py-1.5 border-2 border-black rounded font-bold text-sm bg-bg-card hover:bg-accent-yellow disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            <div className="text-[10px] font-mono text-text-secondary">
              Press ⌘/Ctrl + Enter to send.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function parseSteps(yamlText: string): StepLite[] {
  try {
    const parsed = parseYaml(yamlText) as { steps?: unknown };
    if (!Array.isArray(parsed?.steps)) return [];
    return parsed.steps
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => ({
        id: typeof s.id === 'string' ? s.id : '?',
        owner: typeof s.owner === 'string' ? s.owner : '',
        description: typeof s.description === 'string' ? s.description : undefined,
        action: typeof s.action === 'string' ? s.action : undefined,
        on_approve: typeof s.on_approve === 'string' ? s.on_approve : undefined,
        on_reject: typeof s.on_reject === 'string' ? s.on_reject : undefined,
        input: typeof s.input === 'string' ? s.input : undefined,
      }));
  } catch {
    return [];
  }
}

function findLastCompletedStep(
  steps: StepLite[],
  currentStep: StepLite,
  state: RunStateLite,
): string | undefined {
  // 取在 steps 数组中位于 currentStep 之前、有 step_outputs 记录的最后一个
  const currentIdx = steps.findIndex((s) => s.id === currentStep.id);
  for (let i = currentIdx - 1; i >= 0; i -= 1) {
    const s = steps[i];
    if (!s) continue;
    if (state.step_outputs[s.id]) return s.id;
  }
  return undefined;
}
