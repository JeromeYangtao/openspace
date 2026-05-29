/**
 * Channel Header — 顶部栏，含频道名、描述、操作按钮
 * 参考: docs/ui-reference/screenshots/10-channel-main-desktop.png
 */

import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Channel } from '@openspace/shared';
import { cn } from '../lib/cn';

interface Props {
  channel: Channel;
  memberCount: number;
  onStopAll?: () => void;
  onEditChannel?: () => void;
  onManageMembers?: () => void;
}

export function ChannelHeader({
  channel,
  memberCount,
  onStopAll,
  onEditChannel,
  onManageMembers,
}: Props) {
  const [params] = useSearchParams();
  const chatTab = (params.get('chatTab') ?? 'chat') as 'chat' | 'tasks';
  const navigate = useNavigate();

  const setTab = (tab: 'chat' | 'tasks') => {
    const next = new URLSearchParams(params);
    if (tab === 'chat') next.delete('chatTab');
    else next.set('chatTab', tab);
    navigate({ search: next.toString() ? `?${next.toString()}` : '' });
  };

  return (
    <div className="border-b-2 border-black bg-bg-card">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-10 h-10 bg-accent-yellow border-2 border-black rounded flex items-center justify-center font-bold text-lg">
          #
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-bold">{channel.name}</span>
          {channel.description && (
            <>
              <span className="text-text-secondary">—</span>
              <span className="text-text-secondary text-sm truncate">
                {channel.description}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {onStopAll && (
            <IconButton
              title="Stop all agents in this channel"
              onClick={onStopAll}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="5" y="5" width="14" height="14" rx="1" />
              </svg>
            </IconButton>
          )}
          <IconButton title="Edit channel" onClick={onEditChannel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </IconButton>
          <button
            onClick={onManageMembers}
            title="Manage members"
            className="flex items-center gap-1 px-2 py-1.5 border-2 border-black rounded bg-bg-card font-mono text-xs hover:bg-accent-yellow"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {memberCount}
          </button>
        </div>
      </div>

      <div className="flex border-t-2 border-black">
        <TabButton active={chatTab === 'chat'} onClick={() => setTab('chat')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          CHAT
        </TabButton>
        <TabButton active={chatTab === 'tasks'} onClick={() => setTab('tasks')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          TASKS
        </TabButton>
      </div>
    </div>
  );
}

function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'w-8 h-8 flex items-center justify-center border-2 border-black rounded',
        disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-accent-yellow',
      )}
    >
      {children}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold font-mono border-r-2 border-black last:border-r-0',
        active ? 'bg-accent-yellow' : 'hover:bg-[#f9efc8]',
      )}
    >
      {children}
    </button>
  );
}
