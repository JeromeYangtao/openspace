import type { FastifyInstance } from 'fastify';
import type { AgentInputRequest, AgentInputResponse } from '@openspace/shared';
import { getPendingInput, listPendingInputs, resolveInput } from '../agents/input-manager.js';
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
  app.get('/api/agent-inputs', async (req, reply) => {
    const user = getUserFromRequest(req);
    if (!user) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    return listPendingInputs().filter((input) => canUserResolveApproval(input, user));
  });
  app.post('/api/agent-inputs/:id/response', async (req, reply) => {
    const user = getUserFromRequest(req);
    if (!user) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    const { id } = req.params as { id: string };
    const input = getPendingInput(id);
    if (!input) {
      reply.code(404);
      return { error: 'input request already resolved' };
    }
    if (!canUserResolveApproval(input, user)) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    try {
      resolveInput(id, req.body as AgentInputResponse);
    } catch (error) {
      reply.code(400);
      return { error: (error as Error).message };
    }
    return { ok: true };
  });
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
        error:
          'decision must be approve, approve_for_session, approve_with_policy, reject, or cancel',
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
  approval: Pick<PendingApproval | AgentInputRequest, 'channel_id'>,
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
