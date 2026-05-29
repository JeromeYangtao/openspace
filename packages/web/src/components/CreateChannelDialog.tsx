import { useState } from 'react';
import type { Channel } from '@openspace/shared';
import { cn } from '../lib/cn';
import { createChannel } from '../lib/api';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Channel) => void;
  /** v1.0: 新 channel 归属的 Project（从 Layout 当前 Project 注入） */
  projectId?: string | null;
}

export function CreateChannelDialog({ open, onClose, onCreated, projectId }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      const ch = await createChannel({
        name: n,
        description: description.trim() || undefined,
        type: 'channel',
        project_id: projectId ?? undefined,
      });
      onCreated(ch);
      setName('');
      setDescription('');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="CREATE CHANNEL" onClose={onClose} maxWidth={440}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="p-5 space-y-4"
      >
        <div>
          <label className="section-header block mb-1.5">
            NAME<span className="text-accent-pink"> *</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-text-secondary">#</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. hotfix or 需求讨论"
              className="w-full pl-7 pr-3 py-2 border-2 border-black rounded bg-bg-card focus:outline-none focus:ring-2 focus:ring-accent-pink"
              autoFocus
            />
          </div>
          <div className="text-[11px] font-mono text-text-muted mt-1">
            Any non-empty name is allowed
          </div>
        </div>

        <div>
          <label className="section-header block mb-1.5">
            DESCRIPTION <span className="text-text-muted text-[11px] font-mono normal-case">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What is this channel about?"
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card resize-none focus:outline-none focus:ring-2 focus:ring-accent-pink"
          />
        </div>

        {error && (
          <div className="p-3 bg-accent-red/20 border-2 border-accent-red rounded text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t-2 border-black/10 -mx-5 px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border-2 border-black rounded bg-bg-card font-bold hover:bg-accent-yellow disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className={cn(
              'px-4 py-2 border-2 border-black rounded font-bold',
              !name.trim() || busy
                ? 'bg-[#f5bfd2] opacity-60 cursor-not-allowed'
                : 'bg-accent-pink hover:brightness-105',
            )}
          >
            {busy ? 'Creating...' : 'Create Channel'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
