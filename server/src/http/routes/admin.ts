import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { publicAccount } from '../../accounts/service.js';
import { DomainError } from '../../core/errors.js';
import type { Services } from '../../services.js';

const banBody = z.object({ reason: z.string().min(1).max(500), days: z.number().int().min(1).max(3650).nullable().optional() }).strict();
const resolveBody = z.object({ status: z.enum(['resolved', 'dismissed']) }).strict();
const maintenanceBody = z.object({ enabled: z.boolean() }).strict();
const reportsQuery = z.object({
  status: z.enum(['open', 'resolved', 'dismissed', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();

/**
 * Staff tools for moderation and deploys. Guarded by one secret (ADMIN_TOKEN). With no secret set
 * these routes do not exist at all.
 */
export function registerAdminRoutes(app: FastifyInstance, services: Services): void {
  const token = services.config.ADMIN_TOKEN;
  if (!token) return;
  const expected = sha256(`Bearer ${token}`);

  void app.register(
    async (admin) => {
      admin.addHook('onRequest', async (req) => {
        const given = sha256(req.headers.authorization ?? '');
        if (!timingSafeEqual(given, expected)) throw new DomainError('unauthorized', 'Missing or invalid credentials', 401);
      });

      const audit = (req: { log: { info: (o: object, m: string) => void } }, action: string, target: Record<string, unknown>): void =>
        req.log.info({ admin: true, action, ...target }, 'admin action');

      admin.get('/status', async () => {
        const [accounts, openReports] = await Promise.all([
          services.db.query<{ n: number }>('SELECT count(*)::int AS n FROM accounts'),
          services.db.query<{ n: number }>("SELECT count(*)::int AS n FROM reports WHERE status = 'open'"),
        ]);
        return {
          liveMatches: services.registry.size,
          maintenance: services.registry.maintenance,
          accounts: accounts.rows[0]!.n,
          openReports: openReports.rows[0]!.n,
        };
      });

      admin.get<{ Params: { id: string } }>('/accounts/:id', async (req) => {
        const account = await services.accounts.get(req.params.id);
        if (!account) throw new DomainError('unknown_account', 'Account not found', 404);
        const reports = await services.db.query<{ n: number }>('SELECT count(*)::int AS n FROM reports WHERE reported_id = $1', [account.id]);
        return {
          account: { ...publicAccount(account), status: account.status, banReason: account.banReason, bannedUntil: account.bannedUntil?.toISOString() ?? null, createdAt: account.createdAt.toISOString() },
          stats: await services.history.stats(account.id),
          activeMatchId: services.registry.activeMatchOf(account.id)?.id ?? null,
          reportsAgainst: reports.rows[0]!.n,
        };
      });

      admin.post<{ Params: { id: string } }>('/accounts/:id/ban', async (req) => {
        const body = banBody.parse(req.body);
        const until = body.days ? new Date(services.scheduler.now() + body.days * 24 * 60 * 60_000) : null;
        const account = await services.accounts.ban(req.params.id, body.reason, until);
        // Take effect right now on this server: forget the cached login and pull them out of their match.
        services.sessions.forget(account.id);
        services.registry.leaveAll(account.id);
        audit(req, 'ban', { accountId: account.id, until: until?.toISOString() ?? 'permanent' });
        return { account: { ...publicAccount(account), status: account.status, bannedUntil: until?.toISOString() ?? null } };
      });

      admin.post<{ Params: { id: string } }>('/accounts/:id/unban', async (req) => {
        const account = await services.accounts.unban(req.params.id);
        services.sessions.forget(account.id);
        audit(req, 'unban', { accountId: account.id });
        return { account: { ...publicAccount(account), status: account.status } };
      });

      admin.get('/reports', async (req) => {
        const q = reportsQuery.parse(req.query);
        const reports = await services.moderation.listReports(q.status, q.limit);
        return { reports: reports.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null })) };
      });

      admin.post<{ Params: { id: string } }>('/reports/:id', async (req) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id < 1) throw new DomainError('report_not_found', 'No open report with that id', 404);
        const report = await services.moderation.resolveReport(id, resolveBody.parse(req.body).status);
        audit(req, 'resolve_report', { reportId: id, status: report.status });
        return { reportId: report.id, status: report.status };
      });

      // Switch off new matches before a deploy so nobody is dropped into a server about to restart.
      admin.post('/maintenance', async (req) => {
        const { enabled } = maintenanceBody.parse(req.body);
        services.registry.maintenance = enabled;
        audit(req, 'maintenance', { enabled });
        return { maintenance: enabled };
      });
    },
    { prefix: '/admin' },
  );
}
