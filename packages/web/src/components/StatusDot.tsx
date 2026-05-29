import type { AgentStatus } from '@openspace/shared';
import { cn } from '../lib/cn';
import { useAgentsStore } from '../stores/agents';

const COLOR_VAR: Record<AgentStatus, string> = {
  idle: 'var(--color-status-online)',
  thinking: 'var(--color-status-thinking)',
  working: 'var(--color-status-working)',
  error: 'var(--color-status-error)',
  stopped: 'var(--color-status-offline)',
};

const TEXT_LABEL: Record<AgentStatus, string> = {
  idle: 'Online',
  thinking: 'Thinking',
  working: 'Working',
  error: 'Error',
  stopped: 'Offline',
};

interface Props {
  status: AgentStatus;
  size?: 'xs' | 'sm';
  className?: string;
  animated?: boolean;
}

export function StatusDot({ status, size = 'sm', className, animated = true }: Props) {
  const dim = size === 'xs' ? 'w-2 h-2' : 'w-2.5 h-2.5';
  const isActive = status === 'thinking' || status === 'working';
  return (
    <span
      className={cn('inline-block rounded-full', dim, animated && isActive && 'animate-pulse', className)}
      style={{ background: COLOR_VAR[status] }}
      title={TEXT_LABEL[status]}
    />
  );
}

export function statusLabel(status: AgentStatus): string {
  return TEXT_LABEL[status];
}

/**
 * AgentStatusDot — 订阅 store 派生状态
 *
 * CP8.3：StatusDot 完全派生自 `agent_runs` 表的 per-channel run（agents.status 已废除）。
 *   - 不传 channelId：取"任意 channel 活跃"的最高优先级状态（Sidebar 用）
 *   - 传 channelId：优先显示该 channel 的 run 状态；无活跃 run 时回落 'idle'
 */
export function AgentStatusDot({
  agentId,
  channelId,
  size = 'xs',
  className,
}: {
  agentId: string;
  channelId?: string;
  size?: 'xs' | 'sm';
  className?: string;
}) {
  const status = useAgentsStore((s) => {
    if (channelId) {
      const perChannel = s.getChannelRunStatus(agentId, channelId);
      if (perChannel) return perChannel as AgentStatus;
    }
    return s.getDerivedStatus(agentId);
  });
  return <StatusDot status={status} size={size} className={className} />;
}
