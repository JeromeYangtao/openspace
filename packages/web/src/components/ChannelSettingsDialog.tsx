/**
 * 频道设置 Dialog — 改名/改描述/删除频道 + 成员管理（添加/移除 agents）
 */

import { useEffect, useState } from 'react';
import type { Agent, Channel } from '@openspace/shared';
import { cn } from '../lib/cn';
import { Dialog } from './Dialog';
import { getChannelAgents, joinChannel, listAgents } from '../lib/api';
import { notifyChannelAgentsChanged } from '../lib/channel-agent-events';
import { Avatar } from './Avatar';

interface Props {
  open: boolean;
  channel: Channel;
  onClose: () => void;
  onUpdated: (c: Channel) => void;
  onDeleted: (id: string) => void;
  /** 初始 tab：members / settings */
  initialTab?: 'members' | 'settings';
}

type Tab = 'members' | 'settings';

export function ChannelSettingsDialog({
  open,
  channel,
  onClose,
  onUpdated,
  onDeleted,
  initialTab = 'settings',
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  return (
    <Dialog
      open={open}
      title={`# ${channel.name.toUpperCase()}`}
      onClose={onClose}
      maxWidth={520}
    >
      <div className="flex border-b-2 border-black">
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
          SETTINGS
        </TabButton>
        <TabButton active={tab === 'members'} onClick={() => setTab('members')}>
          MEMBERS
        </TabButton>
      </div>

      {tab === 'settings' && (
        <SettingsTab
          channel={channel}
          onUpdated={onUpdated}
          onDeleted={(id) => {
            onDeleted(id);
            onClose();
          }}
        />
      )}
      {tab === 'members' && <MembersTab channel={channel} />}
    </Dialog>
  );
}

function SettingsTab({
  channel,
  onUpdated,
  onDeleted,
}: {
  channel: Channel;
  onUpdated: (c: Channel) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(channel.name);
    setDescription(channel.description ?? '');
  }, [channel.id]);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const updated = (await res.json()) as Channel;
      onUpdated(updated);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!confirm(`Delete channel "#${channel.name}"? All messages and tasks will be lost.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/channels/${channel.id}`, { method: 'DELETE' });
      onDeleted(channel.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-5 space-y-4">
      <div>
        <label className="section-header block mb-1.5">NAME</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card focus:outline-none focus:ring-2 focus:ring-accent-pink"
        />
      </div>

      <div>
        <label className="section-header block mb-1.5">DESCRIPTION</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card resize-none focus:outline-none focus:ring-2 focus:ring-accent-pink"
        />
      </div>

      <div className="flex items-center justify-between pt-3 border-t-2 border-black/10">
        <button
          onClick={() => void del()}
          disabled={busy || channel.id === 'general'}
          title={channel.id === 'general' ? 'Cannot delete default channel' : 'Delete channel'}
          className="px-3 py-1.5 border-2 border-black rounded bg-accent-red text-black font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-95"
        >
          Delete Channel
        </button>
        <button
          onClick={() => void save()}
          disabled={busy || !name.trim()}
          className={cn(
            'px-4 py-2 border-2 border-black rounded font-bold',
            !name.trim() || busy
              ? 'bg-[#f5bfd2] opacity-60 cursor-not-allowed'
              : 'bg-accent-pink hover:brightness-105',
          )}
        >
          {busy ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function MembersTab({ channel }: { channel: Channel }) {
  const [projectAgents, setProjectAgents] = useState<Agent[]>([]);
  const [channelAgents, setChannelAgents] = useState<Agent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // D-13：Agent 跟 Project 走，跨 Project 不互通。
  // OTHER AGENTS 列表只包含当前 channel 所属 Project 内、且未加入此 channel 的 agent。
  // channel.project_id 为 null 时（理论上 v1.0 已无此情况，兼容老 channel）退回到全局列表。
  const load = async () => {
    const [scoped, inChannel] = await Promise.all([
      listAgents(channel.project_id ?? undefined),
      getChannelAgents(channel.id),
    ]);
    setProjectAgents(scoped);
    setChannelAgents(inChannel);
  };

  useEffect(() => {
    void load();
  }, [channel.id, channel.project_id]);

  const memberIds = new Set(channelAgents.map((a) => a.id));
  const nonMembers = projectAgents.filter((a) => !memberIds.has(a.id));

  const add = async (agentId: string) => {
    setBusy(agentId);
    try {
      await joinChannel(channel.id, agentId);
      await load();
      notifyChannelAgentsChanged(channel.id);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (agentId: string) => {
    setBusy(agentId);
    try {
      await fetch(`/api/channels/${channel.id}/agents/${agentId}`, { method: 'DELETE' });
      await load();
      notifyChannelAgentsChanged(channel.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-5 space-y-5">
      <div>
        <div className="section-header mb-2">
          IN THIS CHANNEL ({channelAgents.length})
        </div>
        {channelAgents.length === 0 ? (
          <div className="text-text-secondary font-mono text-sm">No agents in this channel.</div>
        ) : (
          <ul className="space-y-1.5">
            {channelAgents.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 p-2 border-2 border-black rounded bg-bg-card"
              >
                <Avatar name={a.name} kind="agent" size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{a.name}</div>
                  {a.description && (
                    <div className="text-[11px] font-mono text-text-secondary truncate">
                      {a.description}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void remove(a.id)}
                  disabled={busy === a.id}
                  className="px-2 py-1 border-2 border-black rounded bg-bg-card text-xs font-bold hover:bg-accent-red disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {nonMembers.length > 0 && (
        <div className="border-t-2 border-black/10 pt-4">
          <div className="section-header mb-2">
            OTHER AGENTS ({nonMembers.length})
          </div>
          <ul className="space-y-1.5">
            {nonMembers.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 p-2 border-2 border-black rounded bg-bg-main"
              >
                <Avatar name={a.name} kind="agent" size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{a.name}</div>
                  {a.description && (
                    <div className="text-[11px] font-mono text-text-secondary truncate">
                      {a.description}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void add(a.id)}
                  disabled={busy === a.id}
                  className="px-2 py-1 border-2 border-black rounded bg-accent-pink text-xs font-bold hover:brightness-105 disabled:opacity-50"
                >
                  + Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
        'flex-1 py-2 text-xs font-bold font-mono border-r-2 border-black last:border-r-0',
        active ? 'bg-accent-yellow' : 'hover:bg-[#f9efc8]',
      )}
    >
      {children}
    </button>
  );
}
