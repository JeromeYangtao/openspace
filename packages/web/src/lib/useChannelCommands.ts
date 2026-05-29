/**
 * useChannelCommands — 派生该 channel 可用的 / 命令
 *
 * - 来自 workflows store 的 trigger_command（按当前 channel 的 project 过滤）
 * - thread 内额外加 /approve /reject /abort
 */

import { useMemo } from 'react';
import { useChannelsStore } from '../stores/channels';
import { useWorkflowsStore } from '../stores/workflows';
import type { CommandHint } from '../components/MessageInput';

export function useChannelCommands(
  channelId: string | null | undefined,
  inThread: boolean,
): CommandHint[] {
  const channels = useChannelsStore((s) => s.channels);
  const workflowsByProject = useWorkflowsStore((s) => s.workflowsByProject);

  return useMemo(() => {
    const channel = channelId ? channels.find((c) => c.id === channelId) : null;
    const projectId = channel?.project_id ?? null;
    const wfs = projectId ? workflowsByProject.get(projectId) ?? [] : [];

    const hints: CommandHint[] = wfs.map((w) => ({
      name: w.trigger_command,
      description: w.description ?? w.name,
    }));

    if (inThread) {
      hints.push({ name: '/approve', description: 'Approve current step' });
      hints.push({
        name: '/reject',
        description: 'Reject current step (with optional reason)',
      });
      hints.push({
        name: '/override',
        description: 'Skip current approval step (with optional reason)',
      });
      hints.push({ name: '/abort', description: 'Abort the workflow run' });
    }
    // /comment 在 thread 与主线均可用
    hints.push({
      name: '/comment',
      description: 'Add a side note (no workflow effect)',
    });
    if (inThread) {
      hints.push({
        name: '/sediment',
        description: 'Ask Scribe to extract decisions / lessons from this thread',
      });
    }
    return hints;
  }, [channelId, channels, workflowsByProject, inThread]);
}
