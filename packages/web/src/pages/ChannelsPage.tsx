import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { Channel, ChannelStatus } from '@openspace/shared';
import { CHANNEL_STATUSES } from '@openspace/shared';
import { cn } from '../lib/cn';
import { deleteChannel, updateChannel } from '../lib/api';
import { projectChannelPath } from '../lib/routes';
import { useChannelsStore } from '../stores/channels';
import { useProjectsStore } from '../stores/projects';

type FilterKey = 'all' | ChannelStatus;

const STATUS_BADGE: Record<ChannelStatus, { label: string; bg: string }> = {
  pending: { label: 'PENDING', bg: 'bg-accent-orange' },
  active: { label: 'ACTIVE', bg: 'bg-accent-cyan' },
  review: { label: 'REVIEW', bg: 'bg-accent-purple' },
  done: { label: 'DONE', bg: 'bg-[#b8e98c]' },
  cancel: { label: 'CANCEL', bg: 'bg-red-300' },
};

export function ChannelsPage() {
  const { projectName } = useParams<{ projectName: string }>();
  const projects = useProjectsStore((s) => s.projects);
  const channels = useChannelsStore((s) => s.channels);
  const upsertChannel = useChannelsStore((s) => s.upsert);
  const removeChannel = useChannelsStore((s) => s.remove);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const project = useMemo(
    () => projects.find((p) => p.name === projectName) ?? null,
    [projects, projectName],
  );

  const projectChannels = useMemo(() => {
    if (!project) return [];
    return channels
      .filter((c) => c.type === 'channel')
      .filter((c) => c.project_id === project.id || !c.project_id)
      .sort((a, b) => a.created_at - b.created_at);
  }, [channels, project]);

  const counts = useMemo(() => {
    const next: Record<FilterKey, number> = {
      all: projectChannels.length,
      pending: 0,
      active: 0,
      review: 0,
      done: 0,
      cancel: 0,
    };
    for (const channel of projectChannels) next[channel.status] += 1;
    return next;
  }, [projectChannels]);

  if (!project || !projectName) return <Navigate to="/" replace />;

  const updateStatus = async (channel: Channel, status: ChannelStatus) => {
    const updated = await updateChannel(channel.id, { status });
    upsertChannel(updated);
  };

  const remove = async (channel: Channel) => {
    if (!confirm(`Delete channel #${channel.name}?`)) return;
    await deleteChannel(channel.id);
    removeChannel(channel.id);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="border-b-2 border-black bg-bg-card px-4 py-3 flex items-center gap-3">
        <div className="w-10 h-10 bg-accent-yellow border-2 border-black rounded flex items-center justify-center font-bold">
          #
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold">Channels</div>
          <div className="text-xs font-mono text-text-secondary truncate">
            {project.display_name ?? project.name} · {projectChannels.length} total
          </div>
        </div>
      </header>

      <TaskStyleChannels
        projectName={projectName}
        channels={projectChannels}
        counts={counts}
        filter={filter}
        onFilter={setFilter}
        onStatus={updateStatus}
        onDelete={remove}
        draggingId={draggingId}
        onDraggingId={setDraggingId}
      />
    </div>
  );
}

