import { create } from 'zustand';

export type ApprovalResolution = 'approved' | 'approved_for_session' | 'rejected' | 'resolved';

interface ApprovalsState {
  resolvedById: Map<string, ApprovalResolution>;
  markResolved: (id: string, resolution: ApprovalResolution) => void;
  getResolution: (id?: string) => ApprovalResolution | undefined;
}

export const useApprovalsStore = create<ApprovalsState>((set, get) => ({
  resolvedById: new Map(),
  markResolved: (id, resolution) =>
    set((s) => {
      const next = new Map(s.resolvedById);
      next.set(id, resolution);
      return { resolvedById: next };
    }),
  getResolution: (id) => (id ? get().resolvedById.get(id) : undefined),
}));
