import type { FastifyInstance } from 'fastify';
import {
  listPendingApprovals,
  resolveApproval,
  type ApprovalDecision,
} from '../agents/approval-manager.js';

const DECISIONS = new Set<ApprovalDecision>([
  'approve',
  'approve_for_session',
  'reject',
  'cancel',
]);

export async function agentApprovalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agent-approvals', async () =>
    listPendingApprovals().map(({ decide: _decide, cancel: _cancel, ...approval }) => approval),
  );

  app.post('/api/agent-approvals/:id/decision', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { decision?: ApprovalDecision };
    const decision = body?.decision;

    if (!decision || !DECISIONS.has(decision)) {
      reply.code(400);
      return { error: 'decision must be approve, approve_for_session, reject, or cancel' };
    }

    if (!resolveApproval(id, decision)) {
      reply.code(404);
      return { error: 'approval request not found or already resolved' };
    }

    return { ok: true };
  });
}
