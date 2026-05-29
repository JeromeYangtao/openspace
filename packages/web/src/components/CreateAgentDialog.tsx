/**
 * Create Agent Dialog
 * 参考: docs/ui-reference/screenshots/60-create-agent-desktop.png + 62-create-agent-advanced.png
 *
 * 本地版简化（local-adaptations.md）：
 *   - 无 Machine 字段（本地版默认 Local）
 *   - Runtime 下拉：已装且 enabled_in_openspace 可选；其他标 "(coming soon)" 且 disabled
 */

import { useEffect, useState } from 'react';
import type { ReasoningEffort, Runtime, RuntimeDetection } from '@openspace/shared';
import { REASONING_EFFORTS } from '@openspace/shared';
import { cn } from '../lib/cn';
import { notifyChannelAgentsChanged } from '../lib/channel-agent-events';
import { createAgent, getRuntimeModels, getRuntimes, joinChannel } from '../lib/api';
import { useAgentsStore } from '../stores/agents';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 创建后自动加入此频道 */
  autoJoinChannelId?: string;
  /** v1.0: 新 Agent 归属的 Project（从 Layout 当前 Project 注入） */
  projectId?: string | null;
}

export function CreateAgentDialog({ open, onClose, autoJoinChannelId, projectId }: Props) {
  const [runtimes, setRuntimes] = useState<RuntimeDetection[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [runtime, setRuntime] = useState<Runtime | ''>('');
  const [model, setModel] = useState<string>('');
  const [reasoning, setReasoning] = useState<ReasoningEffort>('medium');
  const [advanced, setAdvanced] = useState(false);
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upsertAgent = useAgentsStore((s) => s.upsert);

  useEffect(() => {
    if (open) {
      void getRuntimes().then(setRuntimes);
    } else {
      setName('');
      setDescription('');
      setRuntime('');
      setModel('');
      setModels([]);
      setReasoning('medium');
      setAdvanced(false);
      setEnvVars([]);
      setError(null);
    }
  }, [open]);

  // runtime 设默认
  useEffect(() => {
    if (runtime || runtimes.length === 0) return;
    const firstEnabled = runtimes.find((r) => r.installed && r.enabled_in_openspace);
    if (firstEnabled) setRuntime(firstEnabled.id);
  }, [runtime, runtimes]);

  // runtime 改变时从后端拉模型列表
  useEffect(() => {
    if (!runtime) {
      setModels([]);
      return;
    }
    setLoadingModels(true);
    getRuntimeModels(runtime)
      .then((res) => {
        setModels(res.models);
        // 选中第一个作为默认（优先"composer-2-fast"、否则第一个）
        if (res.models.length > 0) {
          const preferred = res.models.find((m) => m === 'composer-2-fast') ?? res.models[0]!;
          setModel(preferred);
        } else {
          setModel('');
        }
      })
      .catch(() => {
        setModels([]);
        setModel('');
      })
      .finally(() => setLoadingModels(false));
  }, [runtime]);

  const canSubmit = Boolean(name.trim() && runtime);

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const envVarsObj: Record<string, string> = {};
      for (const ev of envVars) {
        if (ev.key.trim()) envVarsObj[ev.key.trim()] = ev.value;
      }
      const agent = await createAgent({
        name: name.trim(),
        description: description.trim() || undefined,
        runtime: runtime as Runtime,
        model: model || undefined,
        reasoning,
        env_vars: Object.keys(envVarsObj).length > 0 ? envVarsObj : undefined,
        project_id: projectId ?? undefined,
      });
      upsertAgent(agent);
      if (autoJoinChannelId) {
        await joinChannel(autoJoinChannelId, agent.id);
        notifyChannelAgentsChanged(autoJoinChannelId);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} title="CREATE AGENT" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="p-5 space-y-4"
      >
        <Field label="NAME" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alice"
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card focus:outline-none focus:ring-2 focus:ring-accent-pink"
            autoFocus
          />
        </Field>

        <Field label="DESCRIPTION" optional>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Leave blank for a general-purpose agent, or describe a role..."
            maxLength={3000}
            rows={3}
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card resize-none focus:outline-none focus:ring-2 focus:ring-accent-pink"
          />
          <div className="text-right text-[10px] font-mono text-text-muted mt-0.5">
            {description.length}/3000
          </div>
        </Field>

        <Field label="RUNTIME">
          <select
            value={runtime}
            onChange={(e) => setRuntime(e.target.value as Runtime)}
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card focus:outline-none focus:ring-2 focus:ring-accent-pink"
          >
            <option value="" disabled>
              Select...
            </option>
            {runtimes.map((rt) => {
              const disabled = !rt.enabled_in_openspace || !rt.installed;
              const note = rt.enabled_in_openspace
                ? rt.installed
                  ? ''
                  : ' (not installed)'
                : ' (coming soon)';
              return (
                <option key={rt.id} value={rt.id} disabled={disabled}>
                  {rt.label}
                  {note}
                </option>
              );
            })}
          </select>
        </Field>

        <Field label="MODEL">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card focus:outline-none focus:ring-2 focus:ring-accent-pink"
            disabled={!runtime || loadingModels}
          >
            {loadingModels && <option>Loading models...</option>}
            {!loadingModels && models.length === 0 && <option value="">(no models)</option>}
            {!loadingModels &&
              models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
          </select>
          {models.length > 8 && (
            <div className="text-[11px] font-mono text-text-muted mt-1">
              {models.length} models available
            </div>
          )}
        </Field>

        <Field label="REASONING EFFORT">
          <select
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value as ReasoningEffort)}
            className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card focus:outline-none focus:ring-2 focus:ring-accent-pink"
          >
            {REASONING_EFFORTS.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
        </Field>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="flex items-center gap-1 section-header hover:underline"
          >
            <span>{advanced ? '▼' : '▶'}</span>
            ADVANCED
          </button>
          {advanced && (
            <div className="mt-3 space-y-2 pl-4 border-l-2 border-black/30">
              <Field label="ENVIRONMENT VARIABLES">
                <div className="text-[11px] font-mono text-text-secondary mb-2">
                  These will be injected into the runtime command environment.
                </div>
                <div className="space-y-2">
                  {envVars.map((ev, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        value={ev.key}
                        onChange={(e) => {
                          const next = [...envVars];
                          next[i] = { ...next[i]!, key: e.target.value };
                          setEnvVars(next);
                        }}
                        placeholder="KEY"
                        className="flex-1 px-2 py-1 border-2 border-black rounded font-mono text-sm bg-bg-card"
                      />
                      <input
                        type="text"
                        value={ev.value}
                        onChange={(e) => {
                          const next = [...envVars];
                          next[i] = { ...next[i]!, value: e.target.value };
                          setEnvVars(next);
                        }}
                        placeholder="value"
                        className="flex-1 px-2 py-1 border-2 border-black rounded font-mono text-sm bg-bg-card"
                      />
                      <button
                        type="button"
                        onClick={() => setEnvVars(envVars.filter((_, idx) => idx !== i))}
                        className="w-8 h-8 border-2 border-black rounded hover:bg-accent-red hover:text-black"
                        aria-label="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setEnvVars([...envVars, { key: '', value: '' }])}
                  className="mt-2 text-sm text-accent-pink font-medium"
                >
                  + Add Variable
                </button>
              </Field>
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 bg-accent-red/20 border-2 border-accent-red rounded text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t-2 border-black/10 -mx-5 px-5 pb-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 border-2 border-black rounded bg-bg-card font-bold hover:bg-accent-yellow disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className={cn(
              'px-4 py-2 border-2 border-black rounded font-bold',
              !canSubmit || submitting
                ? 'bg-[#f5bfd2] opacity-60 cursor-not-allowed'
                : 'bg-accent-pink hover:brightness-105',
            )}
          >
            {submitting ? 'Creating...' : 'Create Agent'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Field({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="section-header block mb-1.5">
        {label}
        {required && <span className="text-accent-pink"> *</span>}
        {optional && (
          <span className="text-text-muted text-[11px] font-mono normal-case ml-1">(optional)</span>
        )}
      </label>
      {children}
    </div>
  );
}
