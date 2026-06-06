import { create } from 'zustand';
import { listAgentApprovals, type PendingAgentApproval } from '../lib/api';

export type ApprovalResolution =
  | 'approved'
  | 'approved_for_session'
  | 'approved_with_policy'
  | 'rejected'
  | 'resolved';

interface ApprovalsState {
  resolvedById: Map<string, ApprovalResolution>;
  pending: PendingAgentApproval[];
  loading: boolean;
  refreshPending: () => Promise<void>;
  markResolved: (id: string, resolution: ApprovalResolution) => void;
  getResolution: (id?: string) => ApprovalResolution | undefined;
}

export const useApprovalsStore = create<ApprovalsState>((set, get) => ({
  resolvedById: new Map(),
  pending: [],
  loading: false,
  refreshPending: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const pending = await listAgentApprovals();
      set((s) => ({
        pending: pending.filter((approval) => !s.resolvedById.has(approval.id)),
        loading: false,
      }));
    } catch {
      set({ loading: false });
    }
  },
  markResolved: (id, resolution) =>
    set((s) => {
      const next = new Map(s.resolvedById);
      next.set(id, resolution);
      return {
        resolvedById: next,
        pending: s.pending.filter((approval) => approval.id !== id),
      };
    }),
  getResolution: (id) => (id ? get().resolvedById.get(id) : undefined),
}));
