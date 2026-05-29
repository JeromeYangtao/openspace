import { useEffect, useMemo, useState } from 'react';
import { useMatch } from 'react-router-dom';
import { useChannelsStore } from '../stores/channels';
import { useAgentsStore } from '../stores/agents';
import { useProjectsStore } from '../stores/projects';
import { useWorkflowsStore } from '../stores/workflows';
import { Sidebar } from './Sidebar';
import { CreateAgentDialog } from './CreateAgentDialog';
import { CreateChannelDialog } from './CreateChannelDialog';
import { OpenProjectDialog } from './OpenProjectDialog';
import { SearchDialog } from './SearchDialog';

interface Props {
  children: React.ReactNode;
}

export function Layout({ children }: Props) {
  const channels = useChannelsStore((s) => s.channels);
  const agents = useAgentsStore((s) => s.agents);
  const projects = useProjectsStore((s) => s.projects);
  const currentProjectId = useProjectsStore((s) => s.currentProjectId);
  const setCurrentProject = useProjectsStore((s) => s.setCurrent);
  const upsertChannel = useChannelsStore((s) => s.upsert);

  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // 全局快捷键：⌘/Ctrl+K 打开搜索
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // 从 URL 取当前激活项（CP8.1 — Project scope 路由）
  const channelMatch = useMatch('/p/:projectName/channel/:channelId');
  const dmMatch = useMatch('/p/:projectName/dm/:agentId');

  const autoJoinChannelId = channelMatch?.params.channelId;

  // v1.0 CP5b：按当前 Project 过滤 channels / agents
  // currentProjectId 为 null 时显示所有（兼容 v0 遗留数据 / 无 Project 首次启动）
  const currentProject =
    projects.find((p) => p.id === currentProjectId) ?? null;

  // CP4：切换 Project 时拉一次 workflows 列表（用于 /command 提示）
  const fetchWorkflows = useWorkflowsStore((s) => s.fetchProjectWorkflows);
  useEffect(() => {
    if (currentProject) {
      void fetchWorkflows(currentProject.id);
    }
  }, [currentProject, fetchWorkflows]);

  const visibleChannels = useMemo(() => {
    if (!currentProject) return channels;
    return channels.filter(
      (c) => !c.project_id || c.project_id === currentProject.id,
    );
  }, [channels, currentProject]);

  const visibleAgents = useMemo(() => {
    if (!currentProject) return agents;
    return agents.filter(
      (a) => !a.project_id || a.project_id === currentProject.id,
    );
  }, [agents, currentProject]);

  return (
    <div className="h-full flex">
      <Sidebar
        channels={visibleChannels}
        agents={visibleAgents}
        projects={projects}
        currentProject={currentProject}
        onSelectProject={setCurrentProject}
        onCreateProject={() => setCreateProjectOpen(true)}
        currentChannelId={channelMatch?.params.channelId}
        currentDmAgentId={dmMatch?.params.agentId}
        onCreateAgent={() => setCreateAgentOpen(true)}
        onCreateChannel={() => setCreateChannelOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-bg-main">
        {children}
      </div>
      <CreateAgentDialog
        open={createAgentOpen}
        onClose={() => setCreateAgentOpen(false)}
        autoJoinChannelId={autoJoinChannelId}
        projectId={currentProject?.id}
      />
      <CreateChannelDialog
        open={createChannelOpen}
        onClose={() => setCreateChannelOpen(false)}
        onCreated={(c) => upsertChannel(c)}
        projectId={currentProject?.id}
      />
      <OpenProjectDialog
        open={createProjectOpen}
        onClose={() => setCreateProjectOpen(false)}
      />
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
