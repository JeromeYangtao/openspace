/**
 * Message 组件 — 按 sender_type 分三种样式
 *
 * 参考: docs/ui-reference/screenshots/10-channel-main-desktop.png
 */

import { useEffect, useMemo, useState } from 'react';
import type {
  Agent,
  AgentActivityEvent,
  AgentActivityPayload,
  ChatMessage,
} from '@openspace/shared';
import { cn } from '../lib/cn';
import {
  abortAgentRun,
  decideAgentApproval,
  saveMessage,
  unsaveMessage,
  type AgentApprovalDecision,
} from '../lib/api';
import type { ApprovalResolution } from '../stores/approvals';
import { useApprovalsStore } from '../stores/approvals';
import { useAuthStore } from '../stores/auth';
import type { AuthUser } from '../lib/api';
import { Avatar } from './Avatar';
import { MessageContent } from './MessageContent';

export interface MessageProps {
  message: ChatMessage;
  agent?: Agent;
  user?: AuthUser;
  /** 流式中的增量文本（如果有），优先于 message.content 展示 */
  streamingText?: string;
  activityEvents?: AgentActivityEvent[];
  saved?: boolean;
  /** 是否有 thread reply 已存在；用于显示 "N replies" 按钮 */
  onOpenThread?: (rootId: string) => void;
  onOpenAgentProfile?: (agentId: string) => void;
  onRunAborted?: (runId: number) => void;
}

