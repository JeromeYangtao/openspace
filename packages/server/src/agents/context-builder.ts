/**
 * ContextBuilder — 为 Agent 构建 CLI 输入 prompt
 *
 * 输入（按 D-4 token 预算）:
 *   1. Project Goal + Team Rules (D-14)      → 顶层注入
 *   2. Knowledge（lessons + decisions，按 audience 过滤；CP5 / D-20 Reuse Loop）
 *   3. Agent description (system prompt)    → DESCRIPTION_BUDGET
 *   4. 团队成员列表（可 @mention 谁）
 *   5. 对话历史（按 channel / thread）        → HISTORY_BUDGET
 *   6. 当前触发消息                           → CURRENT_MESSAGE_BUDGET
 *
 * Token 估算用 "4 字符 ≈ 1 token" 粗估（避免引入 tokenizer 依赖）
 */

import {
  CHARS_PER_TOKEN,
  DESCRIPTION_BUDGET,
  HISTORY_BUDGET,
} from '@openspace/shared';
import type {
  Agent,
  ChatMessage,
  Decision,
  Lesson,
  Project,
} from '@openspace/shared';

export interface BuildContextInput {
  /** 被触发的目标 agent */
  targetAgent: Agent;
  /** 同频道内其他 Agent（team 成员列表） */
  teamAgents: Agent[];
  /** 历史消息（最新在最后） */
  history: ChatMessage[];
  /** 当前触发此 agent 的消息（包含 @mention） */
  triggerMessage: ChatMessage;
  /** 用户显示名 */
  localUserName?: string;
  /** v1.0 / D-14：注入项目 goal + team_rules */
  project?: Project | null;
  /** Sprint 4 CP5：注入项目 knowledge（已 audience 过滤） */
  lessons?: Lesson[];
  decisions?: Decision[];
}

export interface BuiltContext {
  prompt: string;
  estimatedTokens: number;
}

const tokensOf = (s: string): number => Math.ceil(s.length / CHARS_PER_TOKEN);

export function buildContext(input: BuildContextInput): BuiltContext {
  const {
    targetAgent,
    teamAgents,
    history,
    triggerMessage,
    localUserName = 'User',
    project,
    lessons = [],
    decisions = [],
  } = input;

  // === 0. Project Goal + Team Rules（D-14 顶部注入）===
  const goalBlock = project?.goal
    ? [
        '## Project Goal',
        project.goal.trim(),
      ].join('\n')
    : '';
  const rulesBlock = project?.team_rules?.trim()
    ? ['## Team Rules', project.team_rules.trim()].join('\n')
    : '';

  // === 1. Knowledge（CP5 / D-20）：注入相关 lessons + decisions ===
  const knowledgeBlock = buildKnowledgeBlock(targetAgent, lessons, decisions);

  // === 2. Agent description（system prompt）===
  let description = targetAgent.description?.trim() ?? '';
  if (!description) {
    description = `You are ${targetAgent.name}, a helpful AI assistant.`;
  }
  description = truncateMiddle(description, DESCRIPTION_BUDGET * CHARS_PER_TOKEN);

  // === 3. 团队成员列表 ===
  const others = teamAgents.filter((a) => a.id !== targetAgent.id);
  const teamLines =
    others.length > 0
      ? [
          '',
          'Available team members (use @mention ONLY if you need them to take concrete action):',
          ...others.map((a) => {
            const role = a.description
              ? a.description.split(/[。.\n]/)[0]?.slice(0, 50) ?? ''
              : '';
            return `  - @${a.name}${role ? ` — ${role}` : ''}`;
          }),
        ].join('\n')
      : '';

  // === 4. 对话历史 ===
  const historyLines = buildHistoryLines(history, localUserName);
  const historyBudgetChars = HISTORY_BUDGET * CHARS_PER_TOKEN;
  const trimmedHistory = trimHistoryFromEnd(historyLines, historyBudgetChars);

  // === 5. 当前触发消息 ===
  const senderLabel =
    triggerMessage.sender_type === 'agent'
      ? `@${teamAgents.find((a) => a.id === triggerMessage.sender_id)?.name ?? 'Agent'}`
      : localUserName;
  const triggerLine = `[${senderLabel}] ${triggerMessage.content}`;

  // === 拼接最终 prompt ===
  const sections = [
    goalBlock,
    rulesBlock,
    knowledgeBlock,
    `## Your role`,
    description,
    teamLines,
    '',
    '## Conversation history',
    trimmedHistory.length > 0 ? trimmedHistory.join('\n') : '(no prior messages)',
    '',
    '## Current message (please respond to this)',
    triggerLine,
    '',
    '## Response guidelines',
    `- Respond as ${targetAgent.name}. Be concise and focused on the user's intent.`,
    `- Do NOT @mention other agents for politeness, greetings, acknowledgments, or self-introductions.`,
    `- Only @mention another agent when you explicitly need them to perform a concrete task or review.`,
    `- Never @mention the user to keep the conversation going — stop when you've answered.`,
    `- If you have nothing new to add or the conversation is resolved, keep your reply short and do not @mention anyone.`,
    `- Never use \`@all\`, \`@everyone\`, \`@channel\`, or \`@所有人\` — these are reserved for the human user. If you need help, @ a specific agent by name.`,
  ];

  const prompt = sections.filter((s) => s !== '').join('\n');

  return {
    prompt,
    estimatedTokens: tokensOf(prompt),
  };
}

