/**
 * 频道内 Tasks 面板
 * 参考: docs/ui-reference/screenshots/12-channel-tasks-desktop.png
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Agent, Task, TaskStatus } from '@openspace/shared';
import { TASK_STATES } from '@openspace/shared';
import { cn } from '../lib/cn';
import { createTask, deleteTask, listTasks, suggestAgentsForKeyword, updateTask } from '../lib/api';
import { useChannelsStore } from '../stores/channels';
import { Dialog } from './Dialog';

interface Props {
  channelId: string;
  agents: Agent[];
}

type FilterKey = 'all' | TaskStatus;

const STATUS_BADGE: Record<TaskStatus, { label: string; bg: string }> = {
  todo: { label: 'TODO', bg: 'bg-accent-orange' },
  in_progress: { label: 'IN PROGRESS', bg: 'bg-accent-cyan' },
  in_review: { label: 'IN REVIEW', bg: 'bg-accent-purple' },
  done: { label: 'DONE', bg: 'bg-[#b8e98c]' },
};

export function TasksPanel({ channelId, agents }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [params, setParams] = useSearchParams();
  const highlightTaskId = params.get('task');

  // 如果 URL ?task=N，滚动到对应 task
  useEffect(() => {
    if (!highlightTaskId) return;
    const el = document.getElementById(`task-row-${highlightTaskId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 3 秒后清掉 highlight
      const t = setTimeout(() => {
        const next = new URLSearchParams(params);
        next.delete('task');
        setParams(next, { replace: true });
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [highlightTaskId, tasks, params, setParams]);

  const load = async () => {
    const list = await listTasks({ channel_id: channelId });
    setTasks(list);
  };

  useEffect(() => {
    void load();
    // 简单轮询：MVP 先用 3s 间隔；最好是 WS task_update 驱动（后端已广播）
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [channelId]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: tasks.length,
      todo: 0,
      in_progress: 0,
      in_review: 0,
      done: 0,
    };
    for (const t of tasks) c[t.status] += 1;
    return c;
  }, [tasks]);

  const filtered = useMemo(() => {
    if (filter === 'all') return tasks.filter((t) => t.status !== 'done');
    return tasks.filter((t) => t.status === filter);
  }, [tasks, filter]);

  const doneTasks = useMemo(() => tasks.filter((t) => t.status === 'done'), [tasks]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
      <div className="flex items-center gap-2 px-4 py-3 border-b-2 border-black bg-bg-card">
        <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
          All <span className="font-mono text-xs">{counts.all}</span>
        </FilterButton>
        <FilterButton active={filter === 'todo'} onClick={() => setFilter('todo')}>
          Todo {counts.todo > 0 && <span className="font-mono text-xs">{counts.todo}</span>}
        </FilterButton>
        <FilterButton active={filter === 'in_progress'} onClick={() => setFilter('in_progress')}>
          In Progress {counts.in_progress > 0 && <span className="font-mono text-xs">{counts.in_progress}</span>}
        </FilterButton>
        <FilterButton active={filter === 'in_review'} onClick={() => setFilter('in_review')}>
          In Review {counts.in_review > 0 && <span className="font-mono text-xs">{counts.in_review}</span>}
        </FilterButton>
        <FilterButton active={filter === 'done'} onClick={() => setFilter('done')}>
          Done {counts.done > 0 && <span className="font-mono text-xs">{counts.done}</span>}
        </FilterButton>
        <div className="flex-1" />
        <button
          onClick={() => setNewTaskOpen(true)}
          className="flex items-center gap-1 px-3 py-1.5 border-2 border-black rounded bg-accent-pink font-bold text-sm hover:brightness-105"
        >
          + New Task
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {filtered.length === 0 && filter !== 'done' && (
          <div className="text-text-secondary font-mono text-sm py-4">
            No {filter === 'all' ? 'active' : filter.replace('_', ' ')} tasks.
          </div>
        )}

        {filtered.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            agents={agents}
            highlighted={String(t.id) === highlightTaskId}
            onChange={load}
            onEdit={() => setEditingTask(t)}
          />
        ))}

        {filter === 'all' && doneTasks.length > 0 && (
          <div className="pt-3">
            <details>
              <summary className="cursor-pointer text-sm text-text-secondary font-mono">
                ▶ {doneTasks.length} done
              </summary>
              <div className="mt-2 space-y-2">
                {doneTasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    agents={agents}
                    highlighted={String(t.id) === highlightTaskId}
                    onChange={load}
                    onEdit={() => setEditingTask(t)}
                  />
                ))}
              </div>
            </details>
          </div>
        )}
      </div>

      <NewTaskDialog
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        channelId={channelId}
        agents={agents}
        onCreated={(t) => setTasks((prev) => [...prev, t])}
      />

      {editingTask && (
        <EditTaskDialog
          task={editingTask}
          agents={agents}
          onClose={() => setEditingTask(null)}
          onUpdated={() => {
            setEditingTask(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  agents,
  highlighted,
  onChange,
  onEdit,
}: {
  task: Task;
  agents: Agent[];
  highlighted?: boolean;
  onChange: () => void;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const assignee = agents.find((a) => a.id === task.assignee_agent_id);

  const cycleStatus = async () => {
    if (busy) return;
    const order: TaskStatus[] = [...TASK_STATES];
    const idx = order.indexOf(task.status);
    const next = order[(idx + 1) % order.length]!;
    setBusy(true);
    try {
      await updateTask(task.id, { status: next });
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    if (!confirm(`Delete task #${task.id}?`)) return;
    setBusy(true);
    try {
      await deleteTask(task.id);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const badge = STATUS_BADGE[task.status];

  return (
    <div
      id={`task-row-${task.id}`}
      className={cn(
        'flex items-center gap-2 p-2 border-2 border-black rounded bg-bg-card transition-all',
        highlighted && 'ring-4 ring-accent-pink ring-offset-2',
      )}
    >
      <span className="font-mono text-sm text-text-secondary">#{task.id}</span>
      <button
        onClick={() => void cycleStatus()}
        disabled={busy}
        className={cn(
          'px-2 py-0.5 border-2 border-black rounded font-mono text-[10px] font-bold',
          badge.bg,
          busy && 'opacity-50',
        )}
        title="Click to cycle status"
      >
        {badge.label}
      </button>
      <button
        onClick={onEdit}
        className="flex-1 min-w-0 truncate text-sm text-left hover:underline"
        title="Edit task"
      >
        {task.title}
      </button>
      {assignee && (
        <span className="font-mono text-xs text-text-secondary">@{assignee.name}</span>
      )}
      <button
        onClick={onEdit}
        className="w-6 h-6 flex items-center justify-center border-2 border-black rounded hover:bg-accent-yellow"
        title="Edit task"
        aria-label="Edit task"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </button>
      <button
        onClick={() => void remove()}
        disabled={busy}
        className="w-6 h-6 flex items-center justify-center border-2 border-black rounded hover:bg-accent-red"
        title="Delete task"
        aria-label="Delete task"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
        </svg>
      </button>
    </div>
  );
}

function EditTaskDialog({
  task,
  agents,
  onClose,
  onUpdated,
}: {
  task: Task;
  agents: Agent[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [assignee, setAssignee] = useState<string>(task.assignee_agent_id ?? '');
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await updateTask(task.id, {
        title: title.trim(),
        assignee_agent_id: assignee || null,
        status,
      });
      onUpdated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={`EDIT TASK #${task.id}`} onClose={onClose} maxWidth={440}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="p-5 space-y-4"
      >
        <div>
          <label className="section-header block mb-1.5">TITLE</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card focus:outline-none focus:ring-2 focus:ring-accent-pink"
            autoFocus
          />
        </div>
        <div>
          <label className="section-header block mb-1.5">STATUS</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card"
          >
            {TASK_STATES.map((s) => (
              <option key={s} value={s}>
                {STATUS_BADGE[s].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="section-header block mb-1.5">ASSIGNEE</label>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card"
          >
            <option value="">None</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t-2 border-black/10 -mx-5 px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border-2 border-black rounded bg-bg-card font-bold hover:bg-accent-yellow disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || busy}
            className={cn(
              'px-4 py-2 border-2 border-black rounded font-bold',
              !title.trim() || busy
                ? 'bg-[#f5bfd2] opacity-60 cursor-not-allowed'
                : 'bg-accent-pink hover:brightness-105',
            )}
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function FilterButton({
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
        'inline-flex items-center gap-1.5 px-3 py-1 border-2 border-black rounded text-sm',
        active ? 'bg-accent-yellow font-bold' : 'bg-bg-card hover:bg-accent-yellow',
      )}
    >
      {children}
    </button>
  );
}

function NewTaskDialog({
  open,
  onClose,
  channelId,
  agents,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  channelId: string;
  agents: Agent[];
  onCreated: (t: Task) => void;
}) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<string>('');
  const [busy, setBusy] = useState(false);
  // Sprint 6 CP5：基于 title 关键词推荐 assignee
  const [suggestions, setSuggestions] = useState<
    Array<{ agent_id: string; total_count: number; matched_keys: string[] }>
  >([]);
  const channels = useChannelsStore((s) => s.channels);
  const projectId = channels.find((c) => c.id === channelId)?.project_id ?? null;

  useEffect(() => {
    if (!projectId) return;
    const t = title.trim();
    if (t.length < 3) {
      setSuggestions([]);
      return;
    }
    // 取标题里第一个长度 ≥ 3 的关键词（简单版）
    const keyword = t.split(/[\s/]+/).find((s) => s.length >= 3) ?? '';
    if (!keyword) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void suggestAgentsForKeyword(projectId, keyword)
        .then((rows) => {
          if (!cancelled) setSuggestions(rows);
        })
        .catch(() => setSuggestions([]));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [title, projectId]);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const task = await createTask({
        channel_id: channelId,
        title: title.trim(),
        assignee_agent_id: assignee || null,
      });
      onCreated(task);
      setTitle('');
      setAssignee('');
      setSuggestions([]);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="NEW TASK" onClose={onClose} maxWidth={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="p-5 space-y-4"
      >
        <div>
          <label className="section-header block mb-1.5">TITLE *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Review PR #42"
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card focus:outline-none focus:ring-2 focus:ring-accent-pink"
            autoFocus
          />
        </div>
        <div>
          <label className="section-header block mb-1.5">ASSIGNEE (optional)</label>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card"
          >
            <option value="">None</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.name}
              </option>
            ))}
          </select>
          {suggestions.length > 0 && (
            <div className="mt-2 text-[11px] font-mono text-text-secondary">
              <span>Suggested by Skill Matrix: </span>
              {suggestions.slice(0, 3).map((s, i) => {
                const agent = agents.find((a) => a.id === s.agent_id);
                if (!agent) return null;
                return (
                  <button
                    key={s.agent_id}
                    type="button"
                    onClick={() => setAssignee(s.agent_id)}
                    title={`matched: ${s.matched_keys.join(', ')} · count ${s.total_count}`}
                    className="ml-1 px-1.5 py-0.5 border-2 border-black rounded bg-accent-yellow hover:brightness-105"
                  >
                    @{agent.name} ({s.total_count})
                    {i < Math.min(2, suggestions.length - 1) ? ' ' : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t-2 border-black/10 -mx-5 px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border-2 border-black rounded bg-bg-card font-bold hover:bg-accent-yellow disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || busy}
            className={cn(
              'px-4 py-2 border-2 border-black rounded font-bold',
              !title.trim() || busy
                ? 'bg-[#f5bfd2] opacity-60 cursor-not-allowed'
                : 'bg-accent-pink',
            )}
          >
            {busy ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
