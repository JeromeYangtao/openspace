/**
 * Intelligence Tab — 项目知识管理（Sprint 4 CP4 / D-20 Delivery Loop）
 *
 * 路由：/p/:projectName/intelligence
 *
 * 三个子标签：
 *   - PENDING REVIEW：Scribe 自动产出的 decisions / lessons 等待用户审批
 *   - KNOWLEDGE BASE：已 approved 的 lessons，按 kind / audience 过滤
 *   - DECISIONS：已 approved 的 decisions（按时间倒序）
 *
 * 操作：
 *   - Pending：Approve / Reject / Edit / Delete
 *   - Approved：Edit / Delete
 *   - 手动添加：每个 tab 内有 + 按钮
 */

import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import type { Decision, Lesson, LessonKind } from '@openspace/shared';
import {
  createDecision,
  createLesson,
  deleteDecision,
  deleteLesson,
  listProjectDecisions,
  listProjectLessons,
  updateDecision,
  updateLesson,
} from '../lib/api';
import { useProjectsStore } from '../stores/projects';
import { cn } from '../lib/cn';

type Tab = 'pending' | 'knowledge' | 'decisions';

export function IntelligencePage() {
  const { projectName } = useParams<{ projectName: string }>();
  const projects = useProjectsStore((s) => s.projects);
  const project = useMemo(
    () => projects.find((p) => p.name === projectName) ?? null,
    [projects, projectName],
  );

  const [tab, setTab] = useState<Tab>('pending');
  const [pendingDecisions, setPendingDecisions] = useState<Decision[]>([]);
  const [pendingLessons, setPendingLessons] = useState<Lesson[]>([]);
  const [approvedLessons, setApprovedLessons] = useState<Lesson[]>([]);
  const [approvedDecisions, setApprovedDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterKind, setFilterKind] = useState<LessonKind | ''>('');
  const [filterAudience, setFilterAudience] = useState<string>('');
  const [showCreate, setShowCreate] = useState<'decision' | 'lesson' | null>(null);

  const load = async () => {
    if (!project) return;
    setLoading(true);
    try {
      const [pd, pl, ad, al] = await Promise.all([
        listProjectDecisions(project.id, 'pending'),
        listProjectLessons(project.id, { status: 'pending' }),
        listProjectDecisions(project.id, 'approved'),
        listProjectLessons(project.id, {
          status: 'approved',
          kind: filterKind || undefined,
          audience: filterAudience || undefined,
        }),
      ]);
      setPendingDecisions(pd);
      setPendingLessons(pl);
      setApprovedDecisions(ad);
      setApprovedLessons(al);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, filterKind, filterAudience]);

  if (!project) return <Navigate to="/" replace />;

  const onApproveDecision = async (d: Decision) => {
    await updateDecision(d.id, { review_status: 'approved' });
    void load();
  };
  const onRejectDecision = async (d: Decision) => {
    await updateDecision(d.id, { review_status: 'rejected' });
    void load();
  };
  const onDeleteDecision = async (d: Decision) => {
    if (!confirm(`Delete decision "${d.title}"?`)) return;
    await deleteDecision(d.id);
    void load();
  };

  const onApproveLesson = async (l: Lesson) => {
    await updateLesson(l.id, { review_status: 'approved' });
    void load();
  };
  const onRejectLesson = async (l: Lesson) => {
    await updateLesson(l.id, { review_status: 'rejected' });
    void load();
  };
  const onDeleteLesson = async (l: Lesson) => {
    if (!confirm(`Delete lesson "${l.title}"?`)) return;
    await deleteLesson(l.id);
    void load();
  };

  const pendingCount = pendingDecisions.length + pendingLessons.length;

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="border-b-2 border-black bg-bg-card px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 bg-accent-cyan border-2 border-black rounded flex items-center justify-center">
          <span className="text-lg">📚</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold">Intelligence</div>
          <div className="text-xs font-mono text-text-secondary truncate">
            {project.display_name ?? project.name} · {pendingCount} pending review
          </div>
        </div>
      </header>

      <div className="px-4 py-2 border-b-2 border-black bg-bg-main flex items-center gap-1 text-xs font-bold font-mono">
        <TabButton active={tab === 'pending'} onClick={() => setTab('pending')}>
          PENDING ({pendingCount})
        </TabButton>
        <TabButton active={tab === 'knowledge'} onClick={() => setTab('knowledge')}>
          KNOWLEDGE BASE ({approvedLessons.length})
        </TabButton>
        <TabButton active={tab === 'decisions'} onClick={() => setTab('decisions')}>
          DECISIONS ({approvedDecisions.length})
        </TabButton>
      </div>

      {tab === 'knowledge' && (
        <div className="px-4 py-2 border-b-2 border-black bg-bg-main flex items-center gap-2 text-[11px] font-mono">
          <span className="text-text-secondary">Filter:</span>
          <select
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value as LessonKind | '')}
            className="px-2 py-0.5 border-2 border-black rounded bg-bg-card"
          >
            <option value="">all kinds</option>
            <option value="do">do</option>
            <option value="dont">don&apos;t</option>
            <option value="pattern">pattern</option>
            <option value="pitfall">pitfall</option>
          </select>
          <input
            type="text"
            value={filterAudience}
            onChange={(e) => setFilterAudience(e.target.value)}
            placeholder="audience (e.g. all / Architect)"
            className="flex-1 px-2 py-0.5 border-2 border-black rounded bg-bg-card"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && pendingCount === 0 && approvedLessons.length === 0 && approvedDecisions.length === 0 ? (
          <div className="text-text-secondary font-mono text-sm">Loading…</div>
        ) : tab === 'pending' ? (
          <PendingTab
            decisions={pendingDecisions}
            lessons={pendingLessons}
            onApproveDecision={(d) => void onApproveDecision(d)}
            onRejectDecision={(d) => void onRejectDecision(d)}
            onDeleteDecision={(d) => void onDeleteDecision(d)}
            onApproveLesson={(l) => void onApproveLesson(l)}
            onRejectLesson={(l) => void onRejectLesson(l)}
            onDeleteLesson={(l) => void onDeleteLesson(l)}
          />
        ) : tab === 'knowledge' ? (
          <KnowledgeTab
            lessons={approvedLessons}
            onDelete={(l) => void onDeleteLesson(l)}
            onAdd={() => setShowCreate('lesson')}
          />
        ) : (
          <DecisionsTab
            decisions={approvedDecisions}
            onDelete={(d) => void onDeleteDecision(d)}
            onAdd={() => setShowCreate('decision')}
          />
        )}
      </div>

      {showCreate && (
        <CreateDialog
          kind={showCreate}
          projectId={project.id}
          onClose={() => setShowCreate(null)}
          onCreated={() => {
            setShowCreate(null);
            void load();
          }}
        />
      )}
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