/**
 * 构造 Knowledge 注入 block（CP5）
 *
 * 取已 approved 且 audience 匹配（all / team / agent.name / agent.id）的最近 N 条；
 * lessons 按 use_count 优先（已经在 repo 端 ORDER BY），decisions 直接按时间倒序取前 5。
 */
function buildKnowledgeBlock(
  agent: Agent,
  lessons: Lesson[],
  decisions: Decision[],
): string {
  if (lessons.length === 0 && decisions.length === 0) return '';

  const lines: string[] = [];

  if (decisions.length > 0) {
    lines.push('## Project Decisions');
    for (const d of decisions.slice(0, 5)) {
      lines.push(`- ${d.title}: ${truncateOneLine(d.body, 200)}`);
    }
  }

  if (lessons.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('## Lessons (apply these proactively)');
    const limit = 12;
    for (const l of lessons.slice(0, limit)) {
      const tag = l.kind === 'dont' ? "DON'T" : l.kind.toUpperCase();
      const tags = l.tags.length > 0 ? ` [${l.tags.join(', ')}]` : '';
      lines.push(`- [${tag}] ${l.title}: ${truncateOneLine(l.body, 200)}${tags}`);
    }
    if (lessons.length > limit) {
      lines.push(`- (+${lessons.length - limit} more lessons not shown)`);
    }
  }

  // unused parameter agent kept for future per-agent specialization
  void agent;
  return lines.join('\n');
}

function truncateOneLine(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function buildHistoryLines(history: ChatMessage[], localUserName: string): string[] {
  return history.map((m) => {
    let speaker: string;
    if (m.sender_type === 'user') speaker = localUserName;
    else if (m.sender_type === 'system') speaker = 'system';
    else speaker = `Agent:${m.sender_id ?? 'unknown'}`;
    return `[${speaker}] ${m.content}`;
  });
}

/** 从尾部开始保留消息，直到累计字符数接近预算 */
function trimHistoryFromEnd(lines: string[], budgetChars: number): string[] {
  const result: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const cost = line.length + 1; // \n
    if (used + cost > budgetChars) break;
    result.unshift(line);
    used += cost;
  }
  return result;
}

function truncateMiddle(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  const keep = Math.floor((maxChars - 3) / 2);
  return s.slice(0, keep) + '...' + s.slice(s.length - keep);
}
