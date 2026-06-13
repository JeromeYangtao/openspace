/**
 * Agent Profile 右侧面板
 * 参考: docs/ui-reference/screenshots/40-agent-profile-desktop.png + 41-agent-profile-actions.png
 *
 * v1.0 修订：
 *   - 从原版 3 Tab 简化为 2 Tab：PROFILE / ACTIVITY（CP6 / D-8）
 *   - 删除 WORKSPACE Tab（OpenSpace 不再提供 Agent 独立 workspace）
 *   - Sprint 5 CP4：新增 FEEDBACK Tab（Coach 建议 + Apply / Reject / Rollback）
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Agent, AgentActivity, AgentFeedback, AgentStatus, ContextSize, ReasoningEffort } from '@openspace/shared';
import { cn } from '../lib/cn';
import {
  applyAgentFeedback,
  compactAgentSession,
  deleteAgent,
  getAgentActivity,
  getRuntimeModels,
  listAgentFeedback,
  rejectAgentFeedback,
  restartAgent,
  rollbackAgentFeedback,
  runCoachForAgent,
  startAgent,
  stopAgent,
  updateAgent,
} from '../lib/api';
import { useAgentsStore, type AgentContextUsageSnapshot } from '../stores/agents';
import { useChannelsStore } from '../stores/channels';
import { useProjectsStore } from '../stores/projects';
import { dmPath } from '../lib/routes';
import { Avatar } from './Avatar';
import { AgentStatusDot, StatusDot, statusLabel } from './StatusDot';
import { InlineEdit } from './InlineEdit';

interface Props {
  agent: Agent;
}

type TabKey = 'profile' | 'activity' | 'feedback';

export function AgentProfilePanel({ agent }: Props) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = (params.get('agentTab') ?? 'profile') as TabKey;
  const removeFromStore = useAgentsStore((s) => s.remove);

  const setTab = (t: TabKey) => {
    const next = new URLSearchParams(params);
    next.set('agentTab', t);
    setParams(next);
  };

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('profile');
    next.delete('agentTab');
    setParams(next);
  };

  const actionHandlers = {
    start: () => startAgent(agent.id),
    stop: () => stopAgent(agent.id),
    restart: () => restartAgent(agent.id),
    delete: async () => {
      if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
      await deleteAgent(agent.id);
      removeFromStore(agent.id);
      close();
    },
    message: () => navigate(dmPath(agent.id)),
  };

  return (
    <aside className="w-96 border-l-2 border-black bg-bg-main flex flex-col h-full min-w-0">
      <header className="border-b-2 border-black bg-bg-card px-3 py-2 flex items-center gap-2">
        <Avatar name={agent.name} kind="agent" size="sm" />
        <div className="flex-1 min-w-0">
          <div className="font-bold truncate text-sm">{agent.name}</div>
          <div className="text-[11px] font-mono text-text-secondary truncate">
            {agent.description?.split(/[\n。.]/)[0]?.slice(0, 40) ?? ''}
          </div>
        </div>
        <IconButton onClick={actionHandlers.message} title="Message">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </IconButton>
        <IconButton onClick={() => void actionHandlers.start()} title="Start Agent">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </IconButton>
        <IconButton onClick={() => void actionHandlers.restart()} title="Restart / Reset">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </IconButton>
        <IconButton onClick={close} title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </IconButton>
      </header>

      {/* 3 Tab：PROFILE / ACTIVITY / FEEDBACK（Sprint 5 CP4） */}
      <div className="flex border-b-2 border-black">
        <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>
          <ProfileIcon /> PROFILE
        </TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
          <ActivityIcon /> ACTIVITY
        </TabButton>
        <TabButton active={tab === 'feedback'} onClick={() => setTab('feedback')}>
          <FeedbackIcon /> FEEDBACK
        </TabButton>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'profile' && <ProfileTab agent={agent} onDelete={actionHandlers.delete} onStart={actionHandlers.start} onStop={actionHandlers.stop} onRestart={actionHandlers.restart} />}
        {tab === 'activity' && <ActivityTab agent={agent} />}
        {tab === 'feedback' && <FeedbackTab agent={agent} />}
      </div>
    </aside>
  );
}

function FeedbackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

// =============================================================================
// FEEDBACK Tab
// =============================================================================

function FeedbackTab({ agent }: { agent: Agent }) {
  const [items, setItems] = useState<AgentFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachMsg, setCoachMsg] = useState<string | null>(null);
  const upsertAgent = useAgentsStore((s) => s.upsert);

  const load = async () => {
    setLoading(true);
    try {
      const list = await listAgentFeedback(agent.id);
      setItems(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const onApply = async (f: AgentFeedback) => {
    if (!confirm(`Apply this proposal? agents.description will change immediately.`)) return;
    setBusy(f.id);
    try {
      await applyAgentFeedback(f.id);
      // 刷新 agent 全局状态（让 ProfileTab 也看到新 description）
      upsertAgent({ ...agent, description: f.description_after });
      await load();
    } catch (e) {
      alert(`Apply failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onReject = async (f: AgentFeedback) => {
    setBusy(f.id);
    try {
      await rejectAgentFeedback(f.id);
      await load();
    } catch (e) {
      alert(`Reject failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onRollback = async (f: AgentFeedback) => {
    if (!confirm(`Rollback to the description from before this proposal was applied?`)) return;
    setBusy(f.id);
    try {
      await rollbackAgentFeedback(f.id);
      upsertAgent({ ...agent, description: f.description_before });
      await load();
    } catch (e) {
      alert(`Rollback failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onRunCoach = async () => {
    setCoachBusy(true);
    setCoachMsg(null);
    try {
      const res = await runCoachForAgent(agent.id);
      if (res.feedback) {
        setCoachMsg(`New proposal: "${res.feedback.summary}"`);
        await load();
      } else {
        setCoachMsg(
          'No new proposal — Coach saw no recurring negative pattern (or one is already pending).',
        );
      }
    } catch (e) {
      setCoachMsg(`Failed: ${(e as Error).message}`);
    } finally {
      setCoachBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => void onRunCoach()}
          disabled={coachBusy}
          className="px-3 py-1 text-xs font-bold border-2 border-black rounded bg-accent-pink hover:brightness-105 disabled:opacity-50"
        >
          {coachBusy ? 'Running Coach…' : '▶ Run Coach now'}
        </button>
        {coachMsg && (
          <span className="text-[11px] font-mono text-text-secondary truncate">{coachMsg}</span>
        )}
      </div>
      <div className="text-[11px] font-mono text-text-secondary">
        Coach automatically runs every 24h after Evaluator collects observations. You can also run
        it manually here when you want a fresh proposal.
      </div>

      {loading && items.length === 0 ? (
        <div className="text-text-secondary font-mono text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-text-secondary font-mono text-sm py-6 text-center">
          No proposals yet. Once Evaluator records ≥ 3 negative observations of the same tag, Coach
          will produce a description edit suggestion here.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((f) => (
            <FeedbackCard
              key={f.id}
              f={f}
              busy={busy === f.id}
              onApply={() => void onApply(f)}
              onReject={() => void onReject(f)}
              onRollback={() => void onRollback(f)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedbackCard({
  f,
  busy,
  onApply,
  onReject,
  onRollback,
}: {
  f: AgentFeedback;
  busy: boolean;
  onApply: () => void;
  onReject: () => void;
  onRollback: () => void;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const statusLabel = (() => {
    switch (f.status) {
      case 'pending':
        return { text: 'PENDING', cls: 'bg-accent-yellow' };
      case 'applied':
        return { text: 'APPLIED', cls: 'bg-[#b8e98c]' };
      case 'rejected':
        return { text: 'REJECTED', cls: 'bg-bg-card text-text-secondary' };
      case 'rolled_back':
        return { text: 'ROLLED BACK', cls: 'bg-accent-orange/40' };
    }
  })();

  return (
    <div className="border-2 border-black rounded bg-bg-card p-3">
      <div className="flex items-center gap-2 mb-1">
        <span
          className={cn(
            'text-[10px] font-bold font-mono px-1.5 py-0.5 border-2 border-black rounded',
            statusLabel.cls,
          )}
        >
          {statusLabel.text}
        </span>
        <span className="font-bold text-sm flex-1 truncate">{f.summary}</span>
        {f.confidence !== null && (
          <span className="text-[10px] font-mono text-text-secondary">
            conf {f.confidence.toFixed(2)}
          </span>
        )}
      </div>
      <div className="text-[12px] mb-2 whitespace-pre-wrap">{f.rationale}</div>
      <div className="text-[10px] font-mono text-text-muted mb-2">
        period {new Date(f.period_start).toLocaleDateString()} →{' '}
        {new Date(f.period_end).toLocaleDateString()} · created{' '}
        {new Date(f.created_at).toLocaleString()}
      </div>

      <button
        onClick={() => setShowDiff((v) => !v)}
        className="text-[11px] font-mono text-text-secondary hover:underline mb-2"
      >
        {showDiff ? '▾ Hide diff' : '▸ Show description diff'}
      </button>
      {showDiff && (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <div className="text-[10px] font-mono uppercase text-text-secondary mb-1">before</div>
            <pre className="max-h-48 overflow-auto bg-bg-main border-2 border-black/30 rounded p-2 text-[11px] font-mono whitespace-pre-wrap break-words">
              {f.description_before || '(empty)'}
            </pre>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase text-text-secondary mb-1">after</div>
            <pre className="max-h-48 overflow-auto bg-bg-main border-2 border-black/30 rounded p-2 text-[11px] font-mono whitespace-pre-wrap break-words">
              {f.description_after}
            </pre>
          </div>
        </div>
      )}

      {f.status === 'pending' && (
        <div className="flex items-center gap-2">
          <button
            onClick={onApply}
            disabled={busy}
            className="flex-1 px-3 py-1.5 border-2 border-black rounded bg-[#b8e98c] hover:brightness-105 font-bold text-sm disabled:opacity-50"
          >
            ✓ Apply
          </button>
          <button
            onClick={onReject}
            disabled={busy}
            className="px-3 py-1.5 border-2 border-black rounded bg-bg-card hover:bg-accent-orange/40 font-bold text-sm disabled:opacity-50"
          >
            ↩ Reject
          </button>
        </div>
      )}
      {f.status === 'applied' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-text-secondary flex-1">
            applied{f.applied_at ? ` ${new Date(f.applied_at).toLocaleString()}` : ''}
          </span>
          <button
            onClick={onRollback}
            disabled={busy}
            className="px-3 py-1 border-2 border-black rounded bg-bg-card hover:bg-accent-orange/40 font-bold text-xs disabled:opacity-50"
          >
            ↶ Rollback
          </button>
        </div>
      )}
    </div>
  );
}

function ProfileTab({
  agent,
  onDelete,
  onStart,
  onStop,
  onRestart,
}: {
  agent: Agent;
  onDelete: () => void | Promise<void>;
  onStart: () => void | Promise<unknown>;
  onStop: () => void | Promise<unknown>;
  onRestart: () => void | Promise<unknown>;
}) {
  const upsertAgent = useAgentsStore((s) => s.upsert);
  // CP8.2：派生 status（任意 channel 活跃 → 该 run 状态；否则用 agent.status）
  const derivedStatus = useAgentsStore((s) => s.getDerivedStatus(agent.id));
  const contextUsage = useAgentsStore((s) => s.getLatestContextUsage(agent.id));

  const saveName = async (v: string) => {
    if (!v) return;
    const updated = await updateAgent(agent.id, { name: v });
    upsertAgent(updated);
  };
  const saveDescription = async (v: string) => {
    const updated = await updateAgent(agent.id, { description: v || null });
    upsertAgent(updated);
  };
  const saveEnvVars = async (v: string) => {
    const parsed = parseEnvVarsText(v);
    const updated = await updateAgent(agent.id, { env_vars: parsed });
    upsertAgent(updated);
  };
  const saveModel = async (v: string) => {
    const updated = await updateAgent(agent.id, { model: v });
    upsertAgent(updated);
  };
  const saveReasoning = async (v: string) => {
    const updated = await updateAgent(agent.id, { reasoning: v as ReasoningEffort });
    upsertAgent(updated);
  };
  const saveThinking = async (v: 'on' | 'off' | 'auto') => {
    const next = v === 'on' ? true : v === 'off' ? false : null;
    const updated = await updateAgent(agent.id, { thinking: next });
    upsertAgent(updated);
  };
  const saveContext = async (v: 'default' | ContextSize) => {
    const next = v === 'default' ? null : v;
    const updated = await updateAgent(agent.id, { context: next });
    upsertAgent(updated);
  };
  // Phase B：MAX Mode 一键 preset = effort=max + thinking=on + context=1m
  const applyMaxMode = async () => {
    const updated = await updateAgent(agent.id, {
      reasoning: 'max',
      thinking: true,
      context: '1m',
    });
    upsertAgent(updated);
  };
  // 关掉 MAX Mode → 回到 model 默认（OpenSpace 不假设具体值，全置 null/medium）
  const clearMaxMode = async () => {
    const updated = await updateAgent(agent.id, {
      reasoning: 'medium',
      thinking: null,
      context: null,
    });
    upsertAgent(updated);
  };
  const isMaxMode =
    agent.reasoning === 'max' && agent.thinking === true && agent.context === '1m';

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-start gap-3">
        <Avatar name={agent.name} kind="agent" size="lg" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-lg">{agent.name}</div>
          <div className="flex items-center gap-2 text-sm">
            <AgentStatusDot agentId={agent.id} size="xs" />
            <span className="font-mono text-text-secondary">{statusLabel(derivedStatus)}</span>
          </div>
          <div className="text-sm font-mono text-text-secondary mt-0.5">@{agent.name}</div>
        </div>
      </div>

      {contextUsage && <ContextUsageMeter agent={agent} usage={contextUsage} />}

      <ProfileField label="DISPLAY NAME">
        <InlineEdit value={agent.name} maxLength={80} onSave={saveName} />
      </ProfileField>

      <ProfileField label="DESCRIPTION">
        <InlineEdit
          value={agent.description ?? ''}
          multiline
          maxLength={3000}
          placeholder="No description"
          onSave={saveDescription}
        />
      </ProfileField>

      <div className="border-t-2 border-black/30 pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="section-header">INFO</div>
          <button
            type="button"
            onClick={() => void (isMaxMode ? clearMaxMode() : applyMaxMode())}
            className={cn(
              'text-[11px] font-mono px-2 py-1 border-2 border-black rounded',
              isMaxMode
                ? 'bg-accent-pink font-bold shadow-[2px_2px_0_0_#000]'
                : 'bg-bg-card hover:bg-accent-yellow',
            )}
            title={isMaxMode ? '关闭 MAX Mode（回到默认 medium / off / default）' : '一键开启 MAX：effort=max + thinking=on + context=1m'}
          >
            {isMaxMode ? '✓ MAX Mode' : '🚀 MAX Mode'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <InfoTag label="Runtime" value={agent.runtime} color="teal" />
          <ModelEditTag
            agentRuntime={agent.runtime}
            value={agent.model ?? ''}
            onSave={saveModel}
          />
          <ReasoningEditTag value={agent.reasoning ?? 'medium'} onSave={saveReasoning} />
          <ThinkingEditTag value={agent.thinking ?? null} onSave={saveThinking} />
          <ContextEditTag value={agent.context ?? null} onSave={saveContext} />
        </div>
        <div className="mt-4">
          <div className="text-xs text-text-secondary font-mono">Born</div>
          <div className="text-sm">{new Date(agent.created_at).toLocaleDateString()}</div>
        </div>
      </div>

      <ProfileField label="ENVIRONMENT VARIABLES">
        <InlineEdit
          value={envVarsToText(agent.env_vars)}
          multiline
          maxLength={5000}
          placeholder="No environment variables configured (one per line: KEY=value)"
          onSave={saveEnvVars}
          renderDisplay={(v) =>
            v ? (
              <div className="space-y-1">
                {v
                  .split('\n')
                  .filter((l) => l.trim())
                  .map((l, i) => {
                    const eq = l.indexOf('=');
                    const k = eq > 0 ? l.slice(0, eq) : l;
                    const val = eq > 0 ? l.slice(eq + 1) : '';
                    return (
                      <div key={i} className="font-mono text-xs">
                        <span className="font-bold">{k}</span>=<span>{val}</span>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <span className="text-text-secondary italic text-sm">
                No environment variables configured
              </span>
            )
          }
        />
      </ProfileField>

      <div className="border-t-2 border-black/30 pt-4">
        <div className="section-header mb-3">ACTIONS</div>
        <div className="space-y-2">
          <ActionButton onClick={() => void onStart()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            Start Agent
          </ActionButton>
          <ActionButton onClick={() => void onStop()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" /></svg>
            Stop Agent
          </ActionButton>
          <ActionButton onClick={() => void onRestart()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Restart / Reset
          </ActionButton>
          <ActionButton onClick={() => {}} variant="pink" disabled title="Coming soon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4M12 17h.01" />
              <circle cx="12" cy="12" r="10" />
            </svg>
            Report Issue
          </ActionButton>
          <ActionButton onClick={() => void onDelete()} variant="red">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Delete Agent
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function ContextUsageMeter({
  agent,
  usage,
}: {
  agent: Agent;
  usage: AgentContextUsageSnapshot;
}) {
  const [compacting, setCompacting] = useState(false);
  const [compactMessage, setCompactMessage] = useState<string | null>(null);
  const total = formatTokenCount(usage.total.total_tokens);
  const last = formatTokenCount(usage.last.total_tokens);
  const window = usage.model_context_window
    ? formatTokenCount(usage.model_context_window)
    : 'unknown';
  const contextPercent =
    typeof usage.context_percent === 'number' && Number.isFinite(usage.context_percent)
      ? usage.context_percent
      : null;
  const canCompact = agent.runtime === 'codex' && !!usage.channelId;

  const onCompact = async () => {
    if (!canCompact || compacting) return;
    setCompacting(true);
    setCompactMessage(null);
    try {
      const result = await compactAgentSession(agent.id, usage.channelId);
      setCompactMessage(`Compacted in ${formatDuration(result.duration_ms)}.`);
    } catch (e) {
      setCompactMessage(`Compact failed: ${(e as Error).message}`);
    } finally {
      setCompacting(false);
    }
  };

  return (
    <div className="border-2 border-black rounded bg-bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="section-header">SESSION TOKENS</div>
        <div className="font-mono text-[10px] text-text-secondary">
          updated {new Date(usage.updatedAt).toLocaleTimeString()}
        </div>
      </div>
      <div className={cn('mt-2 grid gap-2', contextPercent === null ? 'grid-cols-3' : 'grid-cols-4')}>
        {contextPercent !== null && (
          <TokenStat label="Context used" value={formatContextPercent(contextPercent)} />
        )}
        <TokenStat label="Session total" value={total} />
        <TokenStat label="Last turn" value={last} />
        <TokenStat label="Window limit" value={window} />
      </div>
      <div className="mt-2 text-[10px] font-mono leading-snug text-text-secondary">
        Context used is reported by Codex session logs. Session total is cumulative usage.
      </div>
      {canCompact && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void onCompact()}
            disabled={compacting}
            className="w-full px-3 py-1.5 border-2 border-black rounded bg-accent-yellow hover:brightness-105 disabled:opacity-60 font-bold text-xs"
            title="Ask Codex to compact this agent's current channel session"
          >
            {compacting ? 'Compacting...' : 'Compact session'}
          </button>
          {compactMessage && (
            <div className="mt-2 text-[10px] font-mono text-text-secondary leading-snug">
              {compactMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TokenStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-2 border-black/20 rounded bg-bg-main px-2 py-1">
      <div className="text-[10px] font-mono uppercase text-text-secondary truncate">{label}</div>
      <div className="font-mono text-sm font-bold tabular-nums truncate">{value}</div>
    </div>
  );
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}K`;
  }
  return `${tokens}`;
}

function formatContextPercent(value: number): string {
  if (value >= 100) return '100%';
  if (value >= 10) return `${value.toFixed(1)}%`;
  return `${value.toFixed(2)}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ActivityTab({ agent }: { agent: Agent }) {
  const [items, setItems] = useState<AgentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  // CP8.4：channel filter UI
  const [channelFilter, setChannelFilter] = useState<string>('');
  const channels = useChannelsStore((s) => s.channels);
  const projects = useProjectsStore((s) => s.projects);

  // 过滤出该 Agent 所属 Project 的 channels（若 agent.project_id 已知）
  const visibleChannels = (() => {
    if (!agent.project_id) return channels;
    return channels.filter((c) => !c.project_id || c.project_id === agent.project_id);
  })();

  const load = async () => {
    setLoading(true);
    try {
      const list = await getAgentActivity(agent.id, {
        channel_id: channelFilter || undefined,
      });
      setItems(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
    // 依赖 channelFilter 切换时重新拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, channelFilter]);

  const filterBar = (
    <div className="px-4 py-2 border-b-2 border-black bg-bg-card flex items-center gap-2">
      <label className="text-[11px] font-mono uppercase text-text-secondary">Channel:</label>
      <select
        value={channelFilter}
        onChange={(e) => setChannelFilter(e.target.value)}
        className="flex-1 px-2 py-1 border-2 border-black rounded bg-bg-card text-xs font-mono"
      >
        <option value="">All channels</option>
        {visibleChannels.map((c) => (
          <option key={c.id} value={c.id}>
            # {c.name}
            {c.project_id && projects.length > 1
              ? ` (${projects.find((p) => p.id === c.project_id)?.name ?? '-'})`
              : ''}
          </option>
        ))}
      </select>
    </div>
  );

  if (loading && items.length === 0) {
    return (
      <>
        {filterBar}
        <div className="p-4 text-text-secondary font-mono text-sm">Loading...</div>
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        {filterBar}
        <div className="p-8 text-center text-text-secondary font-mono text-sm">
          No activity yet{channelFilter ? ' in this channel' : ''}. Start the agent to see its
          activity log.
        </div>
      </>
    );
  }

  return (
    <>
      {filterBar}
      <div className="p-4 space-y-2">
        {items.map((a) => (
          <div key={a.id} className="flex gap-3 py-1 border-b border-black/10 last:border-0">
            <span className="text-[10px] font-mono text-text-secondary mt-0.5">
              {new Date(a.created_at).toLocaleTimeString()}
            </span>
            <StatusDot status={mapActivityType(a.type)} size="xs" className="mt-1.5" animated={false} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono uppercase text-text-secondary">
                {a.type}
                {!channelFilter && a.channel_id && (
                  <span className="ml-2 normal-case text-text-muted">
                    in #{channels.find((c) => c.id === a.channel_id)?.name ?? a.channel_id.slice(0, 6)}
                  </span>
                )}
              </div>
              <div className="text-xs">{a.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function mapActivityType(t: AgentActivity['type']): AgentStatus {
  if (t === 'thinking') return 'thinking';
  if (t === 'working') return 'working';
  if (t === 'idle') return 'idle';
  if (t === 'error') return 'error';
  return 'idle';
}

// ---------- Building blocks ----------

function ProfileField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="section-header mb-1.5">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function InfoTag({ label, value, color }: { label: string; value: string; color: 'teal' | 'purple' | 'yellow' }) {
  const bg = color === 'teal' ? 'bg-accent-teal' : color === 'purple' ? 'bg-accent-purple' : 'bg-accent-yellow';
  return (
    <div>
      <div className="text-xs text-text-secondary font-mono mb-1">{label}</div>
      <span className={cn('inline-block px-2 py-1 border-2 border-black rounded font-mono text-sm', bg)}>
        {value}
      </span>
    </div>
  );
}

/**
 * Sprint 4-ext：Agent 模型 inline 编辑下拉（点击切换为 select）。
 *
 * options 通过 `/api/runtimes/cursor/models` 拉，懒加载（首次进 edit 模式时拉）。
 * 当前 model 不在 options 列表里也能保留显示，用户切换后被 SDK auto-fallback 兜底。
 */
function ModelEditTag({
  agentRuntime,
  value,
  onSave,
}: {
  agentRuntime: string;
  value: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing || models !== null || loading) return;
    setLoading(true);
    void getRuntimeModels(agentRuntime as 'cursor')
      .then((res) => setModels(res.models ?? []))
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, [editing, models, loading, agentRuntime]);

  const onChange = async (next: string) => {
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    const merged = mergeOptions(models ?? [], value);
    return (
      <div>
        <div className="text-xs text-text-secondary font-mono mb-1">Model</div>
        <select
          autoFocus
          disabled={saving}
          value={value}
          onChange={(e) => void onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          className="px-2 py-1 border-2 border-black rounded font-mono text-sm bg-accent-purple max-w-[14rem]"
        >
          {loading && <option>Loading…</option>}
          {!loading &&
            merged.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
        </select>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="block text-left group"
      title="Click to change model"
    >
      <div className="text-xs text-text-secondary font-mono mb-1 group-hover:text-text-primary">
        Model ✎
      </div>
      <span className="inline-block px-2 py-1 border-2 border-black rounded font-mono text-sm bg-accent-purple group-hover:brightness-105">
        {value || '-'}
      </span>
    </button>
  );
}

function ReasoningEditTag({
  value,
  onSave,
}: {
  value: ReasoningEffort | string;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const options: ReasoningEffort[] = ['low', 'medium', 'high', 'extra-high', 'max'];

  const onChange = async (next: string) => {
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div>
        <div className="text-xs text-text-secondary font-mono mb-1">Reasoning</div>
        <select
          autoFocus
          disabled={saving}
          value={value}
          onChange={(e) => void onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          className="px-2 py-1 border-2 border-black rounded font-mono text-sm bg-accent-yellow"
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="block text-left group"
      title="Click to change reasoning effort"
    >
      <div className="text-xs text-text-secondary font-mono mb-1 group-hover:text-text-primary">
        Reasoning ✎
      </div>
      <span className="inline-block px-2 py-1 border-2 border-black rounded font-mono text-sm bg-accent-yellow group-hover:brightness-105">
        {value || '-'}
      </span>
    </button>
  );
}

function mergeOptions(list: string[], current: string): string[] {
  if (!current) return list;
  return list.includes(current) ? list : [current, ...list];
}

/**
 * Sprint 4-ext / Phase A：Thinking 三态切换。
 * - `auto`（null）= 跟 model 默认
 * - `on` / `off` 显式覆盖
 *
 * SDK 模式下生效；CLI 模式被 cursor-agent 忽略 + 启动期 warn（详见 cursor-adapter.ts）。
 */
function ThinkingEditTag({
  value,
  onSave,
}: {
  value: boolean | null;
  onSave: (v: 'on' | 'off' | 'auto') => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const current: 'on' | 'off' | 'auto' = value === true ? 'on' : value === false ? 'off' : 'auto';
  const display = current === 'on' ? '✓ on' : current === 'off' ? '✗ off' : 'auto';

  const onChange = async (next: 'on' | 'off' | 'auto') => {
    if (next === current) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div>
        <div className="text-xs text-text-secondary font-mono mb-1">Thinking</div>
        <select
          autoFocus
          disabled={saving}
          value={current}
          onChange={(e) => void onChange(e.target.value as 'on' | 'off' | 'auto')}
          onBlur={() => setEditing(false)}
          className="px-2 py-1 border-2 border-black rounded font-mono text-sm bg-accent-teal"
        >
          <option value="auto">auto (model default)</option>
          <option value="on">on</option>
          <option value="off">off</option>
        </select>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="block text-left group"
      title="Click to toggle thinking mode"
    >
      <div className="text-xs text-text-secondary font-mono mb-1 group-hover:text-text-primary">
        Thinking ✎
      </div>
      <span className="inline-block px-2 py-1 border-2 border-black rounded font-mono text-sm bg-accent-teal group-hover:brightness-105">
        {display}
      </span>
    </button>
  );
}

/**
 * Sprint 4-ext / Phase A：Context 大小（300K / 1M / default）。
 *
 * 不同 model 支持的最大 context 不同；用户选了 model 不支持的值时 SDK 会拒绝并触发
 * adapter 内部的 default fallback（详见 cursor-sdk-adapter.ts）。
 */
function ContextEditTag({
  value,
  onSave,
}: {
  value: ContextSize | null;
  onSave: (v: 'default' | ContextSize) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = value ?? 'default';

  const onChange = async (next: 'default' | ContextSize) => {
    if (next === current) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div>
        <div className="text-xs text-text-secondary font-mono mb-1">Context</div>
        <select
          autoFocus
          disabled={saving}
          value={current}
          onChange={(e) => void onChange(e.target.value as 'default' | ContextSize)}
          onBlur={() => setEditing(false)}
          className="px-2 py-1 border-2 border-black rounded font-mono text-sm bg-accent-yellow"
        >
          <option value="default">default (model default)</option>
          <option value="300k">300K</option>
          <option value="1m">1M</option>
        </select>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="block text-left group"
      title="Click to change context window size"
    >
      <div className="text-xs text-text-secondary font-mono mb-1 group-hover:text-text-primary">
        Context ✎
      </div>
      <span className="inline-block px-2 py-1 border-2 border-black rounded font-mono text-sm bg-accent-yellow group-hover:brightness-105">
        {current === 'default' ? 'default' : current.toUpperCase()}
      </span>
    </button>
  );
}

function IconButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="w-7 h-7 flex items-center justify-center border-2 border-black rounded hover:bg-accent-yellow"
    >
      {children}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold font-mono border-r-2 border-black last:border-r-0',
        active ? 'bg-accent-yellow' : 'hover:bg-[#f9efc8]',
      )}
    >
      {children}
    </button>
  );
}

function ActionButton({
  onClick,
  children,
  variant = 'default',
  disabled,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'default' | 'pink' | 'red';
  disabled?: boolean;
  title?: string;
}) {
  const cls =
    variant === 'red'
      ? 'bg-accent-red text-black'
      : variant === 'pink'
        ? 'bg-accent-pink'
        : 'bg-bg-card';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'w-full py-2 px-3 flex items-center justify-center gap-2 border-2 border-black rounded font-medium',
        cls,
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-95',
      )}
    >
      {children}
    </button>
  );
}

// Env vars 文本 <-> 对象
function envVarsToText(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function parseEnvVarsText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    const k = s.slice(0, eq).trim();
    const v = s.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// Icons
function ProfileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function ActivityIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
