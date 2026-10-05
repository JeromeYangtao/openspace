import { useEffect, useRef, useState } from 'react';
import type { AgentInputRequest, AgentInputResponse } from '@openspace/shared';
import { wsClient } from '../lib/ws';
import { answerAgentInput, listAgentInputs } from '../lib/api';

export function GlobalInputBanner() {
  const resolved = useRef(new Set<string>());
  const [requests, setRequests] = useState<AgentInputRequest[]>([]);
  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const inputs = await listAgentInputs();
        if (active) setRequests(inputs.filter((input) => !resolved.current.has(input.id)));
      } catch {
        /* Retry on the next poll. */
      } finally {
        loading = false;
      }
    };
    void refresh();
    const unsubscribe = wsClient.subscribe((event) => {
      if (event.type === 'agent_activity' && event.event.type === 'input.resolved') {
        const id = event.event.request_id;
        resolved.current.add(id);
        setRequests((inputs) => inputs.filter((input) => input.id !== id));
      }
      if (
        event.type === 'agent_activity' &&
        (event.event.type === 'input.required' || event.event.type === 'input.resolved')
      )
        void refresh();
    });
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      unsubscribe();
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  if (!requests.length) return null;
  return (
    <div className="border-b-2 border-black bg-accent-yellow p-3">
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
        {requests.map((request) => (
          <InputCard
            key={request.id}
            request={request}
            onResolved={() => {
              resolved.current.add(request.id);
              setRequests((inputs) => inputs.filter((input) => input.id !== request.id));
            }}
          />
        ))}
      </div>
    </div>
  );
}