export function Message({
  message,
  agent,
  user,
  streamingText,
  activityEvents,
  saved: initiallySaved = false,
  onOpenThread,
  onOpenAgentProfile,
  onRunAborted,
}: MessageProps) {
  const [saved, setSaved] = useState(initiallySaved);
  const [abortingRun, setAbortingRun] = useState(false);
  const currentUser = useAuthStore((s) => s.user);

  useEffect(() => {
    setSaved(initiallySaved);
  }, [initiallySaved, message.id]);

  const toggleSave = async () => {
    if (saved) {
      await unsaveMessage(message.id);
      setSaved(false);
    } else {
      await saveMessage(message.id);
      setSaved(true);
    }
  };

  const activityRows = useMemo(
    () => (activityEvents ? compactActivityEvents(activityEvents.map((e) => e.event)) : []),
    [activityEvents],
  );
  const resolvedApprovals = useApprovalsStore((s) => s.resolvedById);
  const approvalRows = useMemo(
    () =>
      compactApprovalRows(activityRows).filter(
        (row) => !row.callId || !resolvedApprovals.has(row.callId),
      ),
    [activityRows, resolvedApprovals],
  );

  if (message.sender_type === 'system') {
    return <SystemMessage message={message} />;
  }

  const isStreaming = !!message.metadata?.streaming;
  const displayText = isStreaming
    ? (streamingText ?? message.content)
    : message.content || streamingText || '';
  const showGeneratingPlaceholder = isStreaming && activityRows.length === 0;
  const activeRunId =
    message.sender_type === 'agent' && isStreaming ? activityEvents?.[0]?.run_id : undefined;

  const displayName =
    message.sender_type === 'agent'
      ? (agent?.name ?? 'Agent')
      : message.sender_id && currentUser?.id === message.sender_id
        ? 'You'
        : (user?.display_name ?? user?.username ?? 'User');

  const descSnippet =
    message.sender_type === 'agent'
      ? (agent?.description?.split(/[\n。.]/)[0]?.slice(0, 60) ?? '')
      : '';

  const abortRun = async () => {
    if (!activeRunId || abortingRun) return;
    setAbortingRun(true);
    try {
      await abortAgentRun(activeRunId);
      onRunAborted?.(activeRunId);
    } finally {
      setAbortingRun(false);
    }
  };

  const canOpenAgentProfile = message.sender_type === 'agent' && !!agent && !!onOpenAgentProfile;
  const openAgentProfile = () => {
    if (!canOpenAgentProfile) return;
    onOpenAgentProfile(agent.id);
  };

  return (
    <div className="flex gap-3 py-1.5 group">
      {canOpenAgentProfile ? (
        <button
          type="button"
          onClick={openAgentProfile}
          className="h-fit rounded focus:outline-none focus:ring-2 focus:ring-black"
          title={`Open ${displayName} profile`}
          aria-label={`Open ${displayName} profile`}
        >
          <Avatar name={displayName} kind="agent" size="md" className="cursor-pointer" />
        </button>
      ) : (
        <Avatar
          name={displayName}
          kind={message.sender_type === 'agent' ? 'agent' : 'user'}
          size="md"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 text-sm">
          {canOpenAgentProfile ? (
            <button
              type="button"
              onClick={openAgentProfile}
              className="font-bold text-left hover:underline focus:outline-none focus:underline"
            >
              {displayName}
            </button>
          ) : (
            <span className="font-bold">{displayName}</span>
          )}
          {message.sender_type === 'user' && user?.username && displayName !== user.username && (
            <span className="text-[11px] font-mono text-text-secondary">@{user.username}</span>
          )}
          {descSnippet && (
            <span className="text-[11px] font-mono text-text-secondary truncate max-w-[260px]">
              {descSnippet}
            </span>
          )}
          <span className="text-[11px] font-mono text-text-secondary ml-auto">
            {formatTime(message.created_at)}
          </span>
          {activeRunId && (
            <button
              type="button"
              onClick={() => void abortRun()}
              disabled={abortingRun}
              className="px-2 py-0.5 border-2 border-black rounded bg-bg-card text-[10px] font-bold hover:bg-accent-red disabled:opacity-60"
              title="Stop this agent run"
            >
              {abortingRun ? 'Stopping...' : 'Stop'}
            </button>
          )}
          <button
            onClick={() => void toggleSave()}
            className={cn(
              'opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center border-2 border-black rounded',
              saved ? 'bg-accent-yellow opacity-100' : 'bg-bg-card hover:bg-accent-yellow',
            )}
            title={saved ? 'Remove from saved' : 'Save message'}
            aria-label={saved ? 'Remove from saved' : 'Save message'}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill={saved ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </div>

        {message.sender_type === 'agent' && activityEvents && activityEvents.length > 0 && (
          <AgentActivityPanel rows={activityRows} isStreaming={isStreaming} />
        )}

        <MessageContent content={displayText} isStreaming={showGeneratingPlaceholder} />

        {approvalRows.length > 0 && (
          <div className="mt-2 space-y-2">
            {approvalRows.map((row, idx) => (
              <ApprovalRequestRow
                key={`${row.callId ?? 'approval'}-${idx}`}
                callId={row.callId}
                text={row.text}
                supported={row.supported}
              />
            ))}
          </div>
        )}

        {message.reply_count > 0 && onOpenThread && (
          <button
            onClick={() => onOpenThread(message.id)}
            className="mt-1 inline-flex items-center gap-1.5 px-2 py-1 bg-accent-cyan border-2 border-black rounded text-xs font-medium hover:bg-accent-teal"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {message.reply_count} {message.reply_count === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>
    </div>
  );
}

function AgentActivityPanel({ rows, isStreaming }: { rows: ActivityRow[]; isStreaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const last = rows[rows.length - 1];
  const thinking = rows
    .filter((r) => r.kind === 'thinking')
    .map((r) => r.text)
    .join('');
  const toolCount = rows.filter((r) => r.kind === 'tool').length;
  const hasApproval = rows.some((r) => r.kind === 'approval');
  const hasThinking = thinking.trim().length > 0;
  const statusLabel = hasApproval ? 'Approval required' : isStreaming ? 'Thinking' : 'Execution';
  const summary = hasApproval
    ? 'Review and choose an action'
    : isStreaming
      ? hasThinking
        ? previewThinkingTail(thinking)
        : 'Preparing response'
      : (last?.text ?? 'Completed');

  return (
    <div
      className={cn(
        'my-1.5 border-2 border-black rounded text-xs',
        hasApproval ? 'bg-accent-orange/30' : 'bg-[#eef8ff]',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'w-full min-h-8 px-2 py-1 flex items-center gap-2 text-left font-mono',
          hasApproval ? 'hover:bg-accent-orange/40' : 'hover:bg-accent-cyan',
        )}
        aria-expanded={expanded}
      >
        <span className="w-4 text-center">{expanded ? '▾' : '▸'}</span>
        <span className="font-bold">{statusLabel}</span>
        <span className="text-text-secondary truncate">
          {summary}
          {toolCount > 0 ? ` · ${toolCount} tool event${toolCount === 1 ? '' : 's'}` : ''}
        </span>
      </button>
      {expanded && (
        <div className="border-t-2 border-black bg-white/70">
          {hasThinking && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-black">
              {thinking}
            </pre>
          )}
          <div className="divide-y-2 divide-black/10">
            {rows
              .filter((r) => r.kind !== 'thinking' && r.kind !== 'approval')
              .map((row, idx) => (
                <div
                  key={`${row.kind}-${idx}`}
                  className="px-3 py-1.5 flex gap-2 font-mono text-[11px]"
                >
                  <span className={cn('shrink-0 font-bold', rowTone(row.kind))}>{row.label}</span>
                  <span className="min-w-0 break-words">{row.text}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function previewThinkingTail(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return 'Working through the problem';
  return compact.length > 120 ? `...${compact.slice(-120)}` : compact;
}

type ActivityRow = {
  kind: 'run' | 'session' | 'thinking' | 'text' | 'tool' | 'approval' | 'error';
  label: string;
  text: string;
  callId?: string;
  supported?: boolean;
};

function compactActivityEvents(events: AgentActivityPayload[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'run.status':
        rows.push({
          kind: 'run',
          label: event.status,
          text: event.detail ?? event.status,
        });
        break;
      case 'session.started':
        rows.push({ kind: 'session', label: 'session', text: event.session_id });
        break;
      case 'session.completed':
        rows.push({
          kind: 'session',
          label: 'done',
          text: event.duration_ms ? `${Math.round(event.duration_ms / 1000)}s` : 'completed',
        });
        break;
      case 'thinking.delta': {
        const prev = rows[rows.length - 1];
        if (prev?.kind === 'thinking') prev.text += event.text;
        else rows.push({ kind: 'thinking', label: 'thinking', text: event.text });
        break;
      }
      case 'thinking.completed':
        rows.push({ kind: 'thinking', label: 'thinking', text: '\n' });
        break;
      case 'text.delta':
        rows.push({ kind: 'text', label: 'text', text: event.text.slice(0, 180) });
        break;
      case 'text.completed':
        rows.push({ kind: 'text', label: 'text', text: 'response completed' });
        break;
      case 'tool.started':
        rows.push({
          kind: 'tool',
          label: 'tool',
          text: `${event.tool}: ${event.summary || formatArgs(event.args)}`,
        });
        break;
      case 'tool.completed':
        rows.push({
          kind: 'tool',
          label: event.success ? 'ok' : 'fail',
          text: `${event.tool}${event.exit_code !== undefined ? ` exit=${event.exit_code}` : ''}${event.duration_ms ? ` · ${event.duration_ms}ms` : ''}`,
        });
        break;
      case 'approval.required':
        rows.push({
          kind: 'approval',
          label: 'approval',
          text: [
            event.title,
            event.command,
            event.detail,
            event.reason,
            event.policyAmendment ? `Policy amendment:\n${event.policyAmendment}` : undefined,
          ]
            .filter(Boolean)
            .join('\n'),
          callId: event.call_id,
          supported: event.supported,
        });
        break;
      case 'error':
        rows.push({ kind: 'error', label: 'error', text: event.message });
        break;
      default:
        break;
    }
  }
  return rows.slice(-80);
}

function compactApprovalRows(rows: ActivityRow[]): ActivityRow[] {
  const approvals = rows.filter((row) => row.kind === 'approval');
  const seen = new Set<string>();
  const result: ActivityRow[] = [];

  for (let i = approvals.length - 1; i >= 0; i -= 1) {
    const row = approvals[i]!;
    const key = row.callId ?? `${row.text}-${i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.unshift(row);
  }

  return result;
}

function formatArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args).slice(0, 160);
  } catch {
    return '';
  }
}

function rowTone(kind: ActivityRow['kind']): string {
  if (kind === 'error') return 'text-accent-red';
  if (kind === 'approval') return 'text-accent-orange';
  if (kind === 'tool') return 'text-accent-purple';
  if (kind === 'run') return 'text-accent-teal';
  if (kind === 'session') return 'text-text-secondary';
  return 'text-black';
}

function ApprovalRequestRow({
  callId,
  text,
  supported,
}: {
  callId?: string;
  text: string;
  supported?: boolean;
}) {
  const [pendingDecision, setPendingDecision] = useState<
    Extract<
      AgentApprovalDecision,
      'approve' | 'approve_for_session' | 'approve_with_policy' | 'reject'
    > | null
  >(null);
  const resolved = useApprovalsStore((s) => (callId ? s.resolvedById.get(callId) : undefined));
  const markResolved = useApprovalsStore((s) => s.markResolved);
  const [error, setError] = useState<string | null>(null);
  const [title, ...details] = text.split('\n').filter(Boolean);
  const canDecide = supported !== false && !!callId && !resolved;

  const canApproveWithPolicy = text.includes('Policy amendment:');

  const decide = async (
    decision: Extract<
      AgentApprovalDecision,
      'approve' | 'approve_for_session' | 'approve_with_policy' | 'reject'
    >,
  ) => {
    if (!callId) return;
    setPendingDecision(decision);
    setError(null);
    try {
      await decideAgentApproval(callId, decision);
      markResolved(callId, resolutionForDecision(decision));
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('already resolved')) {
        markResolved(callId, 'resolved');
      } else {
        setError(message);
      }
    } finally {
      setPendingDecision(null);
    }
  };

  return (
    <div className="w-full min-w-0 rounded border-2 border-black bg-accent-yellow p-2">
      <div className="font-bold text-black">{title || 'Approval requested'}</div>
      {details.length > 0 && (
        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[10px] text-black/75">
          {details.join('\n')}
        </pre>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canDecide || pendingDecision !== null}
          onClick={() => void decide('approve')}
          title={
            supported === false
              ? 'Codex exec mode cannot receive approval decisions yet'
              : 'Allow this Codex action'
          }
          className={cn(
            'px-2 py-1 border-2 border-black rounded bg-bg-card text-[10px] font-bold',
            canDecide && pendingDecision === null
              ? 'hover:bg-accent-green'
              : 'opacity-60 cursor-not-allowed',
          )}
        >
          {pendingDecision === 'approve' ? 'Approving...' : 'Approve'}
        </button>
        <button
          type="button"
          disabled={!canDecide || pendingDecision !== null}
          onClick={() => void decide('approve_for_session')}
          title={
            supported === false
              ? 'Codex exec mode cannot receive approval decisions yet'
              : 'Allow similar Codex requests for this session'
          }
          className={cn(
            'px-2 py-1 border-2 border-black rounded bg-bg-card text-[10px] font-bold',
            canDecide && pendingDecision === null
              ? 'hover:bg-accent-green'
              : 'opacity-60 cursor-not-allowed',
          )}
        >
          {pendingDecision === 'approve_for_session' ? 'Allowing...' : 'Allow for session'}
        </button>
        {canApproveWithPolicy && (
          <button
            type="button"
            disabled={!canDecide || pendingDecision !== null}
            onClick={() => void decide('approve_with_policy')}
            title={
              supported === false
                ? 'Codex exec mode cannot receive approval decisions yet'
                : 'Allow similar Codex requests persistently by adding the proposed policy rule'
            }
            className={cn(
              'px-2 py-1 border-2 border-black rounded bg-bg-card text-[10px] font-bold',
              canDecide && pendingDecision === null
                ? 'hover:bg-accent-green'
                : 'opacity-60 cursor-not-allowed',
            )}
          >
            {pendingDecision === 'approve_with_policy' ? 'Allowing...' : 'Allow always'}
          </button>
        )}
        <button
          type="button"
          disabled={!canDecide || pendingDecision !== null}
          onClick={() => void decide('reject')}
          title={
            supported === false
              ? 'Codex exec mode cannot receive approval decisions yet'
              : 'Reject this Codex action'
          }
          className={cn(
            'px-2 py-1 border-2 border-black rounded bg-bg-card text-[10px] font-bold',
            canDecide && pendingDecision === null
              ? 'hover:bg-accent-red'
              : 'opacity-60 cursor-not-allowed',
          )}
        >
          {pendingDecision === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
        {supported === false && (
          <span className="text-[10px] font-mono text-black/70">
            Codex exec cannot accept this decision yet.
          </span>
        )}
      </div>
      {error && <div className="mt-1 text-[10px] font-mono text-accent-red">{error}</div>}
    </div>
  );
}

function resolutionForDecision(decision: AgentApprovalDecision): ApprovalResolution {
  if (decision === 'approve') return 'approved';
  if (decision === 'approve_for_session') return 'approved_for_session';
  if (decision === 'approve_with_policy') return 'approved_with_policy';
  return 'rejected';
}

function SystemMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex items-start gap-3 py-0.5 text-xs text-text-secondary">
      <span className="font-mono pt-0.5 tabular-nums">{formatTime(message.created_at)}</span>
      <span
        className={cn(
          'flex-1 whitespace-pre-wrap font-mono leading-relaxed',
          message.content.startsWith('⚠') && 'text-accent-red',
        )}
      >
        {message.content}
      </span>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
