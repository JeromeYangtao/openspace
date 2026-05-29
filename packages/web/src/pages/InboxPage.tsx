/**
 * Inbox 视图（Sprint 3 CP2）
 *
 * 跨 Project 列出当前等待用户处理的 workflow runs。
 *   - awaiting_approval：用户必须 /approve 或 /reject 才能推进
 *   - running：仅作信息显示（点进去看进度）
 *
 * 路由：/inbox
 * 数据：listActiveWorkflowRuns()
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Channel, Workflow, WorkflowRun } from '@openspace/shared';
import { listActiveWorkflowRuns } from '../lib/api';
import { useProjectsStore } from '../stores/projects';
import { projectChannelPath } from '../lib/routes';
import { cn } from '../lib/cn';

type Tab = 'awaiting' | 'running';
type RunRow = WorkflowRun & { workflow: Workflow | null; channel: Channel | null };

export function InboxPage() {
  const [items, setItems] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('awaiting');
  const projects = useProjectsStore((s) => s.projects);
  const navigate = useNavigate();

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const load = async () => {
    setLoading(true);
    try {
      const list = await listActiveWorkflowRuns();
      setItems(list);
    } catch (e) {
      console.error('inbox load failed', e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, []);

  const filtered = items.filter((r) => r.status === tab);

  const tabCounts = useMemo(() => {
    return {
      awaiting: items.filter((r) => r.status === 'awaiting_approval').length,
      running: items.filter((r) => r.status === 'running').length,
    };
  }, [items]);

  const openRun = (r: RunRow) => {
    if (!r.channel) return;
    const project = r.channel.project_id ? projectsById.get(r.channel.project_id) : null;
    if (!project) return;
    const base = projectChannelPath(project.name, r.channel.id);
    if (r.thread_id) {
      navigate(`${base}?thread=${encodeURIComponent(r.thread_id)}`);
    } else {
      navigate(base);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="border-b-2 border-black bg-bg-card px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 bg-accent-pink border-2 border-black rounded flex items-center justify-center">
          <span className="text-lg">⏸</span>
        </div>
        <div>
          <div className="font-bold">Inbox</div>
          <div className="text-xs font-mono text-text-secondary">
            {tabCounts.awaiting} awaiting · {tabCounts.running} running
          </div>
        </div>
      </header>

      <div className="px-4 py-2 border-b-2 border-black bg-bg-main flex items-center gap-1 text-xs font-bold font-mono">
        <TabButton active={tab === 'awaiting'} onClick={() => setTab('awaiting')}>
          AWAITING APPROVAL ({tabCounts.awaiting})
        </TabButton>
        <TabButton active={tab === 'running'} onClick={() => setTab('running')}>
          RUNNING ({tabCounts.running})
        </TabButton>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && filtered.length === 0 ? (
          <div className="text-text-secondary font-mono text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-text-secondary font-mono text-sm py-8 text-center">
            {tab === 'awaiting'
              ? 'No workflows are waiting for your approval.'
              : 'No workflows are currently running.'}
          </div>
        ) : (
          filtered.map((r) => (
            <InboxRow
              key={r.id}
              run={r}
              project={r.channel?.project_id ? projectsById.get(r.channel.project_id) : undefined}
              onOpen={() => openRun(r)}
            />
          ))
        )}
      </div>
    </div>
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
        'px-3 py-1 border-2 border-black rounded',
        active ? 'bg-accent-yellow' : 'bg-bg-card hover:bg-accent-yellow/50',
      )}
    >
      {children}
    </button>
  );
}

function InboxRow({
  run,
  project,
  onOpen,
}: {
  run: RunRow;
  project?: { name: string; display_name: string | null };
  onOpen: () => void;
}) {
  const proj = project?.display_name ?? project?.name ?? '(unknown project)';
  const channel = run.channel?.name ?? '(unknown channel)';
  const wf = run.workflow?.name ?? '(unknown workflow)';
  const ago = formatAgo(run.started_at);
  const statusBg =
    run.status === 'awaiting_approval' ? 'bg-accent-pink' : 'bg-accent-cyan';
  return (
    <button
      onClick={onOpen}
      className="w-full text-left flex items-start gap-3 p-3 border-2 border-black rounded bg-bg-card hover:bg-bg-main"
    >
      <span
        className={cn(
          'inline-flex items-center justify-center w-8 h-8 border-2 border-black rounded',
          statusBg,
        )}
      >
        {run.status === 'awaiting_approval' ? '⏸' : '⚙'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs font-mono text-text-secondary mb-0.5">
          <span className="font-bold">{proj}</span>
          <span>·</span>
          <span>#{channel}</span>
          <span className="ml-auto">{ago}</span>
        </div>
        <div className="font-medium text-sm truncate">{wf}</div>
        {run.current_step && (
          <div className="text-[11px] font-mono text-text-secondary mt-0.5">
            current step: <code className="bg-accent-yellow px-1 rounded">{run.current_step}</code>
          </div>
        )}
      </div>
    </button>
  );
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}
