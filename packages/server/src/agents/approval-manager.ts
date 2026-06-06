type ApprovalKind = 'command' | 'file_change' | 'permissions';

export type ApprovalDecision =
  | 'approve'
  | 'approve_for_session'
  | 'approve_with_policy'
  | 'reject'
  | 'cancel';

export interface PendingApproval {
  id: string;
  kind: ApprovalKind;
  title: string;
  command?: string;
  reason?: string;
  policyAmendment?: string;
  createdAt: number;
  decide: (decision: ApprovalDecision) => void;
  cancel: () => void;
}

let nextApprovalId = 1;
const pending = new Map<string, PendingApproval>();

export function registerApproval(input: Omit<PendingApproval, 'id' | 'createdAt'>): PendingApproval {
  const approval: PendingApproval = {
    ...input,
    id: `approval-${Date.now()}-${nextApprovalId++}`,
    createdAt: Date.now(),
  };
  pending.set(approval.id, approval);
  return approval;
}

export function resolveApproval(id: string, decision: ApprovalDecision): boolean {
  const approval = pending.get(id);
  if (!approval) return false;
  pending.delete(id);
  approval.decide(decision);
  return true;
}

export function cancelApproval(id: string): void {
  const approval = pending.get(id);
  if (!approval) return;
  pending.delete(id);
  approval.cancel();
}

export function listPendingApprovals(): PendingApproval[] {
  return Array.from(pending.values()).sort((a, b) => a.createdAt - b.createdAt);
}
