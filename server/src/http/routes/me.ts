import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { publicAccount, type Account } from '../../accounts/service.js';
import type { Services } from '../../services.js';
import type { Auth } from '../context.js';

const patchBody = z
  .object({ displayName: z.string().min(1).max(100).optional(), showOnLeaderboards: z.boolean().optional() })
  .strict()
  .refine((b) => b.displayName !== undefined || b.showOnLeaderboards !== undefined, { message: 'Nothing to change' });
const termsBody = z.object({ version: z.number().int().min(1) }).strict();
const pushRegisterBody = z.object({ token: z.string().min(8).max(4096), platform: z.enum(['ios', 'android']) }).strict();
const pushTokenBody = z.object({ token: z.string().min(8).max(4096) }).strict();
const pushSettingsBody = z
  .object({ match: z.boolean().optional(), ranked: z.boolean().optional(), season: z.boolean().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });
const matchesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().datetime().optional(),
});

export function registerMeRoutes(app: FastifyInstance, services: Services, auth: Auth): void {
  const privateFlags = (a: Account) => ({
    adultConfirmed: services.accounts.meetsAgeRequirement(a),
    termsVersion: a.termsVersion,
    currentTermsVersion: services.accounts.termsVersion,
    needsTermsAccept: services.accounts.needsTermsAccept(a),
    showOnLeaderboards: a.showOnLeaderboards,
  });
  app.get('/api/me', async (req) => {
    const account = await auth.require(req);
    const [stats, providers, singles, duos] = await Promise.all([
      services.history.stats(account.id),
      services.accounts.providersOf(account.id),
      services.ratings.singles(account.id),
      services.ratings.duosOf(account.id),
    ]);
    return {
      account: { ...publicAccount(account), createdAt: account.createdAt.toISOString(), ...privateFlags(account) },
      stats,
      /** Ranked ratings. `teams` lists each partner the player has rated games with, best first. */
      ratings: { singles, teams: duos },
      signInMethods: providers,
      /** If set, the app should offer to rejoin this match (after a crash or a restart). */
      activeMatchId: services.registry.activeMatchOf(account.id)?.id ?? null,
    };
  });

  app.patch('/api/me', async (req) => {
    const account = await auth.require(req);
    const body = patchBody.parse(req.body);
    let updated = account;
    if (body.displayName !== undefined) updated = await services.accounts.rename(account.id, body.displayName);
    if (body.showOnLeaderboards !== undefined) updated = await services.accounts.setLeaderboardVisibility(account.id, body.showOnLeaderboards);
    services.sessions.forget(account.id);
    return { account: { ...publicAccount(updated), ...privateFlags(updated) } };
  });

  // For accounts made before adults-only was switched on.
  app.post('/api/me/confirm-adult', async (req) => {
    const account = await auth.require(req);
    const updated = await services.accounts.confirmAdult(account.id);
    services.sessions.forget(account.id);
    return { account: { ...publicAccount(updated), ...privateFlags(updated) } };
  });

  app.post('/api/me/accept-terms', async (req) => {
    const account = await auth.require(req);
    const body = termsBody.parse(req.body);
    const updated = await services.accounts.acceptTerms(account.id, body.version);
    services.sessions.forget(account.id);
    return { account: { ...publicAccount(updated), ...privateFlags(updated) } };
  });

  app.delete('/api/me', async (req) => {
    const account = await auth.require(req);
    services.registry.leaveAll(account.id);
    services.ranked.forget(account.id);
    await services.accounts.delete(account.id);
    services.sessions.forget(account.id);
    return { deleted: true };
  });

  // ------------------------------------------------------------ push notifications
  // The app sends its push token after the player allows notifications, and again whenever the phone gives it a new one.
  app.post('/api/me/push', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const account = await auth.require(req);
    const body = pushRegisterBody.parse(req.body);
    const version = req.headers['x-client-version'];
    await services.push.register(account.id, body.token, body.platform, typeof version === 'string' ? version.slice(0, 20) : null);
    return { registered: true };
  });

  // On sign-out, so the next person on this phone does not get this player's notifications.
  app.delete('/api/me/push', async (req) => {
    const account = await auth.require(req);
    await services.push.unregister(account.id, pushTokenBody.parse(req.body).token);
    return { removed: true };
  });

  app.get('/api/me/push-settings', async (req) => {
    const account = await auth.require(req);
    return { settings: await services.push.settings(account.id) };
  });

  app.put('/api/me/push-settings', async (req) => {
    const account = await auth.require(req);
    return { settings: await services.push.setSettings(account.id, pushSettingsBody.parse(req.body)) };
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
