import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import type { ChatMessage } from '@openspace/shared';
import { useAgentsStore } from '../stores/agents';
import { useAuthStore } from '../stores/auth';
import { useChannelsStore } from '../stores/channels';
import { useMessagesStore } from '../stores/messages';
import { useProjectsStore } from '../stores/projects';
import { useUsersStore } from '../stores/users';
import { getOrCreateUserDmChannel } from '../lib/api';
import { wsClient } from '../lib/ws';
import { Avatar } from '../components/Avatar';
import { MessageInput } from '../components/MessageInput';
import { MessageList } from '../components/MessageList';

const EMPTY_MESSAGES: ChatMessage[] = [];

export function UserDMPage() {
  const { projectName, userId } = useParams<{ projectName: string; userId: string }>();
  const currentUser = useAuthStore((s) => s.user);
  const users = useUsersStore((s) => s.users);
  const usersLoaded = useUsersStore((s) => s.loaded);
  const projects = useProjectsStore((s) => s.projects);
  const upsertChannel = useChannelsStore((s) => s.upsert);
  const agents = useAgentsStore((s) => s.agents);
  const byChannel = useMessagesStore((s) => s.byChannel);
  const streamBuffers = useMessagesStore((s) => s.streamBuffers);
  const activityByMessage = useMessagesStore((s) => s.activityByMessage);
  const fetchChannel = useMessagesStore((s) => s.fetchChannel);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const project = useMemo(
    () => projects.find((p) => p.name === projectName) ?? null,
    [projects, projectName],
  );
  const targetUser = users.find((u) => u.id === userId);
  const targetName = targetUser?.display_name ?? targetUser?.username ?? 'User';
  const messages = channelId ? (byChannel.get(channelId) ?? EMPTY_MESSAGES) : EMPTY_MESSAGES;

  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  useEffect(() => {
    let cancelled = false;
    if (!project || !userId || userId === currentUser?.id) return;
    setError(null);
    void getOrCreateUserDmChannel(userId, project.id)
      .then((channel) => {
        if (cancelled) return;
        upsertChannel(channel);
        setChannelId(channel.id);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, project, upsertChannel, userId]);

  useEffect(() => {
    if (!channelId) return;
    void fetchChannel(channelId);
    wsClient.send({ type: 'subscribe_channel', channel_id: channelId });
    return () => {
      wsClient.send({ type: 'unsubscribe_channel', channel_id: channelId });
    };
  }, [channelId, fetchChannel]);

  if (userId === currentUser?.id) {
    return <Navigate to="/" replace />;
  }

  if (!project || (!usersLoaded && !targetUser)) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
        Loading...
      </div>
    );
  }

  if (!targetUser) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
        User not found.
      </div>
    );
  }

  const send = (content: string, opts?: { asTask?: boolean }) => {
    if (!channelId) return;
    wsClient.send({
      type: 'send_message',
      channel_id: channelId,
      content,
      as_task: opts?.asTask,
    });
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <div className="border-b-2 border-black bg-bg-card px-4 py-3 flex items-center gap-3">
        <Avatar name={targetName} kind="user" size="md" />
        <div className="min-w-0">
          <div className="font-bold truncate">{targetName}</div>
          <div className="font-mono text-xs text-text-secondary truncate">@{targetUser.username}</div>
        </div>
      </div>
      {error ? (
        <div className="flex-1 flex items-center justify-center px-6 text-center font-mono text-sm text-accent-red">
          {error}
        </div>
      ) : channelId ? (
        <>
          <MessageList
            messages={messages}
            agentsById={agentsById}
            streamBuffers={streamBuffers}
            activityByMessage={activityByMessage}
            emptyHint={`Message ${targetName}.`}
          />
          <MessageInput placeholder={`Message @${targetUser.username}`} onSend={send} />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
          Loading...
        </div>
      )}
    </div>
  );
}