// =============================================================================
// Pending tab
// =============================================================================

function PendingTab({
  decisions,
  lessons,
  onApproveDecision,
  onRejectDecision,
  onDeleteDecision,
  onApproveLesson,
  onRejectLesson,
  onDeleteLesson,
}: {
  decisions: Decision[];
  lessons: Lesson[];
  onApproveDecision: (d: Decision) => void;
  onRejectDecision: (d: Decision) => void;
  onDeleteDecision: (d: Decision) => void;
  onApproveLesson: (l: Lesson) => void;
  onRejectLesson: (l: Lesson) => void;
  onDeleteLesson: (l: Lesson) => void;
}) {
  if (decisions.length === 0 && lessons.length === 0) {
    return (
      <div className="text-text-secondary font-mono text-sm py-8 text-center">
        Nothing pending review. Scribe will populate this list after each workflow run.
      </div>
    );
  }
  return (
    <>
      {decisions.length > 0 && (
        <Section title={`PENDING DECISIONS (${decisions.length})`}>
          {decisions.map((d) => (
            <PendingDecisionCard
              key={d.id}
              d={d}
              onApprove={() => onApproveDecision(d)}
              onReject={() => onRejectDecision(d)}
              onDelete={() => onDeleteDecision(d)}
            />
          ))}
        </Section>
      )}
      {lessons.length > 0 && (
        <Section title={`PENDING LESSONS (${lessons.length})`}>
          {lessons.map((l) => (
            <PendingLessonCard
              key={l.id}
              l={l}
              onApprove={() => onApproveLesson(l)}
              onReject={() => onRejectLesson(l)}
              onDelete={() => onDeleteLesson(l)}
            />
          ))}
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="section-header mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function PendingDecisionCard({
  d,
  onApprove,
  onReject,
  onDelete,
}: {
  d: Decision;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="border-2 border-black rounded bg-bg-card p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 border-2 border-black rounded bg-accent-cyan">
          DECISION
        </span>
        <span className="font-bold text-sm flex-1 truncate">{d.title}</span>
        <span className="text-[10px] font-mono text-text-secondary">
          conf {(d.confidence ?? 0).toFixed(2)}
        </span>
      </div>
      <div className="text-[12px] mb-2 whitespace-pre-wrap">{d.body}</div>
      <div className="text-[10px] font-mono text-text-muted mb-2">
        audience: <code className="bg-accent-yellow px-1 rounded">{d.audience}</code> · by{' '}
        {d.recorded_by}
      </div>
      <div className="flex items-center gap-2">
        <ActionButton color="green" onClick={onApprove}>
          ✓ Approve
        </ActionButton>
        <ActionButton color="orange" onClick={onReject}>
          ↩ Reject
        </ActionButton>
        <ActionButton color="red" onClick={onDelete}>
          Delete
        </ActionButton>
      </div>
    </div>
  );
}

function PendingLessonCard({
  l,
  onApprove,
  onReject,
  onDelete,
}: {
  l: Lesson;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="border-2 border-black rounded bg-bg-card p-3">
      <div className="flex items-center gap-2 mb-1">
        <KindBadge kind={l.kind} />
        <span className="font-bold text-sm flex-1 truncate">{l.title}</span>
        <span className="text-[10px] font-mono text-text-secondary">
          conf {(l.confidence ?? 0).toFixed(2)}
        </span>
      </div>
      <div className="text-[12px] mb-2 whitespace-pre-wrap">{l.body}</div>
      <div className="text-[10px] font-mono text-text-muted mb-2 flex items-center gap-2 flex-wrap">
        <span>
          audience: <code className="bg-accent-yellow px-1 rounded">{l.audience}</code>
        </span>
        {l.tags.length > 0 && (
          <span>
            tags: {l.tags.map((t) => (
              <code key={t} className="bg-bg-main px-1 rounded ml-1">
                {t}
              </code>
            ))}
          </span>
        )}
        <span>· by {l.recorded_by}</span>
      </div>
      <div className="flex items-center gap-2">
        <ActionButton color="green" onClick={onApprove}>
          ✓ Approve
        </ActionButton>
        <ActionButton color="orange" onClick={onReject}>
          ↩ Reject
        </ActionButton>
        <ActionButton color="red" onClick={onDelete}>
          Delete
        </ActionButton>
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: LessonKind }) {
  const map: Record<LessonKind, { label: string; bg: string }> = {
    do: { label: 'DO', bg: 'bg-[#b8e98c]' },
    dont: { label: "DON'T", bg: 'bg-accent-red' },
    pattern: { label: 'PATTERN', bg: 'bg-accent-cyan' },
    pitfall: { label: 'PITFALL', bg: 'bg-accent-orange' },
  };
  const { label, bg } = map[kind];
  return (
    <span
      className={cn(
        'text-[10px] font-bold font-mono px-1.5 py-0.5 border-2 border-black rounded',
        bg,
      )}
    >
      {label}
    </span>
  );
}

function ActionButton({
  color,
  onClick,
  children,
}: {
  color: 'green' | 'orange' | 'red' | 'pink';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls =
    color === 'green'
      ? 'bg-[#b8e98c]'
      : color === 'orange'
        ? 'bg-accent-orange/40'
        : color === 'red'
          ? 'bg-bg-card hover:bg-accent-red'
          : 'bg-accent-pink';
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1 border-2 border-black rounded text-xs font-bold',
        cls,
        'hover:brightness-105',
      )}
    >
      {children}
    </button>
  );
}

