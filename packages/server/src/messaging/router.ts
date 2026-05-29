/**
 * Message Router — 处理用户/Agent 发送的消息
 *
 * 流程:
 *   1. 解析 @mention 找到目标 agent 名
 *   2. 将消息写入 DB（user / agent 发送，含 metadata.mentions）
 *   3. 广播 `message` 事件给频道订阅者
 *   4. 对每个 @mention 匹配到的 agent，调用 AgentEngine.trigger
 *      （并发执行；Engine 内部有队列限制）
 *   5. Agent 响应完成后，继续解析其回复中的 @mention → 链式触发
 *      - 深度 >= MAX_CHAIN_DEPTH → 停止
 *      - 同 agent 在同 thread 连续触发 > MAX_AGENT_CONSECUTIVE_TRIGGERS → 停止
 */

import type { Database } from 'better-sqlite3';
import type { Agent, ChatMessage, MessageMetadata, SystemEvent } from '@openspace/shared';
import {
  LOCAL_USER_ID,
  MAX_AGENT_CONSECUTIVE_TRIGGERS,
  MAX_CHAIN_DEPTH,
  MAX_MENTIONS_PER_MESSAGE,
} from '@openspace/shared';
import {
  agentRunJobRepo,
  agentRepo,
  messageRepo,
  taskRepo,
  workflowRepo,
  workflowRunRepo,
} from '../db/repos.js';
import { hub } from '../ws/hub.js';
import type { TriggerResult } from '../agents/engine.js';
import { isEveryoneMention, parseMentions } from './mentions.js';
import {
  abortWorkflowRun,
  advanceWithUserAction,
  overrideWorkflowRun,
  startWorkflowRun,
} from '../workflows/runner.js';
import { persistScribeOutput, runScribe } from '../system-agents/scribe.js';

