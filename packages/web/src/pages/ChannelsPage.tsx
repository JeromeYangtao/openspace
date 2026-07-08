import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { Channel, ChannelStatus } from '@openspace/shared';
import { CHANNEL_STATUSES } from '@openspace/shared';
import { cn } from '../lib/cn';
import { deleteChannel, updateChannel } from '../lib/api';
import { projectChannelPath } from '../lib/routes';
import { useChannelsStore } from '../stores/channels';
import { useProjectsStore } from '../stores/projects';

const STATUS_BADGE: Record<ChannelStatus, { label: string; bg: string }> = {
  pending: { label: 'PENDING', bg: 'bg-accent-orange' },
  active: { label: 'ACTIVE', bg: 'bg-accent-cyan' },
  review: { label: 'REVIEW', bg: 'bg-accent-purple' },
  done: { label: 'DONE', bg: 'bg-[#b8e98c]' },
  cancel: { label: 'CANCEL', bg: 'bg-red-300' },
};

function isSystemChannel(channel: Channel): boolean {
  return channel.id === 'general' || channel.name === 'general';
}

export function ChannelsPage() {
  const { projectName } = useParams<{ projectName: string }>();
  const projects = useProjectsStore((s) => s.projects);
  const channels = useChannelsStore((s) => s.channels);
  const upsertChannel = useChannelsStore((s) => s.upsert);
  const removeChannel = useChannelsStore((s) => s.remove);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  const project = useMemo(
    () => projects.find((p) => p.name === projectName) ?? null,
    [projects, projectName],
  );

  const projectChannels = useMemo(() => {
    if (!project) return [];
    return channels
      .filter((c) => c.type === 'channel')
      .filter((c) => !isSystemChannel(c))
      .filter((c) => c.project_id === project.id || !c.project_id)
      .sort((a, b) => a.created_at - b.created_at);
  }, [channels, project]);

  const selectedChannel = useMemo(
    () => projectChannels.find((channel) => channel.id === selectedChannelId) ?? null,
    [projectChannels, selectedChannelId],
  );

  if (!project || !projectName) return <Navigate to="/" replace />;

  const updateStatus = async (channel: Channel, status: ChannelStatus) => {
    const updated = await updateChannel(channel.id, { status });
    upsertChannel(updated);
  };

  const remove = async (channel: Channel) => {
    if (!confirm(`Delete channel #${channel.name}?`)) return;
    await deleteChannel(channel.id);
    removeChannel(channel.id);
    if (selectedChannelId === channel.id) setSelectedChannelId(null);
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

      <div className="flex-1 flex min-h-0 min-w-0">
        <TaskStyleChannels
          projectName={projectName}
          channels={projectChannels}
          onStatus={updateStatus}
          onDelete={remove}
          onSelect={(channel) => setSelectedChannelId(channel.id)}
          selectedChannelId={selectedChannelId}
          draggingId={draggingId}
          onDraggingId={setDraggingId}
        />
        {selectedChannel && (
          <ChannelInfoDrawer
            projectName={projectName}
            channel={selectedChannel}
            onClose={() => setSelectedChannelId(null)}
          />
        )}
      </div>
    </div>
  );
}