// =============================================================================
// Knowledge tab
// =============================================================================

function KnowledgeTab({
  lessons,
  onDelete,
  onAdd,
}: {
  lessons: Lesson[];
  onDelete: (l: Lesson) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <div className="flex justify-end">
        <button
          onClick={onAdd}
          className="px-3 py-1 text-xs font-bold border-2 border-black rounded bg-accent-pink hover:brightness-105"
        >
          + New Lesson
        </button>
      </div>
      {lessons.length === 0 ? (
        <div className="text-text-secondary font-mono text-sm py-8 text-center">
          No approved lessons yet. Sediment a workflow run via Scribe or add one manually.
        </div>
      ) : (
        <div className="space-y-2">
          {lessons.map((l) => (
            <div key={l.id} className="border-2 border-black rounded bg-bg-card p-3">
              <div className="flex items-center gap-2 mb-1">
                <KindBadge kind={l.kind} />
                <span className="font-bold text-sm flex-1 truncate">{l.title}</span>
                <span className="text-[10px] font-mono text-text-secondary">
                  used {l.use_count}×
                </span>
              </div>
              <div className="text-[12px] mb-2 whitespace-pre-wrap">{l.body}</div>
              <div className="text-[10px] font-mono text-text-muted flex items-center gap-2 flex-wrap">
                <span>
                  audience: <code className="bg-accent-yellow px-1 rounded">{l.audience}</code>
                </span>
                {l.tags.length > 0 && (
                  <span>
                    tags: {l.tags.map((t) => (
                      <code key={t} className="bg-bg-main px-1 rounded ml-1">
                        {t}
                      </code>
                    ))}
                  </span>
                )}
                <button
                  onClick={() => onDelete(l)}
                  className="ml-auto px-2 py-0.5 border-2 border-black rounded bg-bg-card hover:bg-accent-red"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// =============================================================================
// Decisions tab
// =============================================================================

function DecisionsTab({
  decisions,
  onDelete,
  onAdd,
}: {
  decisions: Decision[];
  onDelete: (d: Decision) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <div className="flex justify-end">
        <button
          onClick={onAdd}
          className="px-3 py-1 text-xs font-bold border-2 border-black rounded bg-accent-pink hover:brightness-105"
        >
          + New Decision
        </button>
      </div>
      {decisions.length === 0 ? (
        <div className="text-text-secondary font-mono text-sm py-8 text-center">
          No approved decisions yet.
        </div>
      ) : (
        <div className="space-y-2">
          {decisions.map((d) => (
            <div key={d.id} className="border-2 border-black rounded bg-bg-card p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 border-2 border-black rounded bg-accent-cyan">
                  DECISION
                </span>
                <span className="font-bold text-sm flex-1 truncate">{d.title}</span>
                <span className="text-[10px] font-mono text-text-secondary">
                  {new Date(d.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="text-[12px] mb-2 whitespace-pre-wrap">{d.body}</div>
              <div className="text-[10px] font-mono text-text-muted flex items-center gap-2">
                <span>
                  audience: <code className="bg-accent-yellow px-1 rounded">{d.audience}</code>
                </span>
                <span>· by {d.recorded_by}</span>
                <button
                  onClick={() => onDelete(d)}
                  className="ml-auto px-2 py-0.5 border-2 border-black rounded bg-bg-card hover:bg-accent-red"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// =============================================================================
// Create dialog
// =============================================================================

function CreateDialog({
  kind,
  projectId,
  onClose,
  onCreated,
}: {
  kind: 'decision' | 'lesson';
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('all');
  const [lessonKind, setLessonKind] = useState<LessonKind>('do');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      if (kind === 'decision') {
        await createDecision(projectId, {
          title: title.trim(),
          body: body.trim(),
          audience: audience.trim() || 'all',
        });
      } else {
        await createLesson(projectId, {
          kind: lessonKind,
          title: title.trim(),
          body: body.trim(),
          audience: audience.trim() || 'all',
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        });
      }
      onCreated();
    } catch (e) {
      alert(`Create failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-bg-card border-2 border-black rounded-xl shadow-[6px_6px_0_0_#000] w-[480px] max-w-[90vw]">
        <header className="border-b-2 border-black bg-accent-yellow px-4 py-2 font-bold">
          NEW {kind.toUpperCase()}
        </header>
        <div className="p-4 space-y-3">
          <input
            type="text"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card text-sm"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Body — describe the decision or lesson"
            rows={4}
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card text-sm resize-none"
          />
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-mono text-text-secondary">audience</label>
            <input
              type="text"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="all / team / Architect"
              className="flex-1 px-2 py-1 border-2 border-black rounded bg-bg-card text-sm font-mono"
            />
          </div>
          {kind === 'lesson' && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-mono text-text-secondary">kind</label>
                <select
                  value={lessonKind}
                  onChange={(e) => setLessonKind(e.target.value as LessonKind)}
                  className="px-2 py-1 border-2 border-black rounded bg-bg-card text-sm font-mono"
                >
                  <option value="do">do</option>
                  <option value="dont">don&apos;t</option>
                  <option value="pattern">pattern</option>
                  <option value="pitfall">pitfall</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-mono text-text-secondary">tags</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="comma,separated,tags"
                  className="flex-1 px-2 py-1 border-2 border-black rounded bg-bg-card text-sm font-mono"
                />
              </div>
            </>
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
            disabled={busy || !title.trim() || !body.trim()}
            className="px-3 py-1 border-2 border-black rounded bg-accent-pink font-bold text-sm hover:brightness-105 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
}