export interface MessageRouterDeps {
  db: Database;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

export interface RouteUserMessageInput {
  channelId: string;
  content: string;
  /** 若在 Thread 内回复 */
  threadId?: string;
  /** 同时创建任务 */
  asTask?: boolean;
}

/**
 * 处理用户发送的消息（来自 WebSocket send_message）
 */
export async function routeUserMessage(
  input: RouteUserMessageInput,
  deps: MessageRouterDeps,
): Promise<void> {
  const { db, logger } = deps;
  const { channelId, content, threadId, asTask } = input;

  if (!content.trim()) return;

  // 1. 解析 @mention（用户消息允许 @all 展开为全员）
  const mentions = parseMentions(content);
  const resolved = await resolveMentionsToAgents(
    db,
    channelId,
    mentions.map((m) => m.name),
    { allowEveryone: true },
  );
  const mentionsInChannel = resolved.agents;

  // 2. 落库 user message
  const metadata: MessageMetadata = {
    mentions: mentions.map((m) => ({
      name: m.name,
      // @all 等别名 agent_id=null（不绑到具体 agent；前端可特殊渲染）
      agent_id: isEveryoneMention(m.name)
        ? null
        : mentionsInChannel.find((a) => a.name === m.name)?.id ?? null,
    })),
    chain_depth: 0,
  };
  const userMsg = messageRepo.create(db, {
    channel_id: channelId,
    sender_type: 'user',
    sender_id: LOCAL_USER_ID,
    content,
    metadata,
    parent_id: threadId ?? null,
  });

  // Sprint 2 CP4：先广播用户消息再做 command/workflow 处理，确保 UI 顺序对齐
  hub.broadcast(channelId, { type: 'message', message: userMsg });

  // 2a. 命令分发（/command）
  const cmd = parseCommand(content);
  if (cmd) {
    const handled = await handleCommand({
      db,
      logger,
      channelId,
      threadId,
      userMsg,
      cmd,
    });
    if (handled) return;
  }
  // 重新发一次 user msg 太蠢；上面已经广播过；这里重新走 task / mention 流程 —
  // 不再 broadcast 第二次。下面段落删除原来的 broadcast 调用。

  // 2b. 如果 as_task=true，基于此消息建一个 task
  if (asTask) {
    const title = content.replace(/\s+/g, ' ').trim().slice(0, 200);
    const firstMention = mentionsInChannel[0];
    const task = taskRepo.create(db, {
      channel_id: channelId,
      title,
      assignee_agent_id: firstMention?.id ?? null,
      created_by: LOCAL_USER_ID,
      source_message_id: userMsg.id,
    });
    const sysContent = `📝 1 new task created: #${task.id} "${task.title}"`;
    const sysMsg = messageRepo.create(db, {
      channel_id: channelId,
      sender_type: 'system',
      sender_id: LOCAL_USER_ID,
      content: sysContent,
      metadata: {
        system_event: { type: 'task_created', task_id: task.id, title: task.title },
        task_ref: {
          id: task.id,
          title: task.title,
          status: task.status,
          assignee_agent_id: task.assignee_agent_id,
        },
      },
      parent_id: threadId ?? null,
    });
    hub.broadcast(channelId, { type: 'message', message: sysMsg });
    hub.broadcast(channelId, { type: 'task_update', task });
  }

  // 3. user msg 已在 step 2 末尾广播；继续触发 @mention agents

  // 4. 触发被 @mention 的 agents（并发）
  if (mentionsInChannel.length === 0) {
    logger.info(`[router] no agent mentions in message ${userMsg.id}`);
    // 频道里有 agent 但用户没 @ 任何一个 → 给一条系统提示，避免新用户困惑
    // 仅当频道里真的有 agent 时才提示（DM / 空频道无意义）
    const channelAgents = agentRepo.listInChannel(db, channelId);
    if (channelAgents.length > 0 && !threadId) {
      const sample = channelAgents
        .slice(0, 2)
        .map((a) => `@${a.name}`)
        .join(' / ');
      emitInfoMessage(
        db,
        channelId,
        null,
        `ℹ 没有 agent 被 @ 到。试试 ${sample}，或用 \`@all\` 让所有 agent 响应。`,
      );
    }
    return;
  }

  // @all 展开后豁免 MAX_MENTIONS_PER_MESSAGE 截断（用户显式意图，并发由队列保护）；
  // 否则按原规则截断防滥用。
  if (
    !resolved.expandedFromEveryone &&
    mentionsInChannel.length > MAX_MENTIONS_PER_MESSAGE
  ) {
    logger.warn(
      `[router] message has ${mentionsInChannel.length} mentions, truncating to ${MAX_MENTIONS_PER_MESSAGE}`,
    );
    mentionsInChannel.length = MAX_MENTIONS_PER_MESSAGE;
  }
  if (resolved.expandedFromEveryone) {
    logger.info(
      `[router] @all/@everyone expanded to ${mentionsInChannel.length} agent(s) in channel ${channelId}`,
    );
  }

  // Thread 策略（与 slock.ai 对齐）：
  //   - 用户消息在 thread 内 @mention → agent 回复在同 thread
  //   - 用户消息在主线 @mention       → agent 回复**也在主线**（不创建 thread）
  //   - Thread 只在链式触发（agent 回复里 @mention）时由 safeTriggerChain 创建
  const replyParentId: string | undefined = threadId;

  for (const agent of mentionsInChannel) {
    enqueueAgentRunJob(
      agent,
      {
        channelId,
        triggerMessage: userMsg,
        parentMessageId: replyParentId,
        chainDepth: 1,
      },
      deps,
    );
  }
}

/**
 * 入队 agent run。真正执行由后台 run worker 完成。
 * 自带防护：深度与连续触发限制
 */
export function enqueueAgentRunJob(
  agent: Agent,
  ctx: {
    channelId: string;
    triggerMessage: ChatMessage;
    parentMessageId?: string;
    chainDepth: number;
  },
  deps: MessageRouterDeps,
): void {
  const { db, logger } = deps;

  // 深度检查
  if (ctx.chainDepth > MAX_CHAIN_DEPTH) {
    logger.warn(`[router] chain depth ${ctx.chainDepth} exceeds max, stopping`);
    emitSystemMessage(db, ctx.channelId, ctx.parentMessageId ?? null, {
      type: 'chain_limit_reached',
      channel_id: ctx.channelId,
      detail: `Chain depth limit (${MAX_CHAIN_DEPTH}) reached`,
    });
    return;
  }

  // 同 agent 连续触发检查（仅在 thread 内检查）
  // 策略：静默忽略（不 emit warning message），让 LLM 的"礼貌 @mention"不再污染聊天
  if (ctx.parentMessageId) {
    const thread = messageRepo.listThread(db, ctx.parentMessageId);
    const recentAgentMsgs = thread.slice(-MAX_AGENT_CONSECUTIVE_TRIGGERS * 2).filter(
      (m) => m.sender_type === 'agent' && m.sender_id === agent.id,
    );
    if (recentAgentMsgs.length >= MAX_AGENT_CONSECUTIVE_TRIGGERS) {
      logger.warn(
        `[router] skipping ${agent.name}: already triggered ${recentAgentMsgs.length}x in this thread (likely a politeness loop)`,
      );
      // 静默 return，不产出系统消息 — 让循环自然终止而不污染聊天
      return;
    }
  }

  const job = agentRunJobRepo.enqueue(db, {
    agent_id: agent.id,
    channel_id: ctx.channelId,
    trigger_message_id: ctx.triggerMessage.id,
    parent_message_id: ctx.parentMessageId ?? null,
    chain_depth: ctx.chainDepth,
  });
  logger.info(`[router] queued ${agent.name} as run job #${job.id}`);
}

/**
 * Agent run 完成后，解析回复中的 @mention → 继续入队链式触发。
 */
export async function enqueueChainedAgentRuns(
  agent: Agent,
  ctx: {
    channelId: string;
    parentMessageId?: string;
    chainDepth: number;
  },
  result: TriggerResult,
  deps: MessageRouterDeps,
): Promise<void> {
  const { db, logger } = deps;

  if (!result.ok || !result.fullText) return;

  // 解析 agent 回复中的 @mention → 链式触发
  const replyMentions = parseMentions(result.fullText);
  if (replyMentions.length === 0) return;

  // Sprint 4-ext：链式中显式禁用 @all/@everyone（仅用户消息允许）。
  // 否则 agent A 回复一句 "@all 大家来帮我" → 触发 N 个 agent → 每个回复又可能 @all → 雪崩。
  // 静默忽略 @all 别名，仍允许 agent 显式 @ 具体 agent 协作。
  const chainResolved = await resolveMentionsToAgents(
    db,
    ctx.channelId,
    replyMentions.map((m) => m.name),
    { allowEveryone: false },
  );
  if (chainResolved.everyoneBlocked) {
    logger.warn(
      `[router] ${agent.name} tried to @all in reply (chain depth ${ctx.chainDepth}); ignored`,
    );
  }

  // 排除自己（避免 A @A 死循环第一层）
  const nextTargets = chainResolved.agents.filter((a) => a.id !== agent.id);

  if (nextTargets.length === 0) return;

  logger.info(
    `[router] chain: ${agent.name} mentioned ${nextTargets.map((a) => a.name).join(', ')} (depth=${ctx.chainDepth + 1})`,
  );

  // Thread 升级策略：
  //   - 如果当前已在 thread 内 (ctx.parentMessageId !== undefined) → 保持同 thread
  //   - 否则（主线直接回复，链式触发要进 thread）→ 把 agent 的主线消息作为 thread 根
  const nextParentId =
    ctx.parentMessageId ?? result.agentReplyMessage.id;

  for (const next of nextTargets.slice(0, MAX_MENTIONS_PER_MESSAGE)) {
    enqueueAgentRunJob(
      next,
      {
        channelId: ctx.channelId,
        triggerMessage: result.agentReplyMessage,
        parentMessageId: nextParentId,
        chainDepth: ctx.chainDepth + 1,
      },
      deps,
    );
  }
}

// =============================================================================
// Command parsing & dispatch (Sprint 2 CP3 / CP4)
// =============================================================================

const COMMAND_RE = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/;
const CONTROL_COMMANDS = new Set([
  '/approve',
  '/reject',
  '/abort',
  '/comment',
  '/override',
  '/sediment',
]);

interface ParsedCommand {
  /** 含前导斜杠，如 "/new-feature" */
  name: string;
  /** 命令尾巴去掉 cmd 后的内容，可能为空字符串 */
  args: string;
}

export function parseCommand(content: string): ParsedCommand | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('/')) return null;
  const m = COMMAND_RE.exec(trimmed);
  if (!m) return null;
  return {
    name: `/${m[1]}`,
    args: (m[2] ?? '').trim(),
  };
}

