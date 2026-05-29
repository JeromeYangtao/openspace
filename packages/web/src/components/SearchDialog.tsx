/**
 * ⌘K 搜索对话框：消息全文搜索，支持按频道过滤
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChatMessage } from '@openspace/shared';
import { searchMessages } from '../lib/api';
import { useAgentsStore } from '../stores/agents';
import { useChannelsStore } from '../stores/channels';
import { channelPath } from '../lib/routes';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SearchDialog({ open, onClose }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const agents = useAgentsStore((s) => s.agents);
  const channels = useChannelsStore((s) => s.channels);
  const navigate = useNavigate();

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const channelsById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  useEffect(() => {
    if (!open) {
      setQ('');
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !q.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      searchMessages(q)
        .then((r) => {
          if (!cancelled) setResults(r);
        })
        .catch(() => setResults([]))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200); // debounce
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const openResult = (m: ChatMessage) => {
    const base = channelPath(m.channel_id);
    if (m.parent_id) {
      navigate(`${base}?thread=${encodeURIComponent(m.parent_id)}`);
    } else {
      navigate(base);
    }
    onClose();
  };

  return (
    <Dialog open={open} title="SEARCH" onClose={onClose} maxWidth={640}>
      <div className="p-5 space-y-3">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search messages..."
          className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card text-sm focus:outline-none focus:ring-2 focus:ring-accent-pink"
          autoFocus
        />
        <div className="max-h-96 overflow-y-auto space-y-1">
          {loading && (
            <div className="text-text-secondary font-mono text-sm">Searching...</div>
          )}
          {!loading && q && results.length === 0 && (
            <div className="text-text-secondary font-mono text-sm">No matches.</div>
          )}
          {!loading && !q && (
            <div className="text-text-secondary font-mono text-sm">Type to search across all messages.</div>
          )}
          {results.map((m) => {
            const ch = channelsById.get(m.channel_id);
            const a = m.sender_id ? agentsById.get(m.sender_id) : undefined;
            const senderName =
              m.sender_type === 'agent' ? `@${a?.name ?? 'Agent'}` : m.sender_type === 'system' ? 'system' : 'You';
            return (
              <button
                key={m.id}
                onClick={() => openResult(m)}
                className="w-full text-left p-2 border-2 border-black rounded bg-bg-card hover:bg-bg-main"
              >
                <div className="flex items-center gap-2 text-xs font-mono text-text-secondary mb-1">
                  {ch && <span className="font-bold">#{ch.name}</span>}
                  <span>{senderName}</span>
                </div>
                <div className="text-sm line-clamp-2">
                  {highlightMatch(m.content, q)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}

function highlightMatch(text: string, q: string): React.ReactNode {
  if (!q.trim()) return text;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const idx = lower.indexOf(ql);
  if (idx < 0) return text;
  const pre = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const post = text.slice(idx + q.length);
  return (
    <>
      {pre}
      <mark className="bg-accent-yellow text-black">{match}</mark>
      {post}
    </>
  );
}
