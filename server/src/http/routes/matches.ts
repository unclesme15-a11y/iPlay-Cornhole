import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveConfig } from '../../core/config.js';
import { DomainError } from '../../core/errors.js';
import { seatsFor } from '../../core/match.js';
import type { SeatId } from '../../core/types.js';
import type { MatchSession, SeatPlan } from '../../lobby/session.js';
import { releaseSchema } from '../../physics/release.js';
import type { Services } from '../../services.js';
import type { Auth } from '../context.js';

const seatId = z.enum(['A1', 'B1', 'A2', 'B2']);
const botLevel = z.enum(['rookie', 'regular', 'pro']);
const seatPlanSchema = z.record(seatId, z.object({ kind: z.enum(['human', 'bot']), level: botLevel.optional() }).strict());

const createBody = z.object({ config: z.unknown().optional(), seats: seatPlanSchema.optional() }).strict();
const joinBody = z.object({ seat: seatId.optional() }).strict();
const startBody = z.object({ fillOpenWithBots: z.boolean().optional() }).strict();
const characterBody = z.object({ characterId: z.string().min(1).max(40) }).strict();
const colorBody = z.object({ colorId: z.string().min(1).max(40) }).strict();
const seatBody = z.object({ seat: seatId, kind: z.enum(['human', 'bot']), level: botLevel.optional() }).strict();
const kickBody = z.object({ seat: seatId }).strict();
const rematchBody = z.object({ accept: z.boolean() }).strict();
const throwBody = z
  .object({
    power: z.number().finite(),
    aim: z.number().finite(),
    arc: z.number().finite(),
    spin: z.number().finite().default(0),
    leftHanded: z.boolean().optional(),
    /** How the player flicked (recommended). Without it the throw is taken as a perfectly clean release. */
    release: releaseSchema.optional(),
  })
  .strict();
const eventsQuery = z.object({ since: z.coerce.number().int().min(0).default(0) });

/** Where a friend can tap to join. `url` opens the app if installed, or a web page with store links if not. */
export function inviteFor(services: Services, code: string): { code: string; url: string; deepLink: string } {
  const base = services.config.PUBLIC_BASE_URL.replace(/\/+$/, '');
  return { code, url: `${base}/join/${code}`, deepLink: `${services.config.DEEP_LINK_SCHEME}://join/${code}` };
}

export function registerMatchRoutes(app: FastifyInstance, services: Services, auth: Auth): void {
  const { registry } = services;

  const requireMatch = (id: string): MatchSession => {
    const session = registry.get(id);
    if (!session) throw new DomainError('match_not_found', 'Match not found', 404);
    return session;
  };

  app.post('/api/matches', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const account = await auth.require(req);
    const body = createBody.parse(req.body ?? {});
    let config;
    try {
      config = resolveConfig(body.config);
    } catch (e) {
      if (e instanceof z.ZodError) throw e;
      throw new DomainError('bad_config', (e as Error).message);
    }
    const valid = new Set<SeatId>(seatsFor(config.mode));
    const seatPlan: SeatPlan = {};
    for (const [id, plan] of Object.entries(body.seats ?? {}) as Array<[SeatId, NonNullable<SeatPlan[SeatId]>]>) {
      if (!valid.has(id)) throw new DomainError('bad_seat', `Seat ${id} does not exist in a ${config.mode} match`);
      if (id === 'A1' && plan.kind !== 'human') throw new DomainError('bad_seat', 'The host must sit in A1 as a human');
      seatPlan[id] = plan;
    }
    const session = registry.create({ config, seatPlan, host: { id: account.id, displayName: account.displayName } });
    return reply.status(201).send({
      matchId: session.id,
      seat: session.seatOf(account.id),
      invite: inviteFor(services, session.id),
      view: session.view(account.id),
    });
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/join', async (req, reply) => {
    const account = await auth.require(req);
    const session = requireMatch(req.params.id);
    const body = joinBody.parse(req.body ?? {});
    const seated = registry.join(session, { id: account.id, displayName: account.displayName }, body.seat);
    return reply.status(201).send({ matchId: session.id, seat: seated.seat, view: session.view(account.id) });
  });

  // Anyone with the code can look (spectators, the join screen). Credentials add `you`.
  app.get<{ Params: { id: string } }>('/api/matches/:id', async (req) => {
    const session = requireMatch(req.params.id);
    const account = await auth.optional(req);
    return session.view(account?.id);
  });

  app.get<{ Params: { id: string } }>('/api/matches/:id/events', async (req) => {
    const session = requireMatch(req.params.id);
    const { since } = eventsQuery.parse(req.query);
    // A `since` beyond our latest event means the server restarted and forgot some: reload the view instead.
    const resync = since > session.seqNumber;
    return { events: resync ? [] : session.eventsSince(since), seq: session.seqNumber, resync };
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/start', async (req) => {
    const account = await auth.require(req);
    const session = requireMatch(req.params.id);
    const body = startBody.parse(req.body ?? {});
    session.start(account.id, body);
    return session.view(account.id);
  });

  // ---- lobby: editing seats, removing players ----

  app.post<{ Params: { id: string } }>('/api/matches/:id/seats', async (req) => {
    const account = await auth.require(req);
    const session = requireMatch(req.params.id);
    const body = seatBody.parse(req.body);
    session.setSeat(account.id, body.seat, body.kind, body.level);
    return session.view(account.id);
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/kick', async (req) => {
    const account = await auth.require(req);
    const session = requireMatch(req.params.id);
    session.kick(account.id, kickBody.parse(req.body).seat);
    return session.view(account.id);
  });

  // ---- picks ----

  app.post<{ Params: { id: string } }>('/api/matches/:id/character', async (req) => {
    const account = await auth.require(req);
    const session = requireMatch(req.params.id);
    session.pickCharacter(account.id, characterBody.parse(req.body).characterId);
    return session.view(account.id);
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/color', async (req) => {
    const account = await auth.require(req);
    const session = requireMatch(req.params.id);
    session.pickColor(account.id, colorBody.parse(req.body).colorId);
    return session.view(account.id);
  });

  // ---- playing ----

  app.post<{ Params: { id: string } }>('/api/matches/:id/throw', async (req) => {
    const account = await auth.require(req);
    const session = requireMatch(req.params.id);
    const body = throwBody.parse(req.body);
    session.throw(account.id, {
      power: body.power,
      aim: body.aim,
      arc: body.arc,
      spin: body.spin,
      ...(body.leftHanded !== undefined ? { leftHanded: body.leftHanded } : {}),
    }, body.release);
    return { accepted: true, seq: session.seqNumber };
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/leave', async (req) => {
    const account = await auth.require(req);
    const session = requireMatch(req.params.id);
    session.leave(account.id);
    return { left: true };
  });

  // ---- after the match ----

  app.post<{ Params: { id: string } }>('/api/matches/:id/rematch', async (req) => {
    const account = await auth.require(req);
    const session = requireMatch(req.params.id);
    session.voteRematch(account.id, rematchBody.parse(req.body).accept);
    return session.view(account.id);
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/invite', async (req) => {
    const account = await auth.require(req);
    const session = requireMatch(req.params.id);
    if (!session.hasActivePlayer(account.id)) throw new DomainError('unknown_player', 'You are not in this match', 404);
    return inviteFor(services, session.id);
  });
}
