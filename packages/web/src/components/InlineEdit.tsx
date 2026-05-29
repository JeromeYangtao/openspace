/**
 * 通用内联编辑控件
 * - 点铅笔 / 文本本身进入编辑态
 * - Enter 保存（textarea 用 Cmd/Ctrl+Enter），Esc 取消
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

interface Props {
  value: string;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  onSave: (v: string) => Promise<void> | void;
  /** 自定义展示 render（未编辑时用） */
  renderDisplay?: (v: string) => React.ReactNode;
}

export function InlineEdit({
  value,
  placeholder = '',
  multiline = false,
  maxLength,
  onSave,
  renderDisplay,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      if (ref.current && 'setSelectionRange' in ref.current) {
        const len = ref.current.value.length;
        ref.current.setSelectionRange(len, len);
      }
    }
  }, [editing]);

  const commit = async () => {
    const v = draft.trim();
    if (v === value.trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(v);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="group flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {renderDisplay ? (
            renderDisplay(value)
          ) : (
            <div className="text-sm whitespace-pre-wrap">
              {value || <span className="text-text-secondary italic">{placeholder}</span>}
            </div>
          )}
        </div>
        <button
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center border-2 border-black rounded bg-bg-card hover:bg-accent-yellow"
          title="Edit"
          aria-label="Edit"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      </div>
    );
  }

  const commonClass =
    'w-full px-2 py-1 border-2 border-black rounded bg-bg-card text-sm focus:outline-none focus:ring-2 focus:ring-accent-pink';

  return (
    <div className="space-y-2">
      {multiline ? (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel();
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void commit();
          }}
          rows={5}
          maxLength={maxLength}
          className={cn(commonClass, 'resize-y min-h-24')}
        />
      ) : (
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel();
            if (e.key === 'Enter') void commit();
          }}
          maxLength={maxLength}
          className={commonClass}
        />
      )}
      <div className="flex gap-2 text-xs">
        <button
          onClick={() => void commit()}
          disabled={busy}
          className="px-2 py-1 border-2 border-black rounded bg-accent-pink font-bold disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={cancel}
          disabled={busy}
          className="px-2 py-1 border-2 border-black rounded bg-bg-card font-medium disabled:opacity-50"
        >
          Cancel
        </button>
        {multiline && (
          <span className="text-text-muted font-mono ml-auto">⌘/Ctrl+Enter to save</span>
        )}
      </div>
    </div>
  );
}