function TaskStyleChannels({
  projectName,
  channels,
  onStatus,
  onDelete,
  onSelect,
  selectedChannelId,
  draggingId,
  onDraggingId,
}: {
  projectName: string;
  channels: Channel[];
  onStatus: (channel: Channel, status: ChannelStatus) => Promise<void>;
  onDelete: (channel: Channel) => Promise<void>;
  onSelect: (channel: Channel) => void;
  selectedChannelId: string | null;
  draggingId: string | null;
  onDraggingId: (id: string | null) => void;
}) {
  const onDropToStatus = async (status: ChannelStatus, channelId: string) => {
    const channel = channels.find((c) => c.id === channelId);
    if (!channel || channel.status === status) return;
    await onStatus(channel, status);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div className="grid h-full min-w-[980px] grid-cols-5 gap-3">
          {CHANNEL_STATUSES.map((status) => {
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
                onDelete={onDelete}
                onSelect={onSelect}
                selectedChannelId={selectedChannelId}
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
  onDelete,
  onSelect,
  selectedChannelId,
}: {
  projectName: string;
  status: ChannelStatus;
  channels: Channel[];
  draggingId: string | null;
  onDraggingId: (id: string | null) => void;
  onDropChannel: (status: ChannelStatus, channelId: string) => Promise<void>;
  onDelete: (channel: Channel) => Promise<void>;
  onSelect: (channel: Channel) => void;
  selectedChannelId: string | null;
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
              onDelete={onDelete}
              onSelect={onSelect}
              selected={selectedChannelId === channel.id}
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
  onDelete,
  onSelect,
  selected = false,
}: {
  projectName: string;
  channel: Channel;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDelete: (channel: Channel) => Promise<void>;
  onSelect: (channel: Channel) => void;
  selected?: boolean;
}) {
  const [busy, setBusy] = useState(false);

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
        selected && 'bg-accent-pink',
      )}
    >
      <span className="font-mono text-sm text-text-secondary">#</span>
      <button
        type="button"
        onClick={() => onSelect(channel)}
        className="flex-1 min-w-0 truncate text-sm text-left hover:underline"
        title={`Show #${channel.name} details`}
      >
        {channel.name}
      </button>
      {channel.description && (
        <span className="hidden md:block max-w-[45%] truncate font-mono text-xs text-text-secondary">
          {channel.description}
        </span>
      )}
      <Link
        to={projectChannelPath(projectName, channel.id)}
        draggable={false}
        className="w-6 h-6 flex items-center justify-center border-2 border-black rounded hover:bg-accent-yellow"
        title="Open channel"
        aria-label="Open channel"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M7 17L17 7" />
          <path d="M7 7h10v10" />
        </svg>
      </Link>
      <button
        type="button"
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

function ChannelInfoDrawer({
  projectName,
  channel,
  onClose,
}: {
  projectName: string;
  channel: Channel;
  onClose: () => void;
}) {
  const badge = STATUS_BADGE[channel.status];

  return (
    <aside className="w-96 border-l-2 border-black bg-bg-main flex flex-col h-full min-w-0">
      <header className="border-b-2 border-black bg-bg-card px-3 py-2 flex items-center gap-2">
        <div className="w-8 h-8 bg-accent-yellow border-2 border-black rounded flex items-center justify-center font-bold">
          #
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold truncate text-sm">{channel.name}</div>
          <div className="text-[11px] font-mono text-text-secondary truncate">channel</div>
        </div>
        <Link
          to={projectChannelPath(projectName, channel.id)}
          className="w-7 h-7 flex items-center justify-center border-2 border-black rounded bg-bg-card hover:bg-accent-yellow"
          title="Open channel"
          aria-label="Open channel"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M7 17L17 7" />
            <path d="M7 7h10v10" />
          </svg>
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center border-2 border-black rounded bg-bg-card hover:bg-accent-yellow"
          title="Close"
          aria-label="Close"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <div className="section-header mb-2">STATUS</div>
          <span
            className={cn(
              'inline-flex px-2 py-1 border-2 border-black rounded font-mono text-[11px] font-bold',
              badge.bg,
            )}
          >
            {badge.label}
          </span>
        </div>

        <InfoBlock label="NAME" value={`# ${channel.name}`} />
        <InfoBlock label="TYPE" value={channel.type} />
        <InfoBlock label="CREATED" value={new Date(channel.created_at).toLocaleString()} />

        <div>
          <div className="section-header mb-2">DESCRIPTION</div>
          <div className="border-2 border-black rounded bg-bg-card p-3 text-sm whitespace-pre-wrap min-h-20">
            {channel.description || (
              <span className="text-text-secondary font-mono text-xs">No description</span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="section-header mb-1">{label}</div>
      <div className="font-mono text-sm border-2 border-black/20 rounded bg-bg-card px-2 py-1 truncate">
        {value}
      </div>
    </div>
  );
}
