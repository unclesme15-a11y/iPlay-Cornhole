import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { publicAccount } from '../../accounts/service.js';
import type { Services } from '../../services.js';
import type { Auth } from '../context.js';

const renameBody = z.object({ displayName: z.string().min(1).max(100) }).strict();
const matchesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().datetime().optional(),
});

export function registerMeRoutes(app: FastifyInstance, services: Services, auth: Auth): void {
  app.get('/api/me', async (req) => {
    const account = await auth.require(req);
    const [stats, providers] = await Promise.all([services.history.stats(account.id), services.accounts.providersOf(account.id)]);
    return {
      account: { ...publicAccount(account), createdAt: account.createdAt.toISOString() },
      stats,
      signInMethods: providers,
      /** If set, the app should offer to rejoin this match (after a crash or a restart). */
      activeMatchId: services.registry.activeMatchOf(account.id)?.id ?? null,
    };
  });

  app.patch('/api/me', async (req) => {
    const account = await auth.require(req);
    const body = renameBody.parse(req.body);
    const updated = await services.accounts.rename(account.id, body.displayName);
    services.sessions.forget(account.id);
    return { account: publicAccount(updated) };
  });

  app.delete('/api/me', async (req) => {
    const account = await auth.require(req);
    services.registry.leaveAll(account.id);
    await services.accounts.delete(account.id);
    services.sessions.forget(account.id);
    return { deleted: true };
  });

  app.get('/api/me/export', async (req) => {
    const account = await auth.require(req);
    return services.accounts.exportData(account.id);
  });

  app.get('/api/me/matches', async (req) => {
    const account = await auth.require(req);
    const q = matchesQuery.parse(req.query);
    const matches = await services.history.recent(account.id, q.limit, q.before ? new Date(q.before) : undefined);
    return {
      matches: matches.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
        startedAt: m.startedAt?.toISOString() ?? null,
        endedAt: m.endedAt.toISOString(),
      })),
      next: matches.length === q.limit ? matches[matches.length - 1]!.endedAt.toISOString() : null,
    };
  });
}
