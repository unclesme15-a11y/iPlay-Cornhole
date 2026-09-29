import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Party } from '../../ranking/ranked.js';
import type { Services } from '../../services.js';
import type { Auth } from '../context.js';

const queueBody = z.object({ mode: z.enum(['singles', 'teams']) }).strict();
const joinPartyBody = z.object({ code: z.string().min(4).max(12) }).strict();
const boardQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const modeParam = z.enum(['singles', 'teams']);

const partyView = (party: Party | null) =>
  party ? { code: party.code, members: party.members.map((m) => ({ accountId: m.id, displayName: m.displayName })), full: party.members.length >= 2 } : null;

export function registerRankedRoutes(app: FastifyInstance, services: Services, auth: Auth): void {
  /** Ranked and parties are for adults on the current terms. */
  const requireSocial = async (req: Parameters<Auth['require']>[0]) => {
    const account = await auth.require(req);
    services.accounts.requireEligibleForSocial(account);
    return account;
  };
  const ref = (a: { id: string; displayName: string }) => ({ id: a.id, displayName: a.displayName });

  // ------------------------------------------------------------------ queue
  app.post('/api/ranked/queue', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const account = await requireSocial(req);
    const body = queueBody.parse(req.body);
    const status = await services.ranked.joinQueue(ref(account), body.mode);
    return reply.status(202).send(status);
  });

  // The app polls this every couple of seconds while it shows "Finding opponents".
  app.get('/api/ranked/queue', async (req) => {
    const account = await auth.require(req);
    return { ...(await services.ranked.status(account.id)), party: partyView(services.ranked.party(account.id)) };
  });

  app.delete('/api/ranked/queue', async (req) => {
    const account = await auth.require(req);
    return { left: services.ranked.leaveQueue(account.id) };
  });

  // ---------------------------------------------------------------- parties
  app.post('/api/parties', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const account = await requireSocial(req);
    const existing = services.ranked.party(account.id);
    const party = services.ranked.createParty(ref(account));
    return reply.status(existing ? 200 : 201).send({ party: partyView(party) });
  });

  app.post('/api/parties/join', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const account = await requireSocial(req);
    const body = joinPartyBody.parse(req.body);
    return { party: partyView(await services.ranked.joinParty(body.code, ref(account))) };
  });

  app.get('/api/parties/me', async (req) => {
    const account = await auth.require(req);
    return { party: partyView(services.ranked.party(account.id)) };
  });

  app.delete('/api/parties/me', async (req) => {
    const account = await auth.require(req);
    services.ranked.leaveParty(account.id);
    return { left: true };
  });

  // ------------------------------------------------------------ leaderboards
  app.get<{ Params: { mode: string } }>('/api/leaderboards/:mode', async (req) => {
    await auth.require(req);
    const mode = modeParam.parse(req.params.mode);
    const q = boardQuery.parse(req.query);
    const page = await services.ratings.top(mode, q.limit, q.offset);
    return { ...page, offset: q.offset, limit: q.limit, next: q.offset + page.entries.length < page.total ? q.offset + q.limit : null };
  });

  app.get<{ Params: { mode: string } }>('/api/leaderboards/:mode/me', async (req) => {
    const account = await auth.require(req);
    const mode = modeParam.parse(req.params.mode);
    return services.ratings.mine(mode, account.id);
  });
}
