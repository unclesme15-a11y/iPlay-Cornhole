import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REPORT_REASONS } from '../../accounts/moderation.js';
import type { Services } from '../../services.js';
import type { Auth } from '../context.js';

const reportBody = z
  .object({
    accountId: z.string().min(1).max(64),
    matchId: z.string().min(1).max(40).optional(),
    reason: z.enum(REPORT_REASONS),
    note: z.string().max(1000).optional(),
  })
  .strict();

export function registerSocialRoutes(app: FastifyInstance, services: Services, auth: Auth): void {
  app.get('/api/blocks', async (req) => {
    const account = await auth.require(req);
    const blocks = await services.moderation.listBlocks(account.id);
    return { blocks: blocks.map((b) => ({ ...b, blockedAt: b.blockedAt.toISOString() })) };
  });

  // Blocking is one-way and private. The app uses this list to mute the person's voice.
  app.put<{ Params: { accountId: string } }>('/api/blocks/:accountId', async (req) => {
    const account = await auth.require(req);
    await services.moderation.block(account.id, req.params.accountId);
    return { blocked: true };
  });

  app.delete<{ Params: { accountId: string } }>('/api/blocks/:accountId', async (req) => {
    const account = await auth.require(req);
    await services.moderation.unblock(account.id, req.params.accountId);
    return { blocked: false };
  });

  app.post('/api/reports', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const account = await auth.require(req);
    const body = reportBody.parse(req.body);
    const report = await services.moderation.report({
      reporterId: account.id,
      reportedId: body.accountId,
      reason: body.reason,
      matchId: body.matchId,
      note: body.note,
    });
    return reply.status(201).send({ reportId: report.id, status: report.status });
  });
}