function InputCard({
  request,
  onResolved,
}: {
  request: AgentInputRequest;
  onResolved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [json, setJson] = useState('');
  const properties = (request.schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const simpleForm =
    request.schema?.type === 'object' &&
    Object.values(properties).every((field) =>
      ['string', 'number', 'integer', 'boolean'].includes(String(field.type)),
    );
  const required = (request.schema?.required ?? []) as string[];
  const set = (id: string, value: string) => setValues((prev) => ({ ...prev, [id]: value }));
  const fieldValue = (id: string, field: Record<string, unknown>) =>
    values[id] ?? (field.default !== undefined ? String(field.default) : '');
  const respond = async (action: AgentInputResponse['action']) => {
    setBusy(true);
    setError('');
    try {
      const response: AgentInputResponse = { action };
      if (action === 'accept' && request.kind === 'questions') {
        response.answers = Object.fromEntries(
          (request.questions ?? []).map((question) => [question.id, [values[question.id] ?? '']]),
        );
      } else if (action === 'accept' && request.mode !== 'url') {
        response.content = simpleForm
          ? Object.fromEntries(
              Object.entries(properties).flatMap(([id, field]) => {
                const value = fieldValue(id, field);
                if (value === '' && !required.includes(id)) return [];
                return [
                  [
                    id,
                    field.type === 'boolean'
                      ? value === 'true'
                      : field.type === 'number' || field.type === 'integer'
                        ? value === ''
                          ? null
                          : Number(value)
                        : value,
                  ],
                ];
              }),
            )
          : JSON.parse(json);
      }
      await answerAgentInput(request.id, response);
      onResolved();
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('already resolved')) onResolved();
      else setError(message);
    } finally {
      setBusy(false);
    }
  };
  const verification = request.mode === 'openai/userVerification';
  const safeUrl = request.url && /^https?:\/\//i.test(request.url) ? request.url : undefined;
  const inputClass = 'mt-1 w-full rounded border border-black p-2 text-sm';
  return (
    <form
      className="rounded border-2 border-black bg-bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void respond('accept');
      }}
    >
      <div className="font-bold">{request.title}</div>
      <div className="mb-2 text-xs text-text-secondary">
        {request.blocking
          ? 'Waiting for your response'
          : 'You can answer while the agent continues'}
      </div>
      {request.questions?.map((question) => (
        <label key={question.id} className="mb-3 block text-sm">
          <span className="font-bold">{question.header}: </span>
          {question.question}
          {question.options?.length ? (
            <>
              <select
                className={inputClass}
                value={custom[question.id] ? '__custom__' : (values[question.id] ?? '')}
                required={!custom[question.id]}
                disabled={busy}
                onChange={(event) => {
                  const other = event.target.value === '__custom__';
                  setCustom((prev) => ({ ...prev, [question.id]: other }));
                  set(question.id, other ? '' : event.target.value);
                }}
              >
                <option value="">Select an answer</option>
                {question.options.map((option) => (
                  <option key={option.label} value={option.label}>
                    {option.label} — {option.description}
                  </option>
                ))}
                {question.isOther && <option value="__custom__">Write an answer</option>}
              </select>
              {custom[question.id] && (
                <input
                  className={inputClass}
                  required
                  disabled={busy}
                  type={question.isSecret ? 'password' : 'text'}
                  value={values[question.id] ?? ''}
                  onChange={(event) => set(question.id, event.target.value)}
                />
              )}
            </>
          ) : (
            <input
              className={inputClass}
              required
              disabled={busy}
              autoComplete="off"
              type={question.isSecret ? 'password' : 'text'}
              value={values[question.id] ?? ''}
              onChange={(event) => set(question.id, event.target.value)}
            />
          )}
        </label>
      ))}
      {request.kind === 'mcp' &&
        (request.mode === 'url' ? (
          <div className="my-2 text-sm">
            {safeUrl ? (
              <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Open confirmation page
              </a>
            ) : (
              'Confirmation URL unavailable'
            )}
            <p>Complete the confirmation page, then submit here.</p>
          </div>
        ) : verification ? (
          <p className="my-2 text-sm">
            This verification requires a supported verification client.
          </p>
        ) : simpleForm ? (
          Object.entries(properties).map(([id, field]) => (
            <label key={id} className="mb-2 block text-sm">
              {String(field.title ?? id)}
              {required.includes(id) ? ' *' : ''}
              {field.description ? (
                <span className="block text-xs text-text-secondary">
                  {String(field.description)}
                </span>
              ) : null}
              {Array.isArray(field.enum) ||
              Array.isArray(field.oneOf) ||
              field.type === 'boolean' ? (
                <select
                  className={inputClass}
                  value={fieldValue(id, field)}
                  disabled={busy}
                  required={required.includes(id)}
                  onChange={(event) => set(id, event.target.value)}
                >
                  <option value="">Select a value</option>
                  {(field.type === 'boolean'
                    ? [
                        { value: 'true', label: 'Yes' },
                        { value: 'false', label: 'No' },
                      ]
                    : Array.isArray(field.oneOf)
                      ? (field.oneOf as Array<{ const: string; title: string }>).map((option) => ({
                          value: option.const,
                          label: option.title,
                        }))
                      : (field.enum as string[]).map((value, index) => ({
                          value,
                          label: (field.enumNames as string[] | undefined)?.[index] ?? value,
                        }))
                  ).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={inputClass}
                  value={fieldValue(id, field)}
                  disabled={busy}
                  required={required.includes(id)}
                  type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
                  step={field.type === 'integer' ? 1 : 'any'}
                  min={field.minimum as number | undefined}
                  max={field.maximum as number | undefined}
                  minLength={field.minLength as number | undefined}
                  maxLength={field.maxLength as number | undefined}
                  onChange={(event) => set(id, event.target.value)}
                />
              )}
            </label>
          ))
        ) : (
          <label className="block text-sm">
            Form response (JSON)
            <details>
              <summary>View requested fields</summary>
              <pre className="max-h-40 overflow-auto text-xs">
                {JSON.stringify(request.schema, null, 2)}
              </pre>
            </details>
            <textarea
              className={inputClass}
              value={json}
              required
              disabled={busy}
              onChange={(event) => setJson(event.target.value)}
            />
          </label>
        ))}
      {error && (
        <div role="alert" className="my-2 text-sm text-accent-red">
          {error}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {!verification && (
          <button
            className="rounded border-2 border-black px-3 py-1 text-sm"
            disabled={busy}
            type="submit"
          >
            {busy ? 'Sending…' : 'Submit'}
          </button>
        )}
        <button
          className="rounded border-2 border-black px-3 py-1 text-sm"
          disabled={busy}
          type="button"
          onClick={() => void respond('decline')}
        >
          Decline
        </button>
        <button
          className="rounded border-2 border-black px-3 py-1 text-sm"
          disabled={busy}
          type="button"
          onClick={() => void respond('cancel')}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
