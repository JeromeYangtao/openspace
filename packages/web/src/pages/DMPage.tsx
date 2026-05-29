import { useEffect, useMemo } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import type { ChatMessage } from '@openspace/shared';
import { useAgentsStore } from '../stores/agents';
import { useMessagesStore } from '../stores/messages';
import { useChannelsStore } from '../stores/channels';
import { useProjectsStore } from '../stores/projects';
import { wsClient } from '../lib/ws';
import { DMHeader } from '../components/DMHeader';
import { MessageList } from '../components/MessageList';
import { MessageInput } from '../components/MessageInput';
import { AgentProfilePanel } from '../components/AgentProfilePanel';

const EMPTY_MESSAGES: ChatMessage[] = [];

/**
 * MVP 简化（CP8.1 — Project scope 路由）：
 *   DM 并非独立 channel type=dm，当前把 agent 接在该 Project 的 #general 里。
 *   多 Project 下 #general 必须按当前 Project 的 project_id 过滤，否则会发到错的 Project。
 *   真正的 DM 实现需要独立 channel_id（type=dm），后续迭代补。
 *
 * URL: /p/:projectName/dm/:agentId
 */
export function DMPage() {
  const { projectName, agentId } = useParams<{ projectName: string; agentId: string }>();
  const [params] = useSearchParams();
  const profileParam = params.get('profile');
  const profileAgentId = profileParam?.startsWith('agent:') ? profileParam.slice(6) : null;
  const agents = useAgentsStore((s) => s.agents);
  const agentsLoaded = useAgentsStore((s) => s.loaded);
  const agent = agents.find((a) => a.id === agentId);
  const profileAgent = profileAgentId ? agents.find((a) => a.id === profileAgentId) : null;
  const channels = useChannelsStore((s) => s.channels);
  const projects = useProjectsStore((s) => s.projects);

  const project = useMemo(
    () => projects.find((p) => p.name === projectName) ?? null,
    [projects, projectName],
  );

  // 找当前 Project 的 #general（CP8.1：必须按 project_id 过滤）
  const generalChannel = useMemo(() => {
    if (!project) return null;
    return (
      channels.find((c) => c.name === 'general' && c.project_id === project.id) ??
      // 兜底：如果没有 #general，就用该 Project 的第一个 type=channel
      channels.find((c) => c.type === 'channel' && c.project_id === project.id) ??
      null
    );
  }, [channels, project]);

  const channelId = generalChannel?.id;

  const byChannel = useMessagesStore((s) => s.byChannel);
  const messages = channelId ? byChannel.get(channelId) ?? EMPTY_MESSAGES : EMPTY_MESSAGES;
  const streamBuffers = useMessagesStore((s) => s.streamBuffers);
  const activityByMessage = useMessagesStore((s) => s.activityByMessage);
  const fetchChannel = useMessagesStore((s) => s.fetchChannel);

  useEffect(() => {
    if (!channelId) return;
    void fetchChannel(channelId);
    wsClient.send({ type: 'subscribe_channel', channel_id: channelId });
    return () => {
      wsClient.send({ type: 'unsubscribe_channel', channel_id: channelId });
    };
  }, [channelId, fetchChannel]);

  const agentsById = useMemo(() => {
    const m = new Map();
    if (agent) m.set(agent.id, agent);
    return m;
  }, [agent]);

  if (!agentsLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
        Loading…
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
        Agent not found.
      </div>
    );
  }

  // 校验 agent 是否属于该 Project（CP8.1 跨 Project URL 安全）
  if (agent.project_id && project && agent.project_id !== project.id) {
    return <Navigate to="/" replace />;
  }

  // 只展示和这个 agent 相关的消息（及用户发给它的）
  const filtered = messages.filter(
    (m) =>
      m.sender_type === 'system' ||
      m.sender_id === agent.id ||
      (m.sender_type === 'user' && m.content.includes(`@${agent.name}`)),
  );

  const send = (content: string, opts?: { asTask?: boolean }) => {
    if (!channelId) return;
    const c = content.includes(`@${agent.name}`) ? content : `@${agent.name} ${content}`;
    wsClient.send({
      type: 'send_message',
      channel_id: channelId,
      content: c,
      as_task: opts?.asTask,
    });
  };

  return (
    <div className="flex-1 flex min-w-0 min-h-0">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <DMHeader agent={agent} channelId={channelId} />
        {channelId ? (
          <>
            <MessageList
              messages={filtered}
              agentsById={agentsById}
              streamBuffers={streamBuffers}
              activityByMessage={activityByMessage}
              emptyHint={`Start a conversation with ${agent.name}.`}
            />
            <MessageInput
              placeholder={`Message @${agent.name}`}
              onSend={send}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-secondary font-mono p-8 text-center">
            This project has no #general channel yet. Create one from the sidebar to start
            messaging {agent.name}.
          </div>
        )}
      </div>
      {profileAgent && <AgentProfilePanel agent={profileAgent} />}
    </div>
  );
}
