/**
 * @mention 解析器
 *
 * 规则（简化版，覆盖 slock.ai 常见 Agent 命名模式）：
 *   - 匹配 @ 后跟连续的字母/数字/连字符/下划线 + 常见中文字符
 *   - 不匹配 email 里的 @（要求 @ 前不能是 \w）
 *   - 去重 + 大小写敏感（agent 名字是大小写敏感的）
 *
 * 例：
 *   "@Architect 拆给 @Dev-Main 和 @dev_main"
 *   → ["Architect", "Dev-Main", "dev_main"]
 */

// @ 前面不能是字母/数字（否则是 email），后面可接字母数字连字符下划线或中文字符
const MENTION_RE = /(^|[^\w@])@([A-Za-z0-9_\-\u4e00-\u9fa5]+)/g;

/**
 * Sprint 4-ext "@all" 别名集合（大小写不敏感比较）。
 *
 * 任一别名出现在 mention 名单中 → 在 channel 级展开为"所有 agent"。
 * - `all` / `everyone` / `channel`：英文常见
 * - `所有人`：中文用户友好（mentions.ts 的 regex 已支持中文）
 *
 * 链式触发（agent 回复里 @all）会被静默忽略，仅用户消息生效，详见 router.ts。
 */
export const EVERYONE_ALIASES = new Set(['all', 'everyone', 'channel', '所有人']);

export function isEveryoneMention(name: string): boolean {
  return EVERYONE_ALIASES.has(name.toLowerCase());
}

export interface ParsedMention {
  name: string;
  /** 在 content 中的位置（用于 UI 高亮） */
  start: number;
  end: number;
}

export function parseMentions(content: string): ParsedMention[] {
  const result: ParsedMention[] = [];
  const seen = new Set<string>();

  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(content)) !== null) {
    const prefix = match[1] ?? '';
    const name = match[2];
    if (!name) continue;

    // match.index 是整个 match 的起始（可能包含 prefix 字符或字符串开头）
    const atIdx = match.index + prefix.length;
    const endIdx = atIdx + 1 + name.length;

    if (!seen.has(name)) {
      seen.add(name);
      result.push({ name, start: atIdx, end: endIdx });
    }
  }
  return result;
}

/** 便利方法：只返回名字数组 */
export function mentionNames(content: string): string[] {
  return parseMentions(content).map((m) => m.name);
}
