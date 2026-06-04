/**
 * 路由助手（CP8.1 — Project scope 路由）
 *
 * v1.0 路由结构：
 *   /                                根（无 Project 时显示 Welcome；有 Project 时自动进入第一个）
 *   /p/:projectName                  Project 内 index（自动进入第一个 channel）
 *   /p/:projectName/channel/:id      频道
 *   /p/:projectName/dm/:agentId      DM
 *   /p/:projectName/user-dm/:userId  User DM
 *   /p/:projectName/agent/:agentId   Agent Profile（占位）
 *   /threads / /tasks / /saved       全局视图（跨 Project）
 *
 * 旧链接 `/channel/:id` `/dm/:agentId` 由 LegacyRedirect 兜底跳到新路径。
 */

import type { Agent, Channel } from '@openspace/shared';
import { useChannelsStore } from '../stores/channels';
import { useProjectsStore } from '../stores/projects';
import { useAgentsStore } from '../stores/agents';

export function projectIndexPath(projectName: string): string {
  return `/p/${projectName}`;
}

export function projectChannelPath(projectName: string, channelId: string): string {
  return `/p/${projectName}/channel/${channelId}`;
}

export function projectDmPath(projectName: string, agentId: string): string {
  return `/p/${projectName}/dm/${agentId}`;
}

export function projectUserDmPath(projectName: string, userId: string): string {
  return `/p/${projectName}/user-dm/${userId}`;
}

export function projectAgentProfilePath(projectName: string, agentId: string): string {
  return `/p/${projectName}/agent/${agentId}`;
}

export function projectWorkflowsPath(projectName: string): string {
  return `/p/${projectName}/workflows`;
}

export function projectIntelligencePath(projectName: string): string {
  return `/p/${projectName}/intelligence`;
}

export function projectSettingsPath(projectName: string): string {
  return `/p/${projectName}/settings`;
}

/**
 * 根据 channel id 解析完整路径。
 * 优先用 channel.project_id 对应的 project name；若 channel 无 project_id（v0 兼容数据），
 * 退回到 currentProject。两者皆无 → '/'。
 */
export function channelPath(channelId: string): string {
  const channel = findChannel(channelId);
  const projectName = projectNameForChannel(channel);
  if (!projectName) return '/';
  return projectChannelPath(projectName, channelId);
}

/**
 * 根据 agent id 解析 DM 路径。
 * 优先用 agent.project_id 对应的 project name；否则 currentProject。
 */
export function dmPath(agentId: string, explicitProjectName?: string): string {
  if (explicitProjectName) return projectDmPath(explicitProjectName, agentId);
  const projectName = projectNameForAgent(agentId);
  if (!projectName) return '/';
  return projectDmPath(projectName, agentId);
}

export function agentProfilePath(agentId: string, explicitProjectName?: string): string {
  if (explicitProjectName) return projectAgentProfilePath(explicitProjectName, agentId);
  const projectName = projectNameForAgent(agentId);
  if (!projectName) return '/';
  return projectAgentProfilePath(projectName, agentId);
}

function findChannel(channelId: string): Channel | undefined {
  return useChannelsStore.getState().channels.find((c) => c.id === channelId);
}

function findAgent(agentId: string): Agent | undefined {
  return useAgentsStore.getState().agents.find((a) => a.id === agentId);
}

function projectNameForChannel(channel: Channel | undefined): string | null {
  const ps = useProjectsStore.getState();
  if (channel?.project_id) {
    const p = ps.getById(channel.project_id);
    if (p) return p.name;
  }
  return ps.current()?.name ?? null;
}

function projectNameForAgent(agentId: string): string | null {
  const ps = useProjectsStore.getState();
  const agent = findAgent(agentId);
  if (agent?.project_id) {
    const p = ps.getById(agent.project_id);
    if (p) return p.name;
  }
  return ps.current()?.name ?? null;
}