/**
 * 处理 / 开头的命令；返回 true 表示已处理（caller 跳过默认 mention 流程）。
 *
 * 支持：
 *   - 控制命令 /approve /reject /abort：作用于当前 thread 内的活跃 workflow_run
 *   - 自定义 trigger：匹配 workflows.trigger_command → startWorkflowRun
 */
async function handleCommand(input: {
  db: Database;
  logger: MessageRouterDeps['logger'];
  channelId: string;
  threadId?: string;
  userMsg: ChatMessage;
  cmd: ParsedCommand;
}): Promise<boolean> {
  const { db, logger, channelId, threadId, userMsg, cmd } = input;

  if (CONTROL_COMMANDS.has(cmd.name)) {
    return handleControlCommand({ db, logger, channelId, threadId, cmd });
  }

  // 普通命令 → 看是否匹配 workflow trigger（per-project db 内）
  const wf = workflowRepo.getByTrigger(db, cmd.name);
  if (!wf) return false;

  try {
    await startWorkflowRun(
      db,
      {
        workflow_id: wf.id,
        channel_id: channelId,
        started_by: LOCAL_USER_ID,
        trigger_message_id: userMsg.id,
        initial_input: cmd.args || undefined,
      },
      logger,
    );
  } catch (e) {
    const msg = (e as Error).message;
    logger.error(`[router] failed to start workflow ${wf.name}: ${msg}`);
    emitInfoMessage(db, channelId, threadId ?? null, `⚠ Failed to start workflow: ${msg}`);
  }
  return true;
}

