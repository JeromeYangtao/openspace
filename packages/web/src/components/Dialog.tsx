/**
 * 通用对话框
 *
 * Neo-Brutalism 风格：白底 2px 黑边 + 硬阴影 + 暗色遮罩
 * 参考: docs/ui-reference/screenshots/30-stop-all-agents-dialog.png
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
  className?: string;
}

export function Dialog({ open, title, onClose, children, maxWidth = 500, className }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={cn(
          'bg-bg-card border-2 border-black rounded-xl shadow-[6px_6px_0_0_#000]',
          'w-full max-h-[90vh] flex flex-col',
          className,
        )}
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <header className="flex items-center justify-between border-b-2 border-black px-5 py-3">
          <h2
            id="dialog-title"
            className="section-header text-base"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center border-2 border-black rounded hover:bg-accent-yellow"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
