/**
 * MessageList — 消息容器（滚动 + 自动滚到底）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, AgentActivityEvent, ChatMessage } from '@openspace/shared';
import { getMessagesSavedStatus } from '../lib/api';
import { Message } from './Message';

interface Props {
  messages: ChatMessage[];
  agentsById: Map<string, Agent>;
  streamBuffers: Map<string, string>;
  activityByMessage: Map<string, AgentActivityEvent[]>;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: (beforeMessageId: string) => Promise<void>;
  onOpenThread?: (messageId: string) => void;
  emptyHint?: React.ReactNode;
}

export function MessageList({
  messages,
  agentsById,
  streamBuffers,
  activityByMessage,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onOpenThread,
  emptyHint,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollHeightRef = useRef<number | null>(null);
  const lastNewestMessageIdRef = useRef<string | null>(null);
  const savedStatusIds = useMemo(
    () => messages.filter((m) => m.sender_type !== 'system').map((m) => m.id),
    [messages],
  );
  const savedStatusKey = savedStatusIds.join(',');
  const [savedById, setSavedById] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const newestMessageId = messages[messages.length - 1]?.id ?? null;
    const previousNewestMessageId = lastNewestMessageIdRef.current;
    lastNewestMessageIdRef.current = newestMessageId;
    if (pendingScrollHeightRef.current !== null) return;
    if (previousNewestMessageId === newestMessageId && messages.length > 0) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || pendingScrollHeightRef.current !== null) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > 160) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [streamBuffers]);

  useEffect(() => {
    const el = scrollRef.current;
    const prevHeight = pendingScrollHeightRef.current;
    if (!el || prevHeight === null) return;
    pendingScrollHeightRef.current = null;
    el.scrollTop += el.scrollHeight - prevHeight;
  }, [messages.length]);

  useEffect(() => {
    if (savedStatusIds.length === 0) {
      setSavedById({});
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getMessagesSavedStatus(savedStatusIds)
        .then((status) => {
          if (!cancelled) setSavedById(status);
        })
        .catch(() => {
          if (!cancelled) setSavedById({});
        });
    }, 100);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [savedStatusKey]);

  const handleScroll = () => {
    const el = scrollRef.current;
    const oldestMessageId = messages[0]?.id;
    if (!el || !oldestMessageId || !hasMore || loadingMore || !onLoadMore) return;
    if (el.scrollTop > 80) return;

    pendingScrollHeightRef.current = el.scrollHeight;
    void onLoadMore(oldestMessageId).catch(() => {
      pendingScrollHeightRef.current = null;
    });
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 py-12 text-text-secondary font-mono text-sm">
        {emptyHint ?? 'No messages yet.'}
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-4">
      {loadingMore && (
        <div className="py-2 text-center text-[11px] font-mono text-text-secondary">
          Loading earlier messages...
        </div>
      )}
      {messages.map((m) => (
        <Message
          key={m.id}
          message={m}
          agent={m.sender_id ? agentsById.get(m.sender_id) : undefined}
          streamingText={streamBuffers.get(m.id)}
          activityEvents={activityByMessage.get(m.id)}
          saved={!!savedById[m.id]}
          onOpenThread={onOpenThread}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
