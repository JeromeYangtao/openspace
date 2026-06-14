/**
 * 消息输入框
 *
 * 参考: docs/ui-reference/screenshots/10-channel-main-desktop.png 底部
 *
 * Sprint 2 CP4：当输入以 "/" 开头时弹出 command 提示下拉。
 *   - workflows[].trigger_command（来自当前 Project）
 *   - thread 内额外加 /approve /reject /abort
 *   - 上下键导航，Enter 选中补全（不直接发送）
 *   - Esc 关闭提示
 */

import type { Agent } from '@openspace/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { Avatar } from './Avatar';

export interface CommandHint {
  name: string;
  description?: string;
}

interface Props {
  placeholder?: string;
  defaultValue?: string;
  showAsTask?: boolean;
  onSend: (content: string, opts?: { asTask?: boolean }) => void;
  disabled?: boolean;
  /** Sprint 2 CP4：可选命令列表；为空数组时不显示提示 */
  commands?: CommandHint[];
  /** 当前输入框可 @ 的 agent 列表；通常传当前 channel 成员 */
  mentionAgents?: Agent[];
}

export function MessageInput({
  placeholder = 'Message',
  defaultValue = '',
  showAsTask = true,
  onSend,
  disabled,
  commands = [],
  mentionAgents = [],
}: Props) {
  const [value, setValue] = useState('');
  const [asTask, setAsTask] = useState(false);
  const [hintIndex, setHintIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);
  const compositionJustEndedRef = useRef(false);
  const lastDefaultValueRef = useRef(defaultValue);

  useEffect(() => {
    let nextCursor: number | null = null;
    setValue((current) => {
      const previousDefault = lastDefaultValueRef.current;
      lastDefaultValueRef.current = defaultValue;
      if (current && current !== previousDefault) return current;
      nextCursor = defaultValue.length;
      return defaultValue;
    });
    if (nextCursor === null) return;
    setCursorPos(nextCursor);
    window.setTimeout(() => {
      ref.current?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  }, [defaultValue]);

  // 当且仅当：第一行以 / 开头 + commands 非空 + 用户没按 Esc 关闭
  const hintQuery = useMemo(() => {
    if (commands.length === 0) return null;
    const firstLine = value.split('\n')[0] ?? '';
    if (!firstLine.startsWith('/')) return null;
    // 已有空格 → 用户在输入参数，关闭提示
    if (firstLine.includes(' ')) return null;
    return firstLine.toLowerCase();
  }, [value, commands.length]);

  const filteredHints = useMemo(() => {
    if (!hintQuery) return [];
    return commands.filter((c) => c.name.toLowerCase().startsWith(hintQuery)).slice(0, 8);
  }, [hintQuery, commands]);

  const mentionQuery = useMemo(() => {
    if (mentionAgents.length === 0) return null;
    const beforeCursor = value.slice(0, cursorPos);
    const atIdx = beforeCursor.lastIndexOf('@');
    if (atIdx < 0) return null;

    const prefix = atIdx > 0 ? beforeCursor[atIdx - 1] : '';
    if (prefix && /[\w@]/.test(prefix)) return null;

    const query = beforeCursor.slice(atIdx + 1);
    if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]*$/.test(query)) return null;

    const key = `${atIdx}:${query}`;
    if (dismissedMentionKey === key) return null;
    return { start: atIdx, query, key };
  }, [cursorPos, dismissedMentionKey, mentionAgents.length, value]);

  const filteredMentions = useMemo(() => {
    if (!mentionQuery) return [];
    const q = mentionQuery.query.toLowerCase();
    const rows = mentionAgents
      .filter((a) => a.name.toLowerCase().startsWith(q))
      .slice(0, 8)
      .map((a) => ({
        kind: 'agent' as const,
        agent: a,
        name: a.name,
        description: a.description ?? undefined,
      }));

    if ('all'.startsWith(q)) {
      return [
        { kind: 'all' as const, name: 'all', description: 'Notify every agent in this channel' },
        ...rows,
      ];
    }
    return rows;
  }, [mentionAgents, mentionQuery]);

  const activeHints = filteredHints.length > 0 ? filteredHints : [];
  const activeMentions = filteredHints.length === 0 ? filteredMentions : [];

  useEffect(() => {
    const activeCount = activeHints.length + activeMentions.length;
    if (activeCount === 0) {
      setHintIndex(0);
      return;
    }
    setHintIndex((i) => Math.min(i, activeCount - 1));
  }, [activeHints.length, activeMentions.length]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text, { asTask });
    setValue(defaultValue);
    setAsTask(false);
    setCursorPos(defaultValue.length);
    setDismissedMentionKey(null);
    setTimeout(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(defaultValue.length, defaultValue.length);
    }, 0);
  };

  const applyHint = (cmd: CommandHint) => {
    // 替换第一行的 query 为完整 cmd，保留剩余行
    const [, ...rest] = value.split('\n');
    const next = `${cmd.name} ${rest.length ? '\n' + rest.join('\n') : ''}`.replace(/\s+$/, ' ');
    setValue(next);
    setTimeout(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.length, next.length);
    }, 0);
  };

  const applyMention = (mention: (typeof filteredMentions)[number]) => {
    if (!mentionQuery) return;
    const replacement = `@${mention.name} `;
    const next = value.slice(0, mentionQuery.start) + replacement + value.slice(cursorPos);
    const nextCursor = mentionQuery.start + replacement.length;
    setValue(next);
    setCursorPos(nextCursor);
    setDismissedMentionKey(null);
    setTimeout(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isImeEnter =
      e.key === 'Enter' &&
      (isComposingRef.current || e.nativeEvent.isComposing || compositionJustEndedRef.current);

    if (isImeEnter) {
      e.preventDefault();
      return;
    }

    const hasCommandHints = activeHints.length > 0;
    const hasMentionHints = activeMentions.length > 0;
    const activeCount = hasCommandHints ? activeHints.length : activeMentions.length;

    if (activeCount > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHintIndex((i) => (i + 1) % activeCount);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHintIndex((i) => (i - 1 + activeCount) % activeCount);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        const command = hasCommandHints ? activeHints[hintIndex] : undefined;
        const mention = hasMentionHints ? activeMentions[hintIndex] : undefined;

        if (command && e.key === 'Tab') {
          e.preventDefault();
          applyHint(command);
          return;
        }
        if (command && e.key === 'Enter' && hintQuery && hintQuery !== command.name.toLowerCase()) {
          // 用户输入是 "/n"，提示为 "/new-feature" 时按 Enter 补全
          e.preventDefault();
          applyHint(command);
          return;
        }
        if (mention) {
          e.preventDefault();
          applyMention(mention);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (hasMentionHints && mentionQuery) {
          setDismissedMentionKey(mentionQuery.key);
        } else {
          setValue('');
        }
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleSelectionChange = () => {
    setCursorPos(ref.current?.selectionStart ?? value.length);
    setDismissedMentionKey(null);
  };

  return (
    <div className="border-t-2 border-black bg-bg-card p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:p-3 relative">
      {filteredHints.length > 0 && (
        <div className="absolute left-3 right-3 bottom-full mb-1 z-30 border-2 border-black rounded bg-bg-card shadow-[4px_4px_0_0_#000] overflow-hidden">
          {filteredHints.map((c, i) => (
            <button
              key={c.name}
              type="button"
              onClick={() => applyHint(c)}
              onMouseEnter={() => setHintIndex(i)}
              className={cn(
                'w-full text-left flex items-baseline gap-2 px-3 py-1.5 text-sm',
                i === hintIndex ? 'bg-accent-pink' : 'hover:bg-accent-yellow',
              )}
            >
              <code className="font-bold">{c.name}</code>
              {c.description && (
                <span className="text-[11px] font-mono text-text-secondary truncate">
                  {c.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {filteredHints.length === 0 && filteredMentions.length > 0 && (
        <div className="absolute left-3 right-3 bottom-full mb-1 z-30 border-2 border-black rounded bg-bg-card shadow-[4px_4px_0_0_#000] overflow-hidden">
          {filteredMentions.map((m, i) => (
            <button
              key={m.name}
              type="button"
              onClick={() => applyMention(m)}
              onMouseEnter={() => setHintIndex(i)}
              className={cn(
                'w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm',
                i === hintIndex ? 'bg-accent-yellow' : 'hover:bg-accent-yellow',
              )}
            >
              {m.kind === 'agent' ? (
                <Avatar name={m.agent.name} size="sm" className="w-7 h-7 text-xs" />
              ) : (
                <span className="w-7 h-7 flex items-center justify-center border-2 border-black rounded bg-accent-pink font-bold">
                  @
                </span>
              )}
              <span className="font-bold font-mono">@{m.name}</span>
              {m.description && (
                <span className="text-[11px] font-mono text-text-secondary truncate">
                  {m.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="border-2 border-black rounded-lg bg-bg-card overflow-hidden">
        <textarea
          ref={ref}
          rows={2}
          className="w-full px-3 py-2 resize-none focus:outline-none bg-bg-card text-base sm:text-sm"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setCursorPos(e.target.selectionStart);
            setDismissedMentionKey(null);
          }}
          onClick={handleSelectionChange}
          onKeyUp={handleSelectionChange}
          onSelect={handleSelectionChange}
          onKeyDown={handleKey}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
            compositionJustEndedRef.current = true;
            window.setTimeout(() => {
              compositionJustEndedRef.current = false;
            }, 0);
          }}
          disabled={disabled}
        />
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-black/20">
          <div className="flex items-center gap-1">
            <IconButton title="Attach image (coming soon)" disabled>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </IconButton>
            <IconButton title="Attach file (coming soon)" disabled>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </IconButton>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {showAsTask && (
              <label
                className="flex items-center gap-1.5 text-xs font-mono text-text-secondary cursor-pointer"
                title="Also create a task for this message"
              >
                <input
                  type="checkbox"
                  checked={asTask}
                  onChange={(e) => setAsTask(e.target.checked)}
                  className="w-3.5 h-3.5 border-2 border-black accent-accent-pink"
                />
                <span className="hidden min-[380px]:inline">As Task</span>
              </label>
            )}
            <button
              onClick={submit}
              disabled={!value.trim() || disabled}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded font-bold text-sm border-2 border-black',
                !value.trim() || disabled
                  ? 'bg-[#f5bfd2] opacity-60 cursor-not-allowed'
                  : 'bg-accent-pink hover:brightness-105',
              )}
            >
              Send
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'w-7 h-7 flex items-center justify-center border-2 border-black rounded',
        disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-accent-pink',
      )}
    >
      {children}
    </button>
  );
}
