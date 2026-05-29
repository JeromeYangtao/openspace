/**
 * MessageList — 消息容器（滚动 + 自动滚到底）
 */

import { useEffect, useRef } from 'react';
import type { Agent, AgentActivityEvent, ChatMessage } from '@openspace/shared';
import { Message } from './Message';

interface Props {
  messages: ChatMessage[];
  agentsById: Map<string, Agent>;
  streamBuffers: Map<string, string>;
  activityByMessage: Map<string, AgentActivityEvent[]>;
  onOpenThread?: (messageId: string) => void;
  emptyHint?: React.ReactNode;
}

export function MessageList({
  messages,
  agentsById,
  streamBuffers,
  activityByMessage,
  onOpenThread,
  emptyHint,
}: Props) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, streamBuffers]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 py-12 text-text-secondary font-mono text-sm">
        {emptyHint ?? 'No messages yet.'}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      {messages.map((m) => (
        <Message
          key={m.id}
          message={m}
          agent={m.sender_id ? agentsById.get(m.sender_id) : undefined}
          streamingText={streamBuffers.get(m.id)}
          activityEvents={activityByMessage.get(m.id)}
          onOpenThread={onOpenThread}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
