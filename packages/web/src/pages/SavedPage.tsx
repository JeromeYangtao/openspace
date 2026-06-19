import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Agent, ChatMessage, Channel } from '@openspace/shared';
import { listSaved, unsaveMessage } from '../lib/api';
import { useAgentsStore } from '../stores/agents';
import { useChannelsStore } from '../stores/channels';
import { useUsersStore } from '../stores/users';
import { channelPath } from '../lib/routes';
import { Avatar } from '../components/Avatar';

export function SavedPage() {
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const agents = useAgentsStore((s) => s.agents);
  const channels = useChannelsStore((s) => s.channels);
  const usersById = useUsersStore((s) => s.usersById);
  const navigate = useNavigate();

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const channelsById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const load = async () => {
    const list = await listSaved();
    setItems(list);
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, []);

  const remove = async (id: string) => {
    await unsaveMessage(id);
    await load();
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="border-b-2 border-black bg-bg-card px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 bg-accent-teal border-2 border-black rounded flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div>
          <div className="font-bold">Saved</div>
          <div className="text-xs font-mono text-text-secondary">{items.length} saved</div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="text-text-secondary font-mono text-sm">Loading...</div>
        ) : items.length === 0 ? (
          <div className="text-text-secondary font-mono text-sm py-8 text-center">
            No saved messages yet. Click the bookmark icon on any message to save it.
          </div>
        ) : (
          items.map((m) => (
            <SavedRow
              key={m.id}
              message={m}
              agent={m.sender_id ? agentsById.get(m.sender_id) : undefined}
              user={m.sender_id ? usersById.get(m.sender_id) : undefined}
              channel={channelsById.get(m.channel_id)}
              onOpen={() => {
                const base = channelPath(m.channel_id);
                navigate(
                  m.parent_id ? `${base}?thread=${encodeURIComponent(m.parent_id)}` : base,
                );
              }}
              onUnsave={() => void remove(m.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SavedRow({
  message,
  agent,
  user,
  channel,
  onOpen,
  onUnsave,
}: {
  message: ChatMessage;
  agent?: Agent;
  user?: { username: string; display_name: string | null };
  channel?: Channel;
  onOpen: () => void;
  onUnsave: () => void;
}) {
  const senderName =
    message.sender_type === 'agent'
      ? `@${agent?.name ?? 'Agent'}`
      : (user?.username ?? 'User');
  return (
    <div className="flex items-start gap-2 p-3 border-2 border-black rounded bg-bg-card">
      {agent && <Avatar name={agent.name} kind="agent" size="sm" />}
      <button onClick={onOpen} className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-2 text-xs font-mono text-text-secondary mb-1">
          {channel && <span className="font-bold">#{channel.name}</span>}
          <span>{senderName}</span>
        </div>
        <div className="text-sm line-clamp-3">{message.content}</div>
      </button>
      <button
        onClick={onUnsave}
        className="w-7 h-7 flex items-center justify-center border-2 border-black rounded bg-bg-card hover:bg-accent-red"
        title="Remove from saved"
        aria-label="Remove from saved"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    </div>
  );
}
