import type { FastifyInstance } from 'fastify';
import {
  getPendingApproval,
  listPendingApprovals,
  resolveApproval,
  type PendingApproval,
  type ApprovalDecision,
} from '../agents/approval-manager.js';
import { getUserFromRequest } from '../auth/session.js';
import { canAccessChannel } from '../auth/channel-access.js';
import { dbForResource } from './_helpers.js';

const DECISIONS = new Set<ApprovalDecision>([
  'approve',
  'approve_for_session',
  'approve_with_policy',
  'reject',
  'cancel',
]);

export async function agentApprovalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agent-approvals', async (req, reply) => {
    const user = getUserFromRequest(req);
    if (!user) {
      reply.code(403);
      return { error: 'forbidden' };
    }

    return listPendingApprovals()
      .filter((approval) => canUserResolveApproval(approval, user))
      .map(toPublicApproval);
  });

  app.post('/api/agent-approvals/:id/decision', async (req, reply) => {
    const user = getUserFromRequest(req);
    if (!user) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    const { id } = req.params as { id: string };
    const body = req.body as { decision?: ApprovalDecision };
    const decision = body?.decision;

    if (!decision || !DECISIONS.has(decision)) {
      reply.code(400);
      return {
        error: 'decision must be approve, approve_for_session, approve_with_policy, reject, or cancel',
      };
    }

    const approval = getPendingApproval(id);
    if (!approval) {
      reply.code(404);
      return { error: 'approval request not found or already resolved' };
    }
    if (!canUserResolveApproval(approval, user)) {
      reply.code(403);
      return { error: 'forbidden' };
    }

    if (!resolveApproval(id, decision)) {
      reply.code(404);
      return { error: 'approval request not found or already resolved' };
    }

    return { ok: true };
  });
}

function canUserResolveApproval(
  approval: PendingApproval,
  user: NonNullable<ReturnType<typeof getUserFromRequest>>,
): boolean {
  if (user.role === 'admin') return true;
  if (!approval.channel_id) return false;
  const ctx = dbForResource('channels', approval.channel_id);
  if (!ctx) return false;
  return canAccessChannel(ctx.db, approval.channel_id, user);
}

function toPublicApproval(approval: PendingApproval): Omit<PendingApproval, 'decide' | 'cancel'> {
  const { decide: _decide, cancel: _cancel, ...publicApproval } = approval;
  return publicApproval;
}
