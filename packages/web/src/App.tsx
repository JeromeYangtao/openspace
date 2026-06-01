/**
 * OpenSpace Web App 入口
 *
 * - 初始化 stores（channels + agents + projects）
 * - 启动 WebSocket 连接
 * - 配置路由（CP8.1 Project scope）
 *
 * 路由结构：
 *   /                                根（无 Project: Welcome；有 Project: redirect 到第一个）
 *   /p/:projectName                  Project index（自动跳到第一个 channel）
 *   /p/:projectName/channel/:id      频道
 *   /p/:projectName/dm/:agentId      DM
 *   /p/:projectName/agent/:agentId   Agent Profile（占位）
 *   /threads / /tasks / /saved       全局视图（跨 Project）
 *   /channel/:id / /dm/:id           旧链接兼容（自动 redirect 到 Project scope）
 */

import { useEffect } from 'react';
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useParams,
} from 'react-router-dom';
import { useChannelsStore } from './stores/channels';
import { useAgentsStore } from './stores/agents';
import { useAuthStore } from './stores/auth';
import { useProjectsStore } from './stores/projects';
import { initWSBridge } from './stores/ws-bridge';
import { wsClient } from './lib/ws';
import { Layout } from './components/Layout';
import { WelcomePage } from './pages/WelcomePage';
import { ProjectIndexPage } from './pages/ProjectIndexPage';
import { ProjectSettingsPage } from './pages/ProjectSettingsPage';
import { ChannelPage } from './pages/ChannelPage';
import { DMPage } from './pages/DMPage';
import { GlobalThreadsPage } from './pages/GlobalThreadsPage';
import { GlobalTasksPage } from './pages/GlobalTasksPage';
import { InboxPage } from './pages/InboxPage';
import { IntelligencePage } from './pages/IntelligencePage';
import { SavedPage } from './pages/SavedPage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { AuthPage } from './pages/AuthPage';
import { channelPath, dmPath } from './lib/routes';

export function App() {
  const authLoading = useAuthStore((s) => s.loading);
  const user = useAuthStore((s) => s.user);
  const bootstrapRequired = useAuthStore((s) => s.bootstrapRequired);
  const refreshAuth = useAuthStore((s) => s.refresh);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center text-text-secondary font-mono">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <AuthPage mode={bootstrapRequired ? 'bootstrap' : 'login'} />;
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const refreshChannels = useChannelsStore((s) => s.refresh);
  const refreshAgents = useAgentsStore((s) => s.refresh);
  const refreshActiveRuns = useAgentsStore((s) => s.refreshActiveRuns);
  const refreshProjects = useProjectsStore((s) => s.refresh);

  useEffect(() => {
    initWSBridge();
    wsClient.connect();
    void refreshProjects();
    void refreshChannels();
    void refreshAgents();
    void refreshActiveRuns();
    return wsClient.onStatus((status) => {
      if (status === 'open') {
        void refreshActiveRuns();
      }
    });
  }, [refreshProjects, refreshChannels, refreshAgents, refreshActiveRuns]);

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<WelcomePage />} />

          {/* Project scope */}
          <Route path="/p/:projectName" element={<ProjectScope />}>
            <Route index element={<ProjectIndexPage />} />
            <Route path="channel/:channelId" element={<ChannelPage />} />
            <Route path="dm/:agentId" element={<DMPage />} />
            <Route path="agent/:agentId" element={<AgentPlaceholder />} />
            <Route path="workflows" element={<WorkflowsPage />} />
            <Route path="intelligence" element={<IntelligencePage />} />
            <Route path="settings" element={<ProjectSettingsPage />} />
          </Route>

          {/* 全局视图（跨 Project） */}
          <Route path="/threads" element={<GlobalThreadsPage />} />
          <Route path="/tasks" element={<GlobalTasksPage />} />
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          {/* 旧链接兼容 redirect（CP8.1 上线前的历史链接） */}
          <Route path="/channel/:channelId" element={<LegacyChannelRedirect />} />
          <Route path="/dm/:agentId" element={<LegacyDMRedirect />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

/**
 * Project scope outlet：根据 URL 中的 :projectName 同步 store.currentProjectId。
 * 若 projectName 在 store 中找不到 → redirect 到 /
 */
function ProjectScope() {
  const { projectName } = useParams<{ projectName: string }>();
  const projects = useProjectsStore((s) => s.projects);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const currentProjectId = useProjectsStore((s) => s.currentProjectId);
  const setCurrent = useProjectsStore((s) => s.setCurrent);

  const project = projects.find((p) => p.name === projectName);

  useEffect(() => {
    if (project && currentProjectId !== project.id) {
      setCurrent(project.id);
    }
  }, [project, currentProjectId, setCurrent]);

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

  return <Outlet />;
}

function LegacyChannelRedirect() {
  const { channelId } = useParams<{ channelId: string }>();
  const channelsLoaded = useChannelsStore((s) => s.loaded);
  const projectsLoaded = useProjectsStore((s) => s.loaded);

  if (!channelsLoaded || !projectsLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
        Loading…
      </div>
    );
  }

  if (!channelId) return <Navigate to="/" replace />;
  return <Navigate to={channelPath(channelId)} replace />;
}

function LegacyDMRedirect() {
  const { agentId } = useParams<{ agentId: string }>();
  const agentsLoaded = useAgentsStore((s) => s.loaded);
  const projectsLoaded = useProjectsStore((s) => s.loaded);

  if (!agentsLoaded || !projectsLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
        Loading…
      </div>
    );
  }

  if (!agentId) return <Navigate to="/" replace />;
  return <Navigate to={dmPath(agentId)} replace />;
}

function AgentPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
      Agent Profile page — coming in MVP-8
    </div>
  );
}