async function handleControlCommand(input: {
  db: Database;
  logger: MessageRouterDeps['logger'];
  channelId: string;
  threadId?: string;
  cmd: ParsedCommand;
}): Promise<boolean> {
  const { db, logger, channelId, threadId, cmd } = input;

  // /comment 只是留批注；不依赖活跃 workflow run
  if (cmd.name === '/comment') {
    if (!cmd.args) {
      emitInfoMessage(
        db,
        channelId,
        threadId ?? null,
        'ℹ /comment expects a message, e.g. "/comment please double-check the migration".',
      );
      return true;
    }
    emitInfoMessage(db, channelId, threadId ?? null, `💬 ${cmd.args}`);
    return true;
  }

  // /sediment 手动触发 Scribe（仅 thread 内有意义；CP3）
  if (cmd.name === '/sediment') {
    if (!threadId) {
      emitInfoMessage(
        db,
        channelId,
        null,
        'ℹ /sediment only works inside a thread.',
      );
      return true;
    }
    void manualSediment({ db, channelId, threadId, reason: cmd.args || undefined }).catch(
      (e) => logger.error(`[router] /sediment failed: ${(e as Error).message}`),
    );
    emitInfoMessage(
      db,
      channelId,
      threadId,
      '📚 Scribe is reviewing this thread… results will appear in Intelligence.',
    );
    return true;
  }

  if (!threadId) {
    emitInfoMessage(db, channelId, null, `ℹ ${cmd.name} only works inside a workflow thread.`);
    return true;
  }

  const run = workflowRunRepo.getActive(db, channelId, threadId);
  if (!run) {
    emitInfoMessage(db, channelId, threadId, 'ℹ No active workflow in this thread.');
    return true;
  }

  if (cmd.name === '/approve' || cmd.name === '/reject') {
    if (run.status !== 'awaiting_approval') {
      emitInfoMessage(
        db,
        channelId,
        threadId,
        `ℹ Workflow is currently "${run.status}", not awaiting approval.`,
      );
      return true;
    }
    try {
      await advanceWithUserAction(
        db,
        run.id,
        cmd.name === '/approve' ? 'approve' : 'reject',
        cmd.name === '/reject' ? cmd.args || undefined : undefined,
        logger,
      );
    } catch (e) {
      logger.error(`[router] advance failed: ${(e as Error).message}`);
      emitInfoMessage(db, channelId, threadId, `⚠ ${cmd.name} failed: ${(e as Error).message}`);
    }
    return true;
  }

  if (cmd.name === '/override') {
    try {
      const res = await overrideWorkflowRun(db, run.id, cmd.args || undefined, logger);
      if (!res.ok) {
        emitInfoMessage(
          db,
          channelId,
          threadId,
          `ℹ /override: ${res.reason ?? 'not allowed'}`,
        );
      }
    } catch (e) {
      logger.error(`[router] override failed: ${(e as Error).message}`);
      emitInfoMessage(db, channelId, threadId, `⚠ /override failed: ${(e as Error).message}`);
    }
    return true;
  }

  if (cmd.name === '/abort') {
    try {
      abortWorkflowRun(db, run.id, cmd.args || 'aborted by user');
    } catch (e) {
      logger.error(`[router] abort failed: ${(e as Error).message}`);
      emitInfoMessage(db, channelId, threadId, `⚠ /abort failed: ${(e as Error).message}`);
    }
    return true;
  }

  return false;
}

