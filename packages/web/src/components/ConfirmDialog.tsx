/**
 * 通用确认对话框（危险操作）
 * 参考 docs/ui-reference/screenshots/30-stop-all-agents-dialog.png
 */

import { useState } from 'react';
import { cn } from '../lib/cn';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  /** 红色/危险样式 */
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  onClose,
  onConfirm,
}: Props) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title={title} onClose={onClose} maxWidth={440}>
      <div className="p-5 space-y-5">
        <div className="flex gap-3 p-4 bg-[#ffd9d9] border-2 border-black rounded">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="text-sm">{description}</div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border-2 border-black rounded bg-bg-card font-bold hover:bg-accent-yellow disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={busy}
            className={cn(
              'px-4 py-2 border-2 border-black rounded font-bold',
              danger ? 'bg-accent-red text-black' : 'bg-accent-pink',
              busy && 'opacity-60 cursor-not-allowed',
            )}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
