/**
 * Project Settings 页（路径 `/p/:projectName/settings`，Sprint 4-ext / Phase C）
 *
 * 单页布局（不分 Tab），section 区分：
 *   - GENERAL：display_name / goal / color 可编辑（PATCH /api/projects）
 *   - WORKSPACE：workspace_path 显示（不可改 — 改会破坏 agent cwd 与既有数据）
 *   - TEAM RULES：team_rules 多行编辑
 *   - TEAM：列出当前 agents（Profile 链接）+ "Build Team from Goal" 按钮触发 BuildTeamDialog
 *   - ONBOARDING：显示已有 onboarding 摘要 + "Re-run Onboarder" 按钮
 *   - DANGER ZONE：Delete Project（级联删 channels / agents / messages / tasks）
 */

import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { Agent, Project, ProjectOnboarding } from '@openspace/shared';
import {
  closeProject,
  deleteProjectStorage,
  getProjectOnboarding,
  listAgents,
  runOnboarder,
  updateProject,
} from '../lib/api';
import { useAgentsStore } from '../stores/agents';
import { useChannelsStore } from '../stores/channels';
import { useProjectsStore } from '../stores/projects';
import { projectAgentProfilePath, projectIndexPath } from '../lib/routes';
import { BuildTeamDialog } from '../components/BuildTeamDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function ProjectSettingsPage() {
  const { projectName } = useParams<{ projectName: string }>();
  const navigate = useNavigate();
  const projects = useProjectsStore((s) => s.projects);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const refreshProjects = useProjectsStore((s) => s.refresh);
  const refreshChannels = useChannelsStore((s) => s.refresh);
  const refreshAgents = useAgentsStore((s) => s.refresh);

  const project = projects.find((p) => p.name === projectName) ?? null;

  // —— 表单 state ——
  const [displayName, setDisplayName] = useState('');
  const [goal, setGoal] = useState('');
  const [teamRules, setTeamRules] = useState('');
  const [color, setColor] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [errorFlash, setErrorFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    setDisplayName(project.display_name ?? '');
    setGoal(project.goal ?? '');
    setTeamRules(project.team_rules ?? '');
    setColor(project.color ?? '');
  }, [project?.id, project?.display_name, project?.goal, project?.team_rules, project?.color]);

  // —— Project Agents ——
  const [projectAgents, setProjectAgents] = useState<Agent[]>([]);
  useEffect(() => {
    if (!project) return;
    void listAgents(project.id).then(setProjectAgents).catch(() => setProjectAgents([]));
  }, [project?.id]);

  // —— Onboarding ——
  const [onboarding, setOnboarding] = useState<ProjectOnboarding | null>(null);
  const [reRunningOnboarder, setReRunningOnboarder] = useState(false);
  useEffect(() => {
    if (!project) return;
    void getProjectOnboarding(project.id)
      .then((res) => {
        // server 在 ready=false 时返回 { project_id, ready: false }
        if (res && 'overview' in res) setOnboarding(res as ProjectOnboarding);
        else setOnboarding(null);
      })
      .catch(() => setOnboarding(null));
  }, [project?.id]);

  // —— Build Team dialog ——
  const [buildTeamOpen, setBuildTeamOpen] = useState(false);

  // —— Close confirm（Q-11：仅从 recent 移除，保留 .openspace/）——
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  // —— Delete .openspace/ confirm（Q-11：rm -rf .openspace/，需输入 project name）——
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!projectsLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
        Loading…
      </div>
    );
  }

  if (!project) {
    return <Navigate to="/" replace />;
  }

  const dirty = isDirty(project, { displayName, goal, teamRules, color });

  const handleSave = async () => {
    setSaving(true);
    setSavedFlash(null);
    setErrorFlash(null);
    try {
      const updated = await updateProject(project.id, {
        display_name: displayName.trim() || null,
        goal: goal.trim(),
        team_rules: teamRules.trim() || null,
        color: color.trim() || null,
      });
      // 重名 + 长度校验由 server 端处理
      void updated;
      await refreshProjects();
      setSavedFlash('已保存。');
    } catch (e) {
      setErrorFlash(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReRunOnboarder = async () => {
    setReRunningOnboarder(true);
    try {
      const res = await runOnboarder(project.id);
      if (res && 'overview' in res) setOnboarding(res as ProjectOnboarding);
    } catch (e) {
      setErrorFlash(`Onboarder 失败：${(e as Error).message}`);
    } finally {
      setReRunningOnboarder(false);
    }
  };

  const handleClose = async () => {
    setClosing(true);
    try {
      await closeProject(project.id);
      await Promise.all([refreshProjects(), refreshChannels(), refreshAgents()]);
      navigate('/', { replace: true });
    } catch (e) {
      setErrorFlash(`关闭失败：${(e as Error).message}`);
      setClosing(false);
      setCloseOpen(false);
    }
  };

  const handleDeleteStorage = async () => {
    if (deleteConfirmName !== project.name) {
      setErrorFlash(`请输入 "${project.name}" 确认删除`);
      return;
    }
    setDeleting(true);
    try {
      await deleteProjectStorage(project.id, deleteConfirmName);
      await Promise.all([refreshProjects(), refreshChannels(), refreshAgents()]);
      navigate('/', { replace: true });
    } catch (e) {
      setErrorFlash(`删除失败：${(e as Error).message}`);
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold">Project Settings</h1>
          <button
            type="button"
            onClick={() => navigate(projectIndexPath(project.name))}
            className="text-xs font-mono text-text-secondary hover:text-text-primary"
          >
            ← Back to project
          </button>
        </div>

        {/* GENERAL */}
        <section className="bg-bg-card border-2 border-black rounded-xl p-6 shadow-[6px_6px_0_0_#000] space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold">General</h2>
            <span className="text-[11px] font-mono text-text-muted">{project.id}</span>
          </div>

          <Field label="Slug (URL)" hint="不可改 — 影响所有路由 / agent cwd 引用关系">
            <code className="block px-3 py-2 border-2 border-black rounded font-mono text-sm bg-bg-main">
              {project.name}
            </code>
          </Field>

          <Field label="Display name">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={project.name}
              className="w-full px-3 py-2 border-2 border-black rounded font-mono text-sm bg-bg-main focus:outline-none focus:bg-white"
            />
          </Field>

          <Field
            label="Goal"
            hint="项目目标，由 ContextBuilder 注入到每次 spawn agent 的 prompt 顶部。设置占位符也能跑，但 Team Architect 推荐质量会差。"
          >
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full px-3 py-2 border-2 border-black rounded font-mono text-sm bg-bg-main focus:outline-none focus:bg-white resize-y"
            />
            <div className="text-[11px] font-mono text-text-muted mt-1 text-right">
              {goal.length} / 500
            </div>
          </Field>

          <Field
            label="Team rules"
            hint="可选 — 协作规则，ContextBuilder 注入到每个 agent 的 prompt 顶部"
          >
            <textarea
              value={teamRules}
              onChange={(e) => setTeamRules(e.target.value)}
              rows={3}
              placeholder="No team-wide rules configured."
              className="w-full px-3 py-2 border-2 border-black rounded font-mono text-sm bg-bg-main focus:outline-none focus:bg-white resize-y"
            />
          </Field>

          <Field label="Color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color || '#FFD93D'}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-10 border-2 border-black rounded cursor-pointer bg-white"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#FFD93D"
                className="px-3 py-2 border-2 border-black rounded font-mono text-sm bg-bg-main focus:outline-none focus:bg-white"
              />
            </div>
          </Field>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!dirty || saving}
              className={`px-5 py-2 border-2 border-black rounded font-bold shadow-[3px_3px_0_0_#000] ${
                dirty && !saving
                  ? 'bg-accent-pink hover:brightness-105'
                  : 'bg-[#f5bfd2] opacity-60 cursor-not-allowed'
              }`}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {savedFlash && (
              <span className="text-sm text-green-700 font-medium">✓ {savedFlash}</span>
            )}
            {errorFlash && (
              <span className="text-sm text-red-700 font-medium">✗ {errorFlash}</span>
            )}
          </div>
        </section>

        {/* WORKSPACE */}
        <section className="bg-bg-card border-2 border-black rounded-xl p-6 shadow-[6px_6px_0_0_#000] space-y-2">
          <h2 className="text-lg font-bold">Workspace</h2>
          <Field label="Path" hint="Project 绑定的代码仓库路径（不可改 — 改会让所有已 spawn agent 的 cwd 失效）">
            <code className="block px-3 py-2 border-2 border-black rounded font-mono text-xs bg-bg-main truncate">
              {project.workspace_path}
            </code>
          </Field>
        </section>

        {/* TEAM */}
        <section className="bg-bg-card border-2 border-black rounded-xl p-6 shadow-[6px_6px_0_0_#000] space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold">Team ({projectAgents.length})</h2>
            <button
              type="button"
              onClick={() => setBuildTeamOpen(true)}
              className="px-3 py-1.5 border-2 border-black rounded bg-accent-yellow hover:brightness-105 text-sm font-bold"
            >
              ✨ Build Team from Goal
            </button>
          </div>
          {projectAgents.length === 0 ? (
            <div className="border-2 border-dashed border-black/30 rounded p-4 text-center text-sm text-text-secondary font-mono">
              No agents yet. Click "Build Team from Goal" to let Team Architect recommend agents
              based on the goal above.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {projectAgents.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between px-3 py-2 border-2 border-black rounded bg-bg-main hover:bg-accent-yellow"
                >
                  <div className="min-w-0 flex-1 mr-3">
                    <div className="font-bold text-sm">{a.name}</div>
                    <div className="text-[11px] font-mono text-text-secondary truncate">
                      {a.model ?? '-'} · {a.reasoning ?? '-'}
                      {a.thinking ? ' · thinking' : ''}
                      {a.context ? ` · ${a.context.toUpperCase()}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(projectAgentProfilePath(project.name, a.id))}
                    className="text-xs font-mono text-text-secondary hover:text-text-primary"
                  >
                    Open Profile →
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ONBOARDING */}
        <section className="bg-bg-card border-2 border-black rounded-xl p-6 shadow-[6px_6px_0_0_#000] space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold">Onboarding</h2>
            <button
              type="button"
              onClick={() => void handleReRunOnboarder()}
              disabled={reRunningOnboarder}
              className="px-3 py-1.5 border-2 border-black rounded bg-bg-main hover:bg-accent-yellow text-sm font-bold disabled:opacity-50"
            >
              {reRunningOnboarder ? 'Running…' : '↻ Re-run Onboarder'}
            </button>
          </div>
          {onboarding ? <OnboardingSummary onb={onboarding} /> : (
            <div className="text-sm text-text-secondary font-mono">
              No onboarding summary yet. Re-run Onboarder to analyze README + git log.
            </div>
          )}
        </section>

        {/* DANGER ZONE — Q-11 双按钮 */}
        <section className="bg-bg-card border-2 border-red-700 rounded-xl p-6 shadow-[6px_6px_0_0_#7f1d1d] space-y-4">
          <h2 className="text-lg font-bold text-red-700">Danger Zone</h2>

          {/* Close project（温和）*/}
          <div className="border-2 border-black/30 rounded p-4 bg-bg-main space-y-2">
            <div className="font-bold text-sm">Close project</div>
            <div className="text-[13px] text-text-secondary">
              仅从 Sidebar 移除（保留 <code className="font-mono text-[12px]">{`{workspace}/.openspace/`}</code>）。
              下次 Open 同一路径会自动恢复全部数据。代码仓库本身不动。
            </div>
            <button
              type="button"
              onClick={() => setCloseOpen(true)}
              className="px-3 py-1.5 border-2 border-black rounded bg-bg-card hover:bg-accent-yellow text-sm font-bold"
            >
              Close this project
            </button>
          </div>

          {/* Delete .openspace/（彻底，需输入项目名校验）*/}
          <div className="border-2 border-red-700 rounded p-4 bg-red-50 space-y-2">
            <div className="font-bold text-sm text-red-700">Delete .openspace/ storage</div>
            <div className="text-[13px] text-red-700/90">
              永久删除 <code className="font-mono text-[12px]">{`{workspace}/.openspace/`}</code> 整个文件夹（含 db /
              project.json / knowledge / observations）。代码仓库本身不动。**此操作不可撤销**。
            </div>
            <button
              type="button"
              onClick={() => {
                setDeleteConfirmName('');
                setDeleteOpen(true);
              }}
              className="px-3 py-1.5 border-2 border-red-700 rounded bg-white text-red-700 hover:bg-red-100 text-sm font-bold"
            >
              Delete .openspace/ folder
            </button>
          </div>
        </section>
      </div>

      <BuildTeamDialog
        open={buildTeamOpen}
        onClose={() => setBuildTeamOpen(false)}
        project={project}
        onCreated={async () => {
          // 重新拉 agents
          if (project) {
            await listAgents(project.id).then(setProjectAgents);
            await refreshAgents();
          }
        }}
      />

      {/* Close confirm */}
      <ConfirmDialog
        open={closeOpen}
        title={`Close project "${project.display_name ?? project.name}"?`}
        description={`仅从 Sidebar recent 移除；保留 ${project.workspace_path}/.openspace/。下次 Open 同一路径会自动恢复。`}
        confirmLabel={closing ? 'Closing…' : 'Close project'}
        onConfirm={() => void handleClose()}
        onClose={() => setCloseOpen(false)}
      />

      {/* Delete .openspace/ confirm — 输入项目名校验 */}
      {deleteOpen ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-bg-card border-2 border-red-700 rounded-xl shadow-[6px_6px_0_0_#7f1d1d] w-full max-w-md">
            <header className="flex items-center justify-between px-5 py-3 border-b-2 border-red-700 bg-red-50">
              <div className="font-bold text-base text-red-700">Delete .openspace/ permanently?</div>
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className="w-7 h-7 flex items-center justify-center border-2 border-red-700 rounded hover:bg-red-100 disabled:opacity-50"
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="p-5 space-y-3">
              <div className="text-sm text-text-primary">
                这将彻底删除：
                <code className="block font-mono text-xs mt-1 px-2 py-1 bg-bg-main border border-black/20 rounded">
                  {project.workspace_path}/.openspace/
                </code>
              </div>
              <div className="text-sm text-red-700">
                包括 db / project.json / knowledge / observations。代码仓库本身不动。
                <strong>此操作不可撤销。</strong>
              </div>
              <label className="block">
                <span className="block text-xs font-bold mb-1">
                  请输入项目名 <code className="font-mono">{project.name}</code> 确认：
                </span>
                <input
                  type="text"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  disabled={deleting}
                  autoFocus
                  className="w-full px-3 py-2 border-2 border-black rounded font-mono text-sm focus:outline-none focus:bg-accent-yellow disabled:opacity-50"
                  placeholder={project.name}
                />
              </label>
            </div>
            <footer className="flex justify-end gap-2 px-5 py-3 border-t-2 border-red-700 bg-red-50">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className="px-3 py-1.5 border-2 border-black rounded bg-bg-card hover:bg-accent-yellow text-sm font-bold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteStorage()}
                disabled={deleting || deleteConfirmName !== project.name}
                className="px-3 py-1.5 border-2 border-red-700 rounded bg-red-700 text-white hover:bg-red-800 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting…' : 'Delete .openspace/ permanently'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs font-bold mb-1.5">{label.toUpperCase()}</div>
      {children}
      {hint && <div className="text-[11px] text-text-muted mt-1">{hint}</div>}
    </label>
  );
}

function OnboardingSummary({ onb }: { onb: ProjectOnboarding }) {
  return (
    <div className="space-y-2 text-sm">
      {onb.overview && (
        <div>
          <div className="text-xs font-bold uppercase text-text-secondary mb-0.5">Overview</div>
          <div className="border-2 border-black rounded p-2 bg-bg-main">{onb.overview}</div>
        </div>
      )}
      {onb.tech_stack && (
        <div>
          <div className="text-xs font-bold uppercase text-text-secondary mb-0.5">Tech stack</div>
          <code className="block border-2 border-black rounded p-2 bg-bg-main font-mono text-xs">
            {onb.tech_stack}
          </code>
        </div>
      )}
      {onb.conventions && (
        <div>
          <div className="text-xs font-bold uppercase text-text-secondary mb-0.5">Conventions</div>
          <div className="border-2 border-black rounded p-2 bg-bg-main">{onb.conventions}</div>
        </div>
      )}
    </div>
  );
}

function isDirty(
  project: Project,
  draft: { displayName: string; goal: string; teamRules: string; color: string },
): boolean {
  return (
    (project.display_name ?? '') !== draft.displayName ||
    (project.goal ?? '') !== draft.goal ||
    (project.team_rules ?? '') !== draft.teamRules ||
    (project.color ?? '') !== draft.color
  );
}

