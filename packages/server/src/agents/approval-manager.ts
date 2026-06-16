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
  channel_id?: string;
  agent_id?: string;
  run_id?: number;
  message_id?: string;
  createdAt: number;
  decide: (decision: ApprovalDecision) => void;
  cancel: () => void;
}

export interface ApprovalContext {
  channel_id?: string;
  agent_id?: string;
  run_id?: number;
  message_id?: string;
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

export function getPendingApproval(id: string): PendingApproval | null {
  return pending.get(id) ?? null;
}

export function attachApprovalContext(id: string, context: ApprovalContext): boolean {
  const approval = pending.get(id);
  if (!approval) return false;
  if (context.channel_id !== undefined) approval.channel_id = context.channel_id;
  if (context.agent_id !== undefined) approval.agent_id = context.agent_id;
  if (context.run_id !== undefined) approval.run_id = context.run_id;
  if (context.message_id !== undefined) approval.message_id = context.message_id;
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
