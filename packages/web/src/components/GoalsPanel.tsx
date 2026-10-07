import { useEffect, useState } from 'react';
import type { Agent, Goal, GoalAction } from '@openspace/shared';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { wsClient } from '../lib/ws';
import { listGoals, createGoal, goalAction, getGoal, type GoalDetails } from '../lib/api';
const labels: Record<Goal['status'], string> = {
  queued: '排队中',
  running: '执行中',
  verifying: '验证中',
  awaiting_input: '等待补充',
  awaiting_approval: '等待审批',
  pausing: '正在暂停',
  paused: '已暂停',
  cancelling: '正在取消',
  completed: '已完成 · Agent 已验证',
  cancelled: '已取消',
  failed: '执行失败',
};
export function GoalsPanel({
  projectId,
  channelId,
  agents,
  threadId,
}: {
  projectId: string;
  channelId: string;
  agents: Agent[];
  threadId?: string | null;
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [compose, setCompose] = useState(false);
  const [objective, setObjective] = useState('');
  const [agentId, setAgentId] = useState('');
  const [criteria, setCriteria] = useState('');
  const [maxRounds, setMaxRounds] = useState(20);
  const [maxMinutes, setMaxMinutes] = useState(60);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Goal | null>(null);
  const [action, setAction] = useState<GoalAction | null>(null);
  const [content, setContent] = useState('');
  const [history, setHistory] = useState<GoalDetails | null>(null);
  const [, setParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void listGoals(projectId, channelId)
        .then((r) => {
          if (!disposed) {
            setGoals(r.goals);
            setEnabled(r.enabled);
            setCanManage(r.can_manage);
          }
        })
        .catch((e) => {
          if (!disposed) setError(String(e));
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    const off = wsClient.subscribe((e) => {
      if (e.type === 'goal.updated' && e.goal.channel_id === channelId) refresh();
      if (
        e.type === 'goal.compose_required' &&
        e.channel_id === channelId &&
        e.user_id === user?.id &&
        (threadId ? e.thread_id === threadId : !e.thread_id)
      ) {
        setObjective(e.objective);
        setAgentId(e.agent_id ?? '');
        setCompose(true);
      }
    });
    const offStatus = wsClient.onStatus((s) => {
      if (s === 'open') refresh();
    });
    return () => {
      disposed = true;
      window.clearInterval(timer);
      off();
      offStatus();
    };
  }, [projectId, channelId, user?.id, threadId]);
  const visible = threadId ? goals.filter((g) => g.thread_root_id === threadId) : goals;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      const r = await listGoals(projectId, channelId);
      setGoals(r.goals);
      setCompose(false);
      setAction(null);
      setSelected(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const current = selected ? (goals.find((g) => g.id === selected.id) ?? selected) : null;
  const allowed = (g: Goal) => canManage || user?.id === g.created_by;
  if (!enabled && !visible.length) return null;
  return (
    <section className="border-b-2 border-black bg-bg-card px-3 py-2 text-sm max-h-[40vh] overflow-auto">
      <div className="flex items-center justify-between">
        <strong>Goals</strong>
        {enabled && (
          <button
            type="button"
            className="underline"
            onClick={() => {
              setObjective('');
              setCriteria('');
              setAgentId(
                agents.filter((a) => a.runtime === 'codex').length === 1
                  ? agents.find((a) => a.runtime === 'codex')!.id
                  : '',
              );
              setCompose(true);
            }}
          >
            新建 Goal
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-accent-red break-words">
          {error}
        </p>
      )}
      {visible.map((g) => (
        <article key={g.id} className="border-2 border-black rounded p-2 mt-2">
          <div className="flex justify-between gap-2">
            <button
              className="font-bold text-left"
              onClick={() => {
                setSelected(g);
                setHistory(null);
              }}
            >
              {g.objective}
            </button>
            <span className="shrink-0">{labels[g.status]}</span>
          </div>
          <p className="text-xs">
            @{agents.find((a) => a.id === g.agent_id)?.name ?? g.agent_id} ·{' '}
            {g.criteria.filter((c) => c.state === 'passed').length}/{g.criteria.length} 验收项 ·{' '}
            {g.rounds_used}/{g.max_rounds} 轮 · {Math.round(g.active_ms / 60000)}/
            {Math.round(g.max_active_ms / 60000)} 分钟
          </p>
          {g.summary && <p className="whitespace-pre-wrap">{g.summary}</p>}
          {g.reason && <p className="text-xs">停止/等待原因：{g.reason}</p>}
          <div className="flex flex-wrap gap-3 mt-1">
            <button
              className="underline"
              onClick={() =>
                setParams((p) => {
                  const n = new URLSearchParams(p);
                  n.set('thread', g.thread_root_id);
                  return n;
                })
              }
            >
              打开线程
            </button>
            {g.reason === 'human_verification' && (
              <button
                className="underline"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    goalAction(projectId, g.id, {
                      action: 'confirm',
                      expected_version: g.version,
                      client_request_id: crypto.randomUUID(),
                    }),
                  )
                }
              >
                确认验收
              </button>
            )}
            {!['completed', 'cancelled', 'pausing', 'cancelling'].includes(g.status) &&
              allowed(g) && (
                <>
                  <button
                    className="underline"
                    onClick={() => {
                      setSelected(g);
                      setAction('update');
                      setContent('');
                    }}
                  >
                    补充要求
                  </button>
                  {['paused', 'failed', 'awaiting_input'].includes(g.status) ? (
                    <button
                      className="underline"
                      onClick={() => {
                        setSelected(g);
                        setAction('resume');
                        setContent('');
                        setMaxRounds(g.max_rounds);
                        setMaxMinutes(g.max_active_ms / 60000);
                      }}
                    >
                      继续
                    </button>
                  ) : (
                    <button
                      className="underline"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          goalAction(projectId, g.id, {
                            action: 'pause',
                            expected_version: g.version,
                            client_request_id: crypto.randomUUID(),
                          }),
                        )
                      }
                    >
                      暂停
                    </button>
                  )}
                  <button
                    className="underline"
                    onClick={() => {
                      setSelected(g);
                      setAction('cancel');
                    }}
                  >
                    取消
                  </button>
                </>
              )}
          </div>
        </article>
      ))}
      {(compose || current) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={compose ? '创建 Goal' : 'Goal 详情'}
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3"
        >
          <div className="bg-bg-card border-2 border-black rounded p-4 w-full max-w-xl max-h-[85vh] overflow-auto space-y-3">
            <div className="flex justify-between">
              <strong>
                {compose
                  ? '创建 Goal'
                  : action === 'update'
                    ? '补充要求'
                    : action === 'resume'
                      ? '继续 Goal'
                      : action === 'cancel'
                        ? '取消 Goal'
                        : 'Goal 详情'}
              </strong>
              <button
                onClick={() => {
                  setCompose(false);
                  setSelected(null);
                  setAction(null);
                }}
              >
                关闭
              </button>
            </div>
            {error && (
              <p role="alert" className="text-accent-red">
                {error}
              </p>
            )}
            {compose ? (
              <>
                <label className="block">
                  目标
                  <textarea
                    className="block w-full border p-2"
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                  />
                </label>
                <label className="block">
                  负责人
                  <select
                    className="block w-full border p-2"
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                  >
                    <option value="">选择 Codex Agent</option>
                    {agents
                      .filter((a) => a.runtime === 'codex')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  验收标准（可选，每行一项）
                  <textarea
                    className="block w-full border p-2"
                    value={criteria}
                    onChange={(e) => setCriteria(e.target.value)}
                  />
                </label>
              </>
            ) : (
              current && (
                <>
                  <p>{current.objective}</p>
                  {action === 'update' || action === 'resume' ? (
                    <label className="block">
                      {action === 'update' ? '补充要求' : '纠正信息（失败后必填）'}
                      <textarea
                        className="block w-full border p-2"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                      />
                    </label>
                  ) : action === 'cancel' ? (
                    <p>取消后停止执行，已产生的修改会保留。</p>
                  ) : (
                    <>
                      <p>Goal ID：{current.id}</p>
                      <p>状态：{labels[current.status]}</p>
                      {current.requirements.map((r, i) => (
                        <p key={i}>
                          补充 {i + 1}：{r}
                        </p>
                      ))}
                      {current.criteria.map((c) => (
                        <div key={c.id} className="border p-2">
                          <strong>
                            {c.state === 'passed' ? '✓' : '○'} {c.text}
                          </strong>
                          {c.evidence.map((e, i) => (
                            <p key={i} className="break-words">
                              {e}
                            </p>
                          ))}
                        </div>
                      ))}
                      <button
                        className="underline"
                        onClick={() =>
                          void getGoal(projectId, current.id)
                            .then(setHistory)
                            .catch((e) => setError(String(e)))
                        }
                      >
                        查看执行记录
                      </button>
                      {history !== null && (
                        <div className="space-y-2">
                          {history.iterations.map((i) => (
                            <div key={i.id} className="border p-2">
                              第 {i.sequence} 轮 ·{' '}
                              {{
                                plan: '规划',
                                execute: '执行',
                                verify: '验证',
                                repair: '报告修复',
                              }[i.kind] ?? i.kind}{' '}
                              · {i.status} · {Math.round(i.active_ms / 1000)} 秒
                              {i.error && <p>{i.error}</p>}
                            </div>
                          ))}
                          {history.events.map((e) => (
                            <p key={e.id} className="text-xs">
                              {new Date(e.created_at).toLocaleString()} · {e.type}
                              {e.actor_id ? ' · 用户操作' : ''}
                            </p>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )
            )}
            {(compose || action === 'resume') && (
              <div className="flex gap-3">
                <label>
                  总轮数
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className="block border w-24"
                    value={maxRounds}
                    onChange={(e) => setMaxRounds(Number(e.target.value))}
                  />
                </label>
                <label>
                  总运行分钟
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    className="block border w-24"
                    value={maxMinutes}
                    onChange={(e) => setMaxMinutes(Number(e.target.value))}
                  />
                </label>
              </div>
            )}
            {compose ? (
              <button
                disabled={busy || !objective.trim() || !agentId}
                className="border-2 border-black px-3 py-1 bg-accent-pink"
                onClick={() =>
                  void run(() =>
                    createGoal(projectId, channelId, {
                      objective,
                      agent_id: agentId,
                      thread_id: threadId ?? undefined,
                      acceptance_criteria: criteria.trim()
                        ? criteria.split('\n').filter((c) => c.trim())
                        : undefined,
                      max_rounds: maxRounds,
                      max_active_ms: maxMinutes * 60000,
                      client_request_id: crypto.randomUUID(),
                    }),
                  )
                }
              >
                创建并开始
              </button>
            ) : action && current ? (
              <button
                disabled={busy || (action === 'update' && !content.trim())}
                className="border-2 border-black px-3 py-1 bg-accent-pink"
                onClick={() =>
                  void run(() =>
                    goalAction(projectId, current.id, {
                      action,
                      content,
                      expected_version: current.version,
                      client_request_id: crypto.randomUUID(),
                      ...(action === 'resume'
                        ? { max_rounds: maxRounds, max_active_ms: maxMinutes * 60000 }
                        : {}),
                    }),
                  )
                }
              >
                提交
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
