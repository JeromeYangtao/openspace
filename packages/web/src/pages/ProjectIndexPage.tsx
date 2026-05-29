/**
 * Project Index Page — `/p/:projectName`
 *
 * 行为：
 *   - 该 Project 至少有一个 channel：自动 redirect 到第一个 channel
 *   - 没有 channel：显示空状态卡片，引导创建 channel 或 agent
 *
 * 由 ProjectScope（App.tsx）作为 outlet 渲染。
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { ProjectOnboarding } from '@openspace/shared';
import { useChannelsStore } from '../stores/channels';
import { useAgentsStore } from '../stores/agents';
import { useProjectsStore } from '../stores/projects';
import { getProjectOnboarding, runOnboarder } from '../lib/api';
import { projectChannelPath, projectDmPath } from '../lib/routes';

export function ProjectIndexPage() {
  const { projectName } = useParams<{ projectName: string }>();
  const projects = useProjectsStore((s) => s.projects);
  const channels = useChannelsStore((s) => s.channels);
  const agents = useAgentsStore((s) => s.agents);

  const project = useMemo(
    () => projects.find((p) => p.name === projectName) ?? null,
    [projects, projectName],
  );

  const projectChannels = useMemo(() => {
    if (!project) return [];
    return channels.filter((c) => c.project_id === project.id || !c.project_id);
  }, [channels, project]);

  const projectAgents = useMemo(() => {
    if (!project) return [];
    return agents.filter((a) => a.project_id === project.id || !a.project_id);
  }, [agents, project]);

  if (!project || !projectName) return <Navigate to="/" replace />;

  // 有 channel → 自动跳到第一个
  const firstChannel = projectChannels[0];
  if (firstChannel) {
    return <Navigate to={projectChannelPath(projectName, firstChannel.id)} replace />;
  }

  // 无 channel：空状态 + Onboarding 卡片（Sprint 6 CP3）
  return (
    <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
      <div className="max-w-2xl w-full bg-bg-card border-2 border-black rounded-xl p-8 shadow-[6px_6px_0_0_#000]">
        <h1 className="text-2xl font-bold mb-2">{project.display_name ?? project.name}</h1>
        <div className="text-[12px] font-mono text-text-secondary mb-6">{project.workspace_path}</div>
        <div className="text-sm mb-6">{project.goal}</div>

        <OnboardingCard projectId={project.id} />

        <div className="p-4 bg-accent-yellow border-2 border-black rounded mb-4">
          <div className="font-bold mb-1">No channels yet</div>
          <div className="text-sm">
            Create a channel or DM an agent from the sidebar to start collaborating.
          </div>
        </div>

        {projectAgents.length > 0 && (
          <div>
            <div className="section-header mb-2">AGENTS IN THIS PROJECT</div>
            <ul className="space-y-1">
              {projectAgents.map((a) => (
                <li key={a.id}>
                  <Link
                    to={projectDmPath(projectName, a.id)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 border-2 border-black rounded hover:bg-accent-yellow font-medium"
                  >
                    <span>{a.name}</span>
                    <span className="text-xs font-mono text-text-secondary">
                      {a.runtime} · {a.model ?? '-'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function OnboardingCard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProjectOnboarding | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await getProjectOnboarding(projectId);
      // 后端无数据时返回 { project_id, ready: false }，没有 overview 字段
      if ('overview' in res && res.overview) {
        setData(res as ProjectOnboarding);
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    }
  };

  useEffect(() => {
    void load();
    // 1.5s 一次轮询直到首次出现 overview（Onboarder 异步跑）
    const t = setInterval(() => {
      if (data) return; // 已有数据后停止
      void load();
    }, 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, data?.overview]);

  const onRerun = async () => {
    setBusy(true);
    try {
      const res = await runOnboarder(projectId);
      if (res && 'overview' in res) {
        setData(res as ProjectOnboarding);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <div className="p-4 mb-4 bg-bg-main border-2 border-dashed border-black/40 rounded">
        <div className="font-bold text-sm mb-1">📚 Onboarding</div>
        <div className="text-[12px] font-mono text-text-secondary">
          Onboarder is analyzing the workspace… this card will fill in shortly.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 mb-4 bg-accent-cyan/30 border-2 border-black rounded">
      <div className="flex items-center gap-2 mb-2">
        <div className="font-bold text-sm">📚 Onboarding</div>
        <button
          onClick={() => void onRerun()}
          disabled={busy}
          className="ml-auto px-2 py-0.5 text-[10px] font-mono font-bold border-2 border-black rounded bg-bg-card hover:bg-accent-yellow disabled:opacity-50"
        >
          {busy ? 'Re-running…' : 'Re-run'}
        </button>
      </div>
      <div className="text-sm mb-2">{data.overview}</div>
      {data.tech_stack.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {data.tech_stack.map((t) => (
            <code
              key={t}
              className="px-1.5 py-0.5 text-[10px] font-mono border-2 border-black rounded bg-bg-card"
            >
              {t}
            </code>
          ))}
        </div>
      )}
      {data.conventions && (
        <details className="text-[12px] font-mono text-text-secondary">
          <summary className="cursor-pointer">▸ Conventions</summary>
          <div className="mt-1 whitespace-pre-wrap">{data.conventions}</div>
        </details>
      )}
    </div>
  );
}
