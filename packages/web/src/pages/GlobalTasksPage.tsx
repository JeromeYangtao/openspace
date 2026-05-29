/**
 * 全局 Tasks Kanban 看板
 * 参考: docs/ui-reference/screenshots/81-global-tasks.png
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Agent, Channel, Task, TaskStatus } from '@openspace/shared';
import { cn } from '../lib/cn';
import { listTasks } from '../lib/api';
import { useAgentsStore } from '../stores/agents';
import { useChannelsStore } from '../stores/channels';
import { channelPath } from '../lib/routes';

const COLUMNS: { key: TaskStatus; label: string; bg: string }[] = [
  { key: 'todo', label: 'TODO', bg: 'bg-accent-orange' },
  { key: 'in_progress', label: 'IN PROGRESS', bg: 'bg-accent-cyan' },
  { key: 'in_review', label: 'IN REVIEW', bg: 'bg-accent-purple' },
  { key: 'done', label: 'DONE', bg: 'bg-[#b8e98c]' },
];

export function GlobalTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [channelFilter, setChannelFilter] = useState<string>('');
  const channels = useChannelsStore((s) => s.channels);
  const agents = useAgentsStore((s) => s.agents);

  const load = async () => {
    const list = await listTasks({
      ...(channelFilter ? { channel_id: channelFilter } : {}),
    });
    setTasks(list);
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [channelFilter]);

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const channelsById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="border-b-2 border-black bg-bg-card px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 bg-accent-purple border-2 border-black rounded flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="font-bold">Tasks</div>
          <div className="text-xs font-mono text-text-secondary">
            {tasks.length} {channelFilter ? `in #${channelsById.get(channelFilter)?.name}` : 'across all channels'}
          </div>
        </div>
        <div className="flex items-center gap-1 border-2 border-black rounded overflow-hidden">
          <button
            onClick={() => setView('board')}
            className={cn('px-3 py-1 text-xs font-bold font-mono', view === 'board' && 'bg-accent-yellow')}
          >
            Board
          </button>
          <button
            onClick={() => setView('list')}
            className={cn('px-3 py-1 text-xs font-bold font-mono border-l-2 border-black', view === 'list' && 'bg-accent-yellow')}
          >
            List
          </button>
        </div>
      </header>

      <div className="px-4 py-2 border-b-2 border-black bg-bg-main">
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="px-3 py-1 border-2 border-black rounded bg-bg-card text-sm font-mono"
        >
          <option value="">All channels</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              # {c.name}
            </option>
          ))}
        </select>
      </div>

      {view === 'board' ? (
        <BoardView tasks={tasks} agentsById={agentsById} channelsById={channelsById} />
      ) : (
        <ListView tasks={tasks} agentsById={agentsById} channelsById={channelsById} />
      )}
    </div>
  );
}

function BoardView({
  tasks,
  agentsById,
  channelsById,
}: {
  tasks: Task[];
  agentsById: Map<string, Agent>;
  channelsById: Map<string, Channel>;
}) {
  const grouped = useMemo(() => {
    const g: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], in_review: [], done: [] };
    for (const t of tasks) g[t.status].push(t);
    return g;
  }, [tasks]);

  return (
    <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
      <div className="flex gap-3 h-full min-w-max">
        {COLUMNS.map((col) => (
          <div key={col.key} className="w-72 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <span
                className={cn(
                  'inline-block px-2 py-0.5 border-2 border-black rounded font-mono text-[10px] font-bold',
                  col.bg,
                )}
              >
                {col.label}
              </span>
              <span className="font-mono text-sm text-text-secondary">
                {grouped[col.key].length}
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {grouped[col.key].length === 0 && (
                <div className="text-text-muted font-mono text-xs p-2 border-2 border-dashed border-black/30 rounded">
                  No {col.label.toLowerCase()} tasks
                </div>
              )}
              {grouped[col.key].map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  agent={t.assignee_agent_id ? agentsById.get(t.assignee_agent_id) : undefined}
                  channel={channelsById.get(t.channel_id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListView({
  tasks,
  agentsById,
  channelsById,
}: {
  tasks: Task[];
  agentsById: Map<string, Agent>;
  channelsById: Map<string, Channel>;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
      {tasks.length === 0 && (
        <div className="text-text-secondary font-mono text-sm py-8 text-center">
          No tasks yet.
        </div>
      )}
      {tasks.map((t) => {
        const ch = channelsById.get(t.channel_id);
        const a = t.assignee_agent_id ? agentsById.get(t.assignee_agent_id) : undefined;
        const col = COLUMNS.find((c) => c.key === t.status)!;
        return (
          <button
            key={t.id}
            onClick={() => navigate(`${channelPath(t.channel_id)}?chatTab=tasks`)}
            className="w-full flex items-center gap-2 p-2 border-2 border-black rounded bg-bg-card text-left hover:bg-bg-main"
          >
            <span className="font-mono text-xs text-text-secondary">
              {ch ? `#${ch.name}` : '-'}
            </span>
            <span className="font-mono text-sm">#{t.id}</span>
            <span
              className={cn(
                'px-2 py-0.5 border-2 border-black rounded font-mono text-[10px] font-bold',
                col.bg,
              )}
            >
              {col.label}
            </span>
            <span className="flex-1 min-w-0 truncate text-sm">{t.title}</span>
            {a && <span className="font-mono text-xs text-text-secondary">@{a.name}</span>}
          </button>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  agent,
  channel,
}: {
  task: Task;
  agent?: Agent;
  channel?: Channel;
}) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(`${channelPath(task.channel_id)}?chatTab=tasks`)}
      className="w-full text-left border-2 border-black rounded bg-bg-card p-2 hover:bg-bg-main"
    >
      <div className="flex items-center gap-1 text-[10px] font-mono text-text-secondary mb-1">
        {channel && <span className="font-bold">#{channel.name}</span>}
        <span>#{task.id}</span>
      </div>
      <div className="text-xs line-clamp-2 mb-1.5">{task.title}</div>
      {agent && (
        <div className="text-[10px] font-mono text-text-secondary">
          assignee @{agent.name}
        </div>
      )}
    </button>
  );
}