function emitInfoMessage(
  db: Database,
  channelId: string,
  parentId: string | null,
  content: string,
): void {
  const sysMsg = messageRepo.create(db, {
    channel_id: channelId,
    sender_type: 'system',
    sender_id: LOCAL_USER_ID,
    content,
    metadata: null,
    parent_id: parentId,
  });
  hub.broadcast(channelId, { type: 'message', message: sysMsg });
}

/**
 * 用户 /sediment <reason> 时手动触发 Scribe 处理当前 thread。
 * fire-and-forget；处理完毕在 Intelligence Tab 出 pending 条目。
 */
async function manualSediment(input: {
  db: Database;
  channelId: string;
  threadId: string;
  reason?: string;
}): Promise<void> {
  const { db, channelId, threadId, reason } = input;
  const threadMessages = messageRepo.listThread(db, threadId);
  if (threadMessages.length === 0) return;
  const projectAgents = agentRepo.list(db);
  const roleMap: Record<string, string> = {};
  for (const a of projectAgents) {
    roleMap[a.id] = a.name;
  }

  const output = await runScribe({
    trigger: { kind: 'manual', reason },
    thread_messages: threadMessages,
    agent_role_map: roleMap,
  });

  if (output.is_fallback) {
    emitInfoMessage(
      db,
      channelId,
      threadId,
      `⚠ Scribe failed: ${output.fallback_reason ?? 'unknown'}`,
    );
    return;
  }

  // 找该 thread 上是否绑定了 workflow_run；有则关联
  const run = workflowRunRepo.getActive(db, channelId, threadId);
  const persisted = persistScribeOutput(db, output, {
    source_run_id: run?.id ?? null,
  });
  emitInfoMessage(
    db,
    channelId,
    threadId,
    `📚 Scribe sedimented ${persisted.decisions.length} decision(s) + ${persisted.lessons.length} lesson(s) — review in Intelligence.`,
  );
}

/**
 * 解析 mention 名字 → channel 内的 agent。
 *
 * Sprint 4-ext：支持 `@all` / `@everyone` / `@所有人` 展开为 channel 全部 agent。
 * 链式触发场景必须 allowEveryone=false，防止 agent 自己 @all 触发雪崩响应。
 */
interface ResolvedMentions {
  agents: Agent[];
  /** 是否包含 @all 展开（用于豁免 MAX_MENTIONS_PER_MESSAGE 截断）*/
  expandedFromEveryone: boolean;
  /** @all 出现但被禁用（chain 中），用于打 warn 日志 */
  everyoneBlocked: boolean;
}

async function resolveMentionsToAgents(
  db: Database,
  channelId: string,
  names: string[],
  options: { allowEveryone: boolean } = { allowEveryone: true },
): Promise<ResolvedMentions> {
  if (names.length === 0) {
    return { agents: [], expandedFromEveryone: false, everyoneBlocked: false };
  }
  const channelAgents = agentRepo.listInChannel(db, channelId);
  const byName = new Map(channelAgents.map((a) => [a.name.toLowerCase(), a]));
  const result: Agent[] = [];
  const seen = new Set<string>();
  let expandedFromEveryone = false;
  let everyoneBlocked = false;

  for (const n of names) {
    if (isEveryoneMention(n)) {
      if (!options.allowEveryone) {
        everyoneBlocked = true;
        continue;
      }
      for (const a of channelAgents) {
        if (!seen.has(a.id)) {
          seen.add(a.id);
          result.push(a);
        }
      }
      expandedFromEveryone = true;
      continue;
    }
    const agent = byName.get(n.toLowerCase());
    if (agent && !seen.has(agent.id)) {
      seen.add(agent.id);
      result.push(agent);
    }
  }
  return { agents: result, expandedFromEveryone, everyoneBlocked };
}

function emitSystemMessage(
  db: Database,
  channelId: string,
  parentId: string | null,
  event: SystemEvent,
): void {
  const content =
    event.type === 'chain_limit_reached' ? `⚠ ${event.detail}` : `System event: ${event.type}`;
  const metadata: MessageMetadata = {
    system_event:
      event.type === 'chain_limit_reached'
        ? { type: 'chain_limit_reached', detail: event.detail }
        : undefined,
  };
  const sysMsg = messageRepo.create(db, {
    channel_id: channelId,
    sender_type: 'system',
    sender_id: LOCAL_USER_ID,
    content,
    metadata,
    parent_id: parentId,
  });
  hub.broadcast(channelId, { type: 'message', message: sysMsg });
  hub.broadcast(channelId, { type: 'system_event', event });
}