function TaskStyleChannels({
  projectName,
  channels,
  counts,
  filter,
  onFilter,
  onStatus,
  onDelete,
  draggingId,
  onDraggingId,
}: {
  projectName: string;
  channels: Channel[];
  counts: Record<FilterKey, number>;
  filter: FilterKey;
  onFilter: (filter: FilterKey) => void;
  onStatus: (channel: Channel, status: ChannelStatus) => Promise<void>;
  onDelete: (channel: Channel) => Promise<void>;
  draggingId: string | null;
  onDraggingId: (id: string | null) => void;
}) {
  const visibleStatuses = filter === 'all' ? CHANNEL_STATUSES : [filter];

  const onDropToStatus = async (status: ChannelStatus, channelId: string) => {
    const channel = channels.find((c) => c.id === channelId);
    if (!channel || channel.status === status) return;
    await onStatus(channel, status);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
      <div className="flex items-center gap-2 px-4 py-3 border-b-2 border-black bg-bg-card">
        <FilterButton active={filter === 'all'} onClick={() => onFilter('all')}>
          All <span className="font-mono text-xs">{counts.all}</span>
        </FilterButton>
        {CHANNEL_STATUSES.map((status) => (
          <FilterButton key={status} active={filter === status} onClick={() => onFilter(status)}>
            {STATUS_BADGE[status].label}{' '}
            {counts[status] > 0 && <span className="font-mono text-xs">{counts[status]}</span>}
          </FilterButton>
        ))}
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div
          className={cn(
            'grid h-full min-w-[980px] gap-3',
            visibleStatuses.length === 1 ? 'grid-cols-1' : 'grid-cols-5',
          )}
        >
          {visibleStatuses.map((status) => {
            const items = channels.filter((channel) => channel.status === status);
            return (
              <StatusColumn
                key={status}
                projectName={projectName}
                status={status}
                channels={items}
                draggingId={draggingId}
                onDraggingId={onDraggingId}
                onDropChannel={onDropToStatus}
                onStatus={onStatus}
                onDelete={onDelete}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatusColumn({
  projectName,
  status,
  channels,
  draggingId,
  onDraggingId,
  onDropChannel,
  onStatus,
  onDelete,
}: {
  projectName: string;
  status: ChannelStatus;
  channels: Channel[];
  draggingId: string | null;
  onDraggingId: (id: string | null) => void;
  onDropChannel: (status: ChannelStatus, channelId: string) => Promise<void>;
  onStatus: (channel: Channel, status: ChannelStatus) => Promise<void>;
  onDelete: (channel: Channel) => Promise<void>;
}) {
  const [over, setOver] = useState(false);
  const badge = STATUS_BADGE[status];

  return (
    <section
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        const channelId = event.dataTransfer.getData('text/plain');
        setOver(false);
        if (channelId) void onDropChannel(status, channelId);
      }}
      className={cn(
        'min-h-0 rounded border-2 border-black bg-bg-main flex flex-col',
        over && draggingId && 'bg-accent-yellow',
      )}
    >
      <div className="flex items-center gap-2 border-b-2 border-black bg-bg-card px-3 py-2">
        <span
          className={cn(
            'px-2 py-0.5 border-2 border-black rounded font-mono text-[10px] font-bold',
            badge.bg,
          )}
        >
          {badge.label}
        </span>
        <span className="font-mono text-xs text-text-secondary">{channels.length}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {channels.length === 0 ? (
          <div className="h-20 rounded border-2 border-dashed border-black/30 flex items-center justify-center text-[11px] font-mono text-text-secondary">
            Drop channels here
          </div>
        ) : (
          channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              projectName={projectName}
              channel={channel}
              draggable
              dragging={draggingId === channel.id}
              onDragStart={() => onDraggingId(channel.id)}
              onDragEnd={() => {
                onDraggingId(null);
                setOver(false);
              }}
              onStatus={onStatus}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ChannelRow({
  projectName,
  channel,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
  onStatus,
  onDelete,
}: {
  projectName: string;
  channel: Channel;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onStatus: (channel: Channel, status: ChannelStatus) => Promise<void>;
  onDelete: (channel: Channel) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const badge = STATUS_BADGE[channel.status];

  const cycleStatus = async () => {
    if (busy) return;
    const idx = CHANNEL_STATUSES.indexOf(channel.status);
    const next = CHANNEL_STATUSES[(idx + 1) % CHANNEL_STATUSES.length]!;
    setBusy(true);
    try {
      await onStatus(channel, next);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onDelete(channel);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', channel.id);
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'flex items-center gap-2 p-2 border-2 border-black rounded bg-bg-card',
        draggable && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-50',
      )}
    >
      <span className="font-mono text-sm text-text-secondary">#</span>
      <button
        onClick={() => void cycleStatus()}
        disabled={busy}
        className={cn(
          'px-2 py-0.5 border-2 border-black rounded font-mono text-[10px] font-bold',
          badge.bg,
          busy && 'opacity-50',
        )}
        title="Click to cycle status"
      >
        {badge.label}
      </button>
      <Link
        to={projectChannelPath(projectName, channel.id)}
        draggable={false}
        className="flex-1 min-w-0 truncate text-sm text-left hover:underline"
        title={`Open #${channel.name}`}
      >
        {channel.name}
      </Link>
      {channel.description && (
        <span className="hidden md:block max-w-[45%] truncate font-mono text-xs text-text-secondary">
          {channel.description}
        </span>
      )}
      <button
        onClick={() => void remove()}
        disabled={busy}
        className="w-6 h-6 flex items-center justify-center border-2 border-black rounded hover:bg-accent-red"
        title="Delete channel"
        aria-label="Delete channel"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
        </svg>
      </button>
    </div>
  );
}

function FilterButton({
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
        'flex items-center gap-1 px-3 py-1.5 border-2 border-black rounded font-bold text-xs',
        active ? 'bg-accent-pink shadow-[2px_2px_0_0_#000]' : 'bg-bg-card hover:bg-accent-yellow',
      )}
    >
      {children}
    </button>
  );
}
