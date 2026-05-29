/**
 * Tool args summarizer（Sprint 4 ext / S-3）
 *
 * 借鉴自 cursor/cookbook/sdk/coding-agent-cli/src/agent.ts 的 summarizeToolArgs +
 * getToolSummaryKeys，按工具名智能提取关键 args 字段，生成可读的一行摘要给 D-3
 * Activity Tab。覆盖 Cursor / Codex / Claude 三家常见工具命名变体。
 *
 * 例：
 *   summarizeToolArgs('shell', { command: 'ls -la /path' })
 *   → 'ls -la /path'
 *
 *   summarizeToolArgs('read', { path: 'src/auth/oauth.ts', offset: 10, limit: 50 })
 *   → 'src/auth/oauth.ts (offset=10, limit=50)'
 *
 *   summarizeToolArgs('edit', { target_file: 'README.md', instruction: 'Fix typo' })
 *   → 'README.md — Fix typo'
 */

const MAX_SUMMARY = 200;

/**
 * 给工具名返回字段优先级数组：
 *   外层数组 = 摘要的"段"（按顺序拼接）
 *   内层数组 = 该段可能的字段名（从前到后取第一个命中的）
 */
function getToolSummaryKeys(toolName: string): string[][] {
  const name = toolName.toLowerCase();
  if (name.includes('read') || name === 'cat' || name === 'view') {
    return [
      ['path', 'filePath', 'target_file', 'file'],
      ['offset', 'startLine'],
      ['limit', 'numLines'],
    ];
  }
  if (name.includes('shell') || name === 'run' || name === 'bash' || name === 'cmd') {
    return [
      ['command', 'cmd', 'script'],
      ['cwd', 'working_directory', 'workingDir'],
    ];
  }
  if (name.includes('edit') || name === 'patch' || name === 'modify') {
    return [
      ['path', 'target_file', 'filePath', 'file'],
      ['instruction', 'message', 'description'],
    ];
  }
  if (name.includes('write') || name === 'create' || name === 'save') {
    return [['path', 'target_file', 'filePath', 'file'], ['contents', 'content']];
  }
  if (name.includes('grep') || name === 'search') {
    return [['pattern', 'query'], ['path', 'directory'], ['glob', 'include']];
  }
  if (name.includes('glob') || name === 'list' || name === 'ls') {
    return [['glob_pattern', 'pattern', 'path'], ['target_directory', 'directory']];
  }
  if (name.includes('semsearch') || name.includes('semantic')) {
    return [['query'], ['target_directories']];
  }
  if (name.includes('delete') || name.includes('rm') || name === 'unlink') {
    return [['path', 'target_file', 'filePath']];
  }
  if (name.includes('todo') || name.includes('task')) {
    return [['todos', 'items', 'tasks']];
  }
  if (name.includes('mcp')) {
    return [['provider'], ['tool', 'tool_name'], ['args']];
  }
  // 默认：简单 JSON 摘要
  return [];
}

/**
 * 主入口：根据 tool name + args 产一行可读摘要。
 * 字段缺失或 args 为空时退化为 JSON 截断。
 */
export function summarizeToolArgs(
  toolName: string,
  args: Record<string, unknown> | undefined | null,
): string {
  if (!args || typeof args !== 'object') return '';
  const keys = getToolSummaryKeys(toolName);

  if (keys.length === 0) {
    return jsonShort(args);
  }

  const parts: string[] = [];
  for (const [segIdx, candidates] of keys.entries()) {
    for (const key of candidates) {
      if (args[key] === undefined || args[key] === null) continue;
      const val = args[key];
      const str = stringifyValue(val);
      if (!str) continue;
      // 第 0 段：直接拼
      // 后续段：用 (k=v) 或 — v 风格
      if (segIdx === 0) {
        parts.push(str);
      } else if (
        toolName.toLowerCase().includes('read') ||
        toolName.toLowerCase().includes('shell')
      ) {
        // (key=value) 形式
        parts.push(`${key}=${str}`);
      } else {
        parts.push(str);
      }
      break;
    }
  }

  if (parts.length === 0) return jsonShort(args);

  // 第 0 段独立显示，后续段用括号包起或 — 分隔
  const head = parts[0]!;
  const rest = parts.slice(1);

  let summary: string;
  if (rest.length === 0) {
    summary = head;
  } else if (toolName.toLowerCase().includes('read') || toolName.toLowerCase().includes('shell')) {
    summary = `${head} (${rest.join(', ')})`;
  } else {
    summary = `${head} — ${rest.join(' / ')}`;
  }

  return clamp(summary, MAX_SUMMARY);
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === 'object') return jsonShort(v as Record<string, unknown>);
  return String(v);
}

function jsonShort(obj: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(obj);
    return clamp(s, MAX_SUMMARY);
  } catch {
    return '[unserializable]';
  }
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
