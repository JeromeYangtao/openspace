import { useState, type ReactNode } from 'react';
import type { PendingAgentApproval } from '../lib/api';
import { decideAgentApproval } from '../lib/api';
import type { ApprovalResolution } from '../stores/approvals';
import { useApprovalsStore } from '../stores/approvals';
import { cn } from '../lib/cn';

function resolutionForDecision(
  decision: 'approve' | 'approve_for_session' | 'reject',
): ApprovalResolution {
  if (decision === 'approve') return 'approved';
  if (decision === 'approve_for_session') return 'approved_for_session';
  return 'rejected';
}

export function GlobalApprovalBanner() {
  const pending = useApprovalsStore((s) => s.pending);
  const markResolved = useApprovalsStore((s) => s.markResolved);
  const [pendingDecision, setPendingDecision] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  if (pending.length === 0) return null;

  const decide = async (
    approval: PendingAgentApproval,
    decision: 'approve' | 'approve_for_session' | 'reject',
  ) => {
    setPendingDecision(`${approval.id}:${decision}`);
    setErrorById((errors) => ({ ...errors, [approval.id]: '' }));
    try {
      await decideAgentApproval(approval.id, decision);
      markResolved(approval.id, resolutionForDecision(decision));
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('already resolved')) {
        markResolved(approval.id, 'resolved');
      } else {
        setErrorById((errors) => ({ ...errors, [approval.id]: message }));
      }
    } finally {
      setPendingDecision(null);
    }
  };

  return (
    <div className="sticky top-0 z-30 border-b-2 border-black bg-accent-yellow px-3 py-2">
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        {pending.map((approval) => (
          <div
            key={approval.id}
            className="flex flex-col gap-2 rounded border-2 border-black bg-bg-card p-2 text-xs sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="font-bold text-black">{approval.title || 'Approval requested'}</div>
              <div className="mt-1 truncate font-mono text-[11px] text-text-secondary">
                {approval.command || approval.reason || approval.kind}
              </div>
              {errorById[approval.id] && (
                <div className="mt-1 font-mono text-[11px] text-accent-red">
                  {errorById[approval.id]}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <DecisionButton
                busy={pendingDecision === `${approval.id}:approve`}
                disabled={pendingDecision !== null}
                onClick={() => void decide(approval, 'approve')}
              >
                Approve
              </DecisionButton>
              <DecisionButton
                busy={pendingDecision === `${approval.id}:approve_for_session`}
                disabled={pendingDecision !== null}
                onClick={() => void decide(approval, 'approve_for_session')}
              >
                Allow for session
              </DecisionButton>
              <DecisionButton
                busy={pendingDecision === `${approval.id}:reject`}
                disabled={pendingDecision !== null}
                onClick={() => void decide(approval, 'reject')}
              >
                Reject
              </DecisionButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionButton({
  busy,
  disabled,
  onClick,
  children,
}: {
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded border-2 border-black bg-white px-2 py-1 text-[11px] font-bold',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent-green',
      )}
    >
      {busy ? 'Working...' : children}
    </button>
  );
}
