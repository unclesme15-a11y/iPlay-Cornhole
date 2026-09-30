import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { publicAccount } from '../../accounts/service.js';
import { DomainError } from '../../core/errors.js';
import type { Services } from '../../services.js';

const banBody = z.object({ reason: z.string().min(1).max(500), days: z.number().int().min(1).max(3650).nullable().optional() }).strict();
const resolveBody = z.object({ status: z.enum(['resolved', 'dismissed']) }).strict();
const maintenanceBody = z.object({ enabled: z.boolean() }).strict();
const deletionUpdate = z.object({ status: z.enum(['done', 'rejected']), note: z.string().max(500).optional() }).strict();
const deletionQuery = z.object({
  status: z.enum(['open', 'done', 'rejected', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
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

      // Find accounts by display name (for deletion requests and reports that only give a name).
      admin.get('/accounts', async (req) => {
        const q = z.object({ name: z.string().trim().min(1).max(40) }).parse(req.query);
        const rows = await services.db.query<{ id: string; display_name: string; is_guest: boolean; created_at: Date; last_seen_at: Date }>(
          'SELECT id, display_name, is_guest, created_at, last_seen_at FROM accounts WHERE lower(display_name) = lower($1) ORDER BY created_at DESC LIMIT 20',
          [q.name],
        );
        return {
          accounts: rows.rows.map((r) => ({
            id: r.id,
            displayName: r.display_name,
            isGuest: r.is_guest,
            createdAt: new Date(r.created_at).toISOString(),
            lastSeenAt: new Date(r.last_seen_at).toISOString(),
          })),
        };
      });

      admin.get<{ Params: { id: string } }>('/accounts/:id', async (req) => {
        const account = await services.accounts.get(req.params.id);
        if (!account) throw new DomainError('unknown_account', 'Account not found', 404);
        const reports = await services.db.query<{ n: number }>('SELECT count(*)::int AS n FROM reports WHERE reported_id = $1', [account.id]);
        return {
          account: {
            ...publicAccount(account),
            status: account.status,
            banReason: account.banReason,
            bannedUntil: account.bannedUntil?.toISOString() ?? null,
            createdAt: account.createdAt.toISOString(),
            lastSeenAt: new Date(account.lastSeenAt).toISOString(),
          },
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
        services.ranked.forget(account.id);
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
      // Account deletion: requests from the website (/delete-account), and deleting an account by hand.
      admin.get('/deletion-requests', async (req) => {
        const q = deletionQuery.parse(req.query);
        const rows = await services.db.query<{
          id: string; created_at: Date; display_name: string; contact: string; account_id: string | null; details: string | null; status: string; handled_at: Date | null; note: string | null;
        }>(
          `SELECT id, created_at, display_name, contact, account_id, details, status, handled_at, note FROM deletion_requests
           WHERE ($1 = 'all' OR status = $1) ORDER BY created_at ASC LIMIT $2`,
          [q.status, q.limit],
        );
        return {
          requests: rows.rows.map((r) => ({
            id: r.id,
            createdAt: new Date(r.created_at).toISOString(),
            displayName: r.display_name,
            contact: r.contact,
            accountId: r.account_id,
            details: r.details,
            status: r.status,
            handledAt: r.handled_at ? new Date(r.handled_at).toISOString() : null,
            note: r.note,
          })),
        };
      });

      admin.post<{ Params: { id: string } }>('/deletion-requests/:id', async (req) => {
        const body = deletionUpdate.parse(req.body);
        const res = await services.db.query('UPDATE deletion_requests SET status = $2, note = $3, handled_at = $4 WHERE id = $1', [
          req.params.id,
          body.status,
          body.note ?? null,
          new Date(),
        ]);
        if (res.rowCount === 0) throw new DomainError('unknown_request', 'Deletion request not found', 404);
        audit(req, 'deletion_request', { id: req.params.id, status: body.status });
        return { id: req.params.id, status: body.status };
      });

      admin.post<{ Params: { id: string } }>('/accounts/:id/delete', async (req) => {
        const account = await services.accounts.get(req.params.id);
        if (!account) throw new DomainError('unknown_account', 'Account not found', 404);
        services.registry.leaveAll(account.id);
        services.ranked.forget(account.id);
        await services.accounts.delete(account.id);
        services.sessions.forget(account.id);
        audit(req, 'delete_account', { accountId: account.id });
        return { deleted: true };
      });

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
