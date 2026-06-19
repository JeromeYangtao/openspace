import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Agent, ChatMessage, Channel } from '@openspace/shared';
import { listGlobalThreads } from '../lib/api';
import { useAgentsStore } from '../stores/agents';
import { useChannelsStore } from '../stores/channels';
import { useUsersStore } from '../stores/users';
import { channelPath } from '../lib/routes';
import { Avatar } from '../components/Avatar';

export function GlobalThreadsPage() {
  const [threads, setThreads] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const agents = useAgentsStore((s) => s.agents);
  const channels = useChannelsStore((s) => s.channels);
  const usersById = useUsersStore((s) => s.usersById);
  const navigate = useNavigate();

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const channelsById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  useEffect(() => {
    listGlobalThreads()
      .then(setThreads)
      .catch(() => setThreads([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="border-b-2 border-black bg-bg-card px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 bg-accent-cyan border-2 border-black rounded flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div>
          <div className="font-bold">Threads</div>
          <div className="text-xs font-mono text-text-secondary">{threads.length} active</div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="text-text-secondary font-mono text-sm">Loading...</div>
        ) : threads.length === 0 ? (
          <div className="text-text-secondary font-mono text-sm py-8 text-center">
            No threads yet. Threads are created when agents reply in chains.
          </div>
        ) : (
          threads.map((t) => (
            <ThreadCard
              key={t.id}
              message={t}
              agent={t.sender_id ? agentsById.get(t.sender_id) : undefined}
              user={t.sender_id ? usersById.get(t.sender_id) : undefined}
              channel={channelsById.get(t.channel_id)}
              onOpen={() =>
                navigate(`${channelPath(t.channel_id)}?thread=${encodeURIComponent(t.id)}`)
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function ThreadCard({
  message,
  agent,
  user,
  channel,
  onOpen,
}: {
  message: ChatMessage;
  agent?: Agent;
  user?: { username: string; display_name: string | null };
  channel?: Channel;
  onOpen: () => void;
}) {
  const senderName =
    message.sender_type === 'agent'
      ? `@${agent?.name ?? 'Agent'}`
      : (user?.username ?? 'User');
  return (
    <button
      onClick={onOpen}
      className="w-full text-left border-2 border-black rounded bg-bg-card p-3 hover:bg-bg-main"
    >
      <div className="flex items-center gap-2 mb-1.5 text-xs font-mono text-text-secondary">
        {channel && <span className="font-bold">#{channel.name}</span>}
        {agent && <Avatar name={agent.name} kind="agent" size="sm" />}
        <span>{senderName}</span>
        <span className="ml-auto">{formatTime(message.created_at)}</span>
      </div>
      <div className="text-sm line-clamp-2 mb-1.5">{message.content}</div>
      <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-cyan border-2 border-black rounded text-xs font-medium font-mono">
        💬 {message.reply_count} {message.reply_count === 1 ? 'reply' : 'replies'}
      </div>
    </button>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
