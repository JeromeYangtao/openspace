/**
 * Workflows 管理页（Sprint 3 CP4）
 *
 * 路由：/p/:projectName/workflows
 *
 * 功能：
 *   - 列出该 Project 内所有 workflows（builtin / user 区分）
 *   - 导出：下载 YAML 文件（GET /api/workflows/:id/export）
 *   - 导入：上传 .yaml 文件（POST /api/projects/:id/workflows/import）
 *   - 删除（仅 source='user'，避免误删 builtin；用户想编辑 builtin 的话仍可走 PATCH）
 *
 * 注：Workflow 的 YAML 编辑器（行内文本编辑）属于 Sprint 4+ 范畴。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import type { Workflow, WorkflowSession } from '@openspace/shared';
import {
  approveWorkflowSession,
  archiveWorkflowSession,
  createWorkflowSession,
  deleteWorkflow,
  exportWorkflowYaml,
  importWorkflowYaml,
  listProjectWorkflows,
  listProjectWorkflowSessions,
  rejectWorkflowSession,
} from '../lib/api';
import { useProjectsStore } from '../stores/projects';
import { useWorkflowsStore } from '../stores/workflows';
import { cn } from '../lib/cn';

export function WorkflowsPage() {
  const { projectName } = useParams<{ projectName: string }>();
  const projects = useProjectsStore((s) => s.projects);
  const project = useMemo(
    () => projects.find((p) => p.name === projectName) ?? null,
    [projects, projectName],
  );
  const upsertWorkflow = useWorkflowsStore((s) => s.upsertWorkflow);
  const fetchProjectWorkflows = useWorkflowsStore((s) => s.fetchProjectWorkflows);

  const [items, setItems] = useState<Workflow[]>([]);
  const [sessions, setSessions] = useState<WorkflowSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [overwriteOnImport, setOverwriteOnImport] = useState(false);
  const [sessionDialog, setSessionDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    if (!project) return;
    setLoading(true);
    try {
      const [list, sessList] = await Promise.all([
        listProjectWorkflows(project.id),
        listProjectWorkflowSessions(project.id),
      ]);
      setItems(list);
      setSessions(sessList);
      for (const wf of list) upsertWorkflow(wf);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // 该 effect 仅依赖 project.id；project 变化时重新加载
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  if (!project) return <Navigate to="/" replace />;

  const onExport = async (wf: Workflow) => {
    setBusyId(wf.id);
    try {
      const { filename, yaml } = await exportWorkflowYaml(wf.id);
      triggerDownload(filename, yaml);
    } catch (e) {
      alert(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (wf: Workflow) => {
    if (wf.source === 'builtin') {
      if (
        !confirm(
          `"${wf.name}" is a builtin template. Deleting it removes it from this project; it will be re-seeded on the next server start. Continue?`,
        )
      ) {
        return;
      }
    } else if (!confirm(`Delete workflow "${wf.name}"? This cannot be undone.`)) {
      return;
    }
    setBusyId(wf.id);
    try {
      await deleteWorkflow(wf.id);
      await load();
      void fetchProjectWorkflows(project.id);
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const onImportClick = () => fileInputRef.current?.click();
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset to allow re-uploading the same file
    if (!file) return;
    setImportStatus('Reading…');
    try {
      const text = await file.text();
      const res = await importWorkflowYaml(project.id, {
        definition_yaml: text,
        overwrite: overwriteOnImport,
      });
      setImportStatus(
        `${res.mode === 'created' ? 'Created' : 'Updated'}: ${res.imported.name} (${res.imported.trigger_command})`,
      );
      await load();
      void fetchProjectWorkflows(project.id);
    } catch (e) {
      setImportStatus(`Failed: ${(e as Error).message}`);
    }
  };

  const builtin = items.filter((w) => w.source === 'builtin');
  const userWfs = items.filter((w) => w.source === 'user');

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="border-b-2 border-black bg-bg-card px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 bg-accent-yellow border-2 border-black rounded flex items-center justify-center">
          <span className="text-lg">⚙</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold">Workflows</div>
          <div className="text-xs font-mono text-text-secondary truncate">
            {project.display_name ?? project.name} · {items.length} total
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSessionDialog(true)}
            className="px-3 py-1.5 text-xs font-bold border-2 border-black rounded bg-accent-cyan hover:brightness-105"
            title="Have the team design a workflow together (Facilitator)"
          >
            ✨ From Team Discussion
          </button>
          <label className="text-[11px] font-mono text-text-secondary flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={overwriteOnImport}
              onChange={(e) => setOverwriteOnImport(e.target.checked)}
              className="w-3.5 h-3.5 border-2 border-black accent-accent-pink"
            />
            overwrite on import
          </label>
          <button
            onClick={onImportClick}
            className="px-3 py-1.5 text-xs font-bold border-2 border-black rounded bg-accent-pink hover:brightness-105"
          >
            Import YAML…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml,application/x-yaml,text/yaml"
            className="hidden"
            onChange={(e) => void onFileChange(e)}
          />
        </div>
      </header>

      {importStatus && (
        <div className="px-4 py-1.5 text-[12px] font-mono bg-accent-yellow border-b-2 border-black">
          {importStatus}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="text-text-secondary font-mono text-sm">Loading…</div>
        ) : (
          <>
            {sessions.some((s) => s.status !== 'archived') && (
              <SessionsSection sessions={sessions} onChanged={() => void load()} />
            )}
            <Section title="BUILTIN" items={builtin} onExport={onExport} onDelete={onDelete} busyId={busyId} />
            <Section title="USER" items={userWfs} onExport={onExport} onDelete={onDelete} busyId={busyId} />
          </>
        )}
      </div>

      {sessionDialog && (
        <FromTeamDiscussionDialog
          projectId={project.id}
          onClose={() => setSessionDialog(false)}
          onCreated={() => {
            setSessionDialog(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// Workflow Design Sessions
// =============================================================================

function SessionsSection({
  sessions,
  onChanged,
}: {
  sessions: WorkflowSession[];
  onChanged: () => void;
}) {
  const visible = sessions.filter((s) => s.status !== 'archived');
  return (
    <div>
      <div className="section-header mb-2">DESIGN SESSIONS ({visible.length})</div>
      <div className="space-y-2">
        {visible.map((s) => (
          <SessionCard key={s.id} session={s} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  onChanged,
}: {
  session: WorkflowSession;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showYaml, setShowYaml] = useState(false);

  const onApprove = async () => {
    setBusy(true);
    try {
      await approveWorkflowSession(session.id);
      onChanged();
    } catch (e) {
      alert(`Approve failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const onReject = async () => {
    if (!confirm('Reject this draft?')) return;
    setBusy(true);
    try {
      await rejectWorkflowSession(session.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const onArchive = async () => {
    setBusy(true);
    try {
      await archiveWorkflowSession(session.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (() => {
    switch (session.status) {
      case 'drafting':
        return { text: 'DRAFTING…', cls: 'bg-accent-yellow animate-pulse' };
      case 'awaiting_approval':
        return { text: 'AWAITING APPROVAL', cls: 'bg-accent-pink' };
      case 'approved':
        return { text: 'APPROVED', cls: 'bg-[#b8e98c]' };
      case 'rejected':
        return { text: 'REJECTED', cls: 'bg-bg-card text-text-secondary' };
      case 'failed':
        return { text: 'FAILED', cls: 'bg-accent-red/40' };
      case 'archived':
        return { text: 'ARCHIVED', cls: 'bg-bg-card text-text-secondary' };
    }
  })();

  return (
    <div className="border-2 border-black rounded bg-bg-card p-3">
      <div className="flex items-center gap-2 mb-1">
        <span
          className={cn(
            'text-[10px] font-bold font-mono px-1.5 py-0.5 border-2 border-black rounded',
            statusBadge.cls,
          )}
        >
          {statusBadge.text}
        </span>
        <span className="font-bold text-sm flex-1 truncate">{session.goal_input}</span>
        <span className="text-[10px] font-mono text-text-secondary">
          #{session.id} · {new Date(session.created_at).toLocaleString()}
        </span>
      </div>
      {session.rationale && (
        <div className="text-[12px] mb-2 whitespace-pre-wrap">{session.rationale}</div>
      )}
      {session.fallback_reason && (
        <div className="text-[11px] font-mono mb-2 p-2 border-2 border-accent-orange rounded bg-accent-yellow/30">
          ⚠ Facilitator could not produce a draft:{' '}
          <code>{session.fallback_reason}</code>
          <div className="mt-1 text-text-secondary">
            Tip: try the Sprint 2 Template flow (Import an existing YAML or write one in the
            Workflows list).
          </div>
        </div>
      )}
      {session.status === 'awaiting_approval' && session.draft_yaml && (
        <>
          <button
            onClick={() => setShowYaml((v) => !v)}
            className="text-[11px] font-mono text-text-secondary hover:underline mb-2"
          >
            {showYaml ? '▾ Hide draft YAML' : '▸ Show draft YAML'}
          </button>
          {showYaml && (
            <pre className="max-h-64 overflow-auto bg-bg-main border-2 border-black/30 rounded p-2 text-[11px] font-mono whitespace-pre-wrap break-words mb-2">
              {session.draft_yaml}
            </pre>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => void onApprove()}
              disabled={busy}
              className="flex-1 px-3 py-1.5 border-2 border-black rounded bg-[#b8e98c] hover:brightness-105 font-bold text-sm disabled:opacity-50"
            >
              ✓ Approve & Save Workflow
            </button>
            <button
              onClick={() => void onReject()}
              disabled={busy}
              className="px-3 py-1.5 border-2 border-black rounded bg-bg-card hover:bg-accent-orange/40 font-bold text-sm disabled:opacity-50"
            >
              ↩ Reject
            </button>
          </div>
        </>
      )}
      {(session.status === 'rejected' || session.status === 'failed' || session.status === 'approved') && (
        <div className="flex justify-end">
          <button
            onClick={() => void onArchive()}
            disabled={busy}
            className="px-2 py-0.5 text-[10px] font-bold font-mono border-2 border-black rounded bg-bg-card hover:bg-accent-red disabled:opacity-50"
          >
            Archive
          </button>
        </div>
      )}
    </div>
  );
}

function FromTeamDiscussionDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!goal.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await createWorkflowSession(projectId, goal.trim());
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-bg-card border-2 border-black rounded-xl shadow-[6px_6px_0_0_#000] w-[480px] max-w-[90vw]">
        <header className="border-b-2 border-black bg-accent-cyan px-4 py-2 font-bold">
          ✨ FROM TEAM DISCUSSION
        </header>
        <div className="p-4 space-y-3">
          <div className="text-[12px] font-mono text-text-secondary">
            Describe what kind of workflow you want this team to design. The Facilitator will
            simulate a round-table among your existing agents and emit a YAML draft for your
            approval.
          </div>
          <textarea
            autoFocus
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder='e.g. "An incident-response workflow: triage the report, propose a fix, ship the patch"'
            rows={4}
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card text-sm resize-none"
          />
          {err && (
            <div className="text-[11px] font-mono text-accent-red">{err}</div>
          )}
        </div>
        <footer className="border-t-2 border-black px-4 py-2 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1 border-2 border-black rounded bg-bg-card font-bold text-sm hover:bg-accent-yellow"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !goal.trim()}
            className="px-3 py-1 border-2 border-black rounded bg-accent-cyan font-bold text-sm hover:brightness-105 disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Start Session'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  onExport,
  onDelete,
  busyId,
}: {
  title: string;
  items: Workflow[];
  onExport: (wf: Workflow) => void;
  onDelete: (wf: Workflow) => void;
  busyId: string | null;
}) {
  return (
    <div>
      <div className="section-header mb-2">{title}</div>
      {items.length === 0 ? (
        <div className="text-text-muted font-mono text-xs p-3 border-2 border-dashed border-black/30 rounded">
          No {title.toLowerCase()} workflows yet.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((wf) => (
            <Row key={wf.id} wf={wf} onExport={onExport} onDelete={onDelete} busy={busyId === wf.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  wf,
  onExport,
  onDelete,
  busy,
}: {
  wf: Workflow;
  onExport: (wf: Workflow) => void;
  onDelete: (wf: Workflow) => void;
  busy: boolean;
}) {
  const stepCount = countSteps(wf.definition_yaml);
  return (
    <div className="flex items-start gap-3 p-3 border-2 border-black rounded bg-bg-card">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-bold text-sm truncate">{wf.name}</span>
          <code className="text-[11px] font-mono bg-accent-yellow px-1 rounded">
            {wf.trigger_command}
          </code>
          <SourceBadge source={wf.source} />
        </div>
        {wf.description && (
          <div className="text-[12px] text-text-secondary truncate">{wf.description}</div>
        )}
        <div className="text-[10px] font-mono text-text-muted mt-0.5">
          {stepCount > 0 ? `${stepCount} step(s)` : 'no steps parsed'} · updated{' '}
          {formatTime(wf.updated_at)}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => void onExport(wf)}
          disabled={busy}
          className="px-2 py-1 text-[11px] font-bold border-2 border-black rounded bg-bg-card hover:bg-accent-yellow disabled:opacity-50"
          title="Download YAML"
        >
          Export
        </button>
        <button
          onClick={() => void onDelete(wf)}
          disabled={busy}
          className="px-2 py-1 text-[11px] font-bold border-2 border-black rounded bg-bg-card hover:bg-accent-red disabled:opacity-50"
          title="Delete"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: Workflow['source'] }) {
  const cls = source === 'builtin' ? 'bg-accent-cyan' : 'bg-[#b8e98c]';
  return (
    <span
      className={cn(
        'px-1.5 py-0.5 text-[9px] font-mono font-bold border-2 border-black rounded',
        cls,
      )}
    >
      {source.toUpperCase()}
    </span>
  );
}

function countSteps(yamlText: string): number {
  // 简易估算：计 "  - id:" 的行数
  const m = yamlText.match(/^\s*-\s+id:\s*[^\s]+/gm);
  return m?.length ?? 0;
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function triggerDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/x-yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
