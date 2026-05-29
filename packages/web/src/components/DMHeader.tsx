/**
 * DM 顶部栏
 * 参考: docs/ui-reference/screenshots/20-dm-architect-desktop.png
 *
 * CP8.2：StatusDot 接 channelId，从 agent_runs 派生 per-channel 状态显示。
 */

import { useSearchParams } from 'react-router-dom';
import type { Agent } from '@openspace/shared';
import { useAgentsStore } from '../stores/agents';
import { Avatar } from './Avatar';
import { AgentStatusDot, statusLabel } from './StatusDot';

interface Props {
  agent: Agent;
  channelId?: string;
}

export function DMHeader({ agent, channelId }: Props) {
  const [params, setParams] = useSearchParams();
  // 派生展示用的 status label：
  // - 若指定 channelId 且该 channel 有活跃 run → 用 run 状态
  // - 否则使用 getDerivedStatus（任意 channel 活跃；都没有 → 'idle'）
  const displayStatus = useAgentsStore((s) => {
    if (channelId) {
      const r = s.getChannelRunStatus(agent.id, channelId);
      if (r) return r;
    }
    return s.getDerivedStatus(agent.id);
  });

  const openProfile = () => {
    const next = new URLSearchParams(params);
    next.set('profile', `agent:${agent.id}`);
    next.set('agentTab', 'profile');
    setParams(next);
  };

  return (
    <div className="border-b-2 border-black bg-bg-card px-4 py-3 flex items-center gap-3">
      <button onClick={openProfile} className="flex items-center gap-3 flex-1 text-left min-w-0 hover:bg-bg-main -mx-2 px-2 py-1 rounded">
        <Avatar name={agent.name} kind="agent" size="md" />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-bold">{agent.name}</span>
          <AgentStatusDot agentId={agent.id} channelId={channelId} size="xs" />
          <span className="text-sm font-mono text-text-secondary">{statusLabel(displayStatus)}</span>
        </div>
      </button>
    </div>
  );
}
