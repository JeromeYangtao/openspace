import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { ContextUsageInfo, TokenUsageBreakdown } from './types.js';

export interface CodexSessionContextUsage extends ContextUsageInfo {
  session_id: string | null;
  log_path: string;
  updated_at: string | null;
}

interface LatestTokenCount {
  usage: ContextUsageInfo;
  updatedAt: string | null;
}

export async function readCodexSessionContextUsage(input: {
  sessionId?: string | null;
  logPath?: string | null;
  codexHome?: string;
}): Promise<CodexSessionContextUsage | null> {
  const logPath = input.logPath
    ? resolve(input.logPath)
    : input.sessionId
      ? await findCodexSessionLog(input.sessionId, input.codexHome)
      : null;
  if (!logPath) return null;

  const latest = await readLatestTokenCount(logPath);
  if (!latest) return null;

  return {
    ...latest.usage,
    session_id: input.sessionId ?? null,
    log_path: logPath,
    updated_at: latest.updatedAt,
  };
}

export async function findCodexSessionLog(
  sessionId: string,
  codexHome = defaultCodexHome(),
): Promise<string | null> {
  const sessionsDir = join(codexHome, 'sessions');
  const files = await listJsonlFiles(sessionsDir);
  const sortedFiles = await sortNewestFirst(files);
  for (const file of sortedFiles) {
    if (await fileHasSessionId(file, sessionId)) return file;
  }
  return null;
}

export async function readLatestTokenCount(logPath: string): Promise<LatestTokenCount | null> {
  let latest: LatestTokenCount | null = null;
  const reader = createInterface({
    input: createReadStream(logPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    const record = parseJsonLine(line);
    const payload = record?.payload;
    if (!payload || typeof payload !== 'object') continue;
    const payloadRecord = payload as Record<string, unknown>;
    if (payloadRecord.type !== 'token_count') continue;

    const usage = parseTokenCountInfo(payloadRecord.info);
    if (!usage) continue;
    latest = {
      usage,
      updatedAt: typeof record.timestamp === 'string' ? record.timestamp : null,
    };
  }

  return latest;
}

export function parseTokenCountInfo(value: unknown): ContextUsageInfo | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const total = parseSnakeTokenUsageBreakdown(record.total_token_usage);
  const last = parseSnakeTokenUsageBreakdown(record.last_token_usage);
  if (!total || !last) return null;

  const modelContextWindow = finiteNumber(record.model_context_window);
  const contextPercent = finiteNumber(record.context_percent);
  const inputTokensInLatestContext = finiteNumber(record.input_tokens_in_latest_context);
  const fallbackPercent =
    inputTokensInLatestContext !== null && modelContextWindow && modelContextWindow > 0
      ? (inputTokensInLatestContext / modelContextWindow) * 100
      : modelContextWindow && modelContextWindow > 0
        ? (last.input_tokens / modelContextWindow) * 100
        : null;

  return {
    total,
    last,
    model_context_window: modelContextWindow,
    percent_used: contextPercent !== null ? contextPercent / 100 : fallbackPercent === null ? null : fallbackPercent / 100,
    context_percent: contextPercent,
    input_tokens_in_latest_context: inputTokensInLatestContext,
  };
}

function parseSnakeTokenUsageBreakdown(value: unknown): TokenUsageBreakdown | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return {
    total_tokens: finiteNumber(record.total_tokens) ?? 0,
    input_tokens: finiteNumber(record.input_tokens) ?? 0,
    cached_input_tokens: finiteNumber(record.cached_input_tokens) ?? 0,
    output_tokens: finiteNumber(record.output_tokens) ?? 0,
    reasoning_output_tokens: finiteNumber(record.reasoning_output_tokens) ?? 0,
  };
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function fileHasSessionId(file: string, sessionId: string): Promise<boolean> {
  const reader = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    const record = parseJsonLine(line);
    if (!record) continue;
    if (record.type !== 'session_meta') continue;

    const payload = record.payload;
    if (!payload || typeof payload !== 'object') continue;
    return (payload as Record<string, unknown>).id === sessionId;
  }

  return false;
}

async function listJsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonlFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path);
    }
  }

  return files;
}

async function sortNewestFirst(files: string[]): Promise<string[]> {
  const withStats = await Promise.all(
    files.map(async (file) => ({
      file,
      mtimeMs: (await stat(file)).mtimeMs,
    })),
  );
  return withStats.sort((a, b) => b.mtimeMs - a.mtimeMs).map((entry) => entry.file);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function defaultCodexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), '.codex');
}
