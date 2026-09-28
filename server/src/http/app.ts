import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import {
  BAG,
  BAG_COLORS,
  BOARD,
  CHARACTERS,
  COLOR_PICK_TIMER_MS,
  CHARACTER_PICK_TIMER_MS,
  DISTANCE_IN,
  TARGET_SCORES,
} from '../core/constants.js';
import { resolveConfig } from '../core/config.js';
import { DomainError } from '../core/errors.js';
import { seatsFor } from '../core/match.js';
import { DEFAULT_CONFIG, type SeatId } from '../core/types.js';
import { BOT_LEVELS } from '../bots/botPolicy.js';
import { RealScheduler, type Scheduler } from '../lobby/scheduler.js';
import type { MatchSession, SeatPlan } from '../lobby/session.js';
import { LED_BOARD, SOUNDS } from '../presentation/effects.js';
import { MatchRegistry } from '../store/registry.js';
import type { AppConfig } from '../config.js';
import { bearerOf, parseBearer } from './auth.js';
import { registerRealtime } from './realtime.js';

const seatId = z.enum(['A1', 'B1', 'A2', 'B2']);
const displayName = z.string().min(1).max(100);

const createBody = z
  .object({
    hostName: displayName,
    config: z.unknown().optional(),
    seats: z
      .record(seatId, z.object({ kind: z.enum(['human', 'bot']), level: z.enum(['rookie', 'regular', 'pro']).optional() }).strict())
      .optional(),
  })
  .strict();

const joinBody = z.object({ name: displayName, seat: seatId.optional() }).strict();
const characterBody = z.object({ characterId: z.string().min(1).max(40) }).strict();
const colorBody = z.object({ colorId: z.string().min(1).max(40) }).strict();
const throwBody = z
  .object({
    power: z.number().finite(),
    aim: z.number().finite(),
    arc: z.number().finite(),
    spin: z.number().finite().default(0),
    leftHanded: z.boolean().optional(),
  })
  .strict();
const eventsQuery = z.object({ since: z.coerce.number().int().min(0).default(0) });

export interface BuildOptions {
  config: Pick<AppConfig, 'LOG_LEVEL' | 'MAX_MATCHES' | 'RATE_LIMIT_PER_MIN' | 'TRUST_PROXY'>;
  scheduler?: Scheduler;
  registry?: MatchRegistry;
}

export interface BuiltApp {
  app: FastifyInstance;
  registry: MatchRegistry;
}

export async function buildApp(opts: BuildOptions): Promise<BuiltApp> {
  const scheduler = opts.scheduler ?? new RealScheduler();
  const registry = opts.registry ?? new MatchRegistry({ scheduler, maxMatches: opts.config.MAX_MATCHES });
  const app = Fastify({
    logger: opts.config.LOG_LEVEL === 'silent' ? false : { level: opts.config.LOG_LEVEL, redact: ['req.headers.authorization'] },
    trustProxy: opts.config.TRUST_PROXY,
    bodyLimit: 16 * 1024,
  });

  // Clients like Unity send `Content-Type: application/json` on every POST, even the ones with no
  // body (start, leave). Fastify rejects that by default, so drop the header when the body is empty.
  app.addHook('onRequest', async (req) => {
    if (req.headers['content-length'] === '0' && req.headers['content-type']?.startsWith('application/json')) {
      delete req.headers['content-type'];
    }
  });

  await app.register(rateLimit, { global: true, max: opts.config.RATE_LIMIT_PER_MIN, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 4096 } });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'bad_request', message: 'Invalid request', issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: (error as { code?: string }).code ?? 'bad_request', message: (error as Error).message } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong' } });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } }));

  const requireMatch = (id: string): MatchSession => {
    const session = registry.get(id);
    if (!session) throw new DomainError('match_not_found', 'Match not found', 404);
    return session;
  };

  const requirePlayer = (session: MatchSession, req: FastifyRequest): string => {
    const creds = parseBearer(req.headers.authorization);
    if (!creds || !session.authenticate(creds.playerId, creds.token)) {
      throw new DomainError('unauthorized', 'Missing or invalid credentials', 401);
    }
    return creds.playerId;
  };

  const optionalPlayer = (session: MatchSession, req: FastifyRequest): string | undefined => {
    const creds = parseBearer(req.headers.authorization);
    return creds && session.authenticate(creds.playerId, creds.token) ? creds.playerId : undefined;
  };

  // ---------------------------------------------------------------- health / meta
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/ready', { config: { rateLimit: false } }, async () => ({ status: 'ready', matches: registry.size }));

  app.get('/api/meta', async () => ({
    defaults: DEFAULT_CONFIG,
    targetScores: TARGET_SCORES,
    botLevels: BOT_LEVELS,
    colors: BAG_COLORS,
    characters: CHARACTERS,
    board: BOARD,
    bag: BAG,
    distanceIn: DISTANCE_IN,
    timers: { colorPickMs: COLOR_PICK_TIMER_MS, characterPickMs: CHARACTER_PICK_TIMER_MS },
    led: LED_BOARD,
    sounds: SOUNDS,
  }));

  // ------------------------------------------------------------------- matches
  app.post('/api/matches', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = createBody.parse(req.body);
    let config;
    try {
      config = resolveConfig(body.config);
    } catch (e) {
      if (e instanceof ZodError) throw e;
      throw new DomainError('bad_config', (e as Error).message);
    }
    const valid = new Set<SeatId>(seatsFor(config.mode));
    const seatPlan: SeatPlan = {};
    for (const [id, plan] of Object.entries(body.seats ?? {}) as Array<[SeatId, NonNullable<SeatPlan[SeatId]>]>) {
      if (!valid.has(id)) throw new DomainError('bad_seat', `Seat ${id} does not exist in a ${config.mode} match`);
      if (id === 'A1' && plan.kind !== 'human') throw new DomainError('bad_seat', 'The host must sit in A1 as a human');
      seatPlan[id] = plan;
    }
    const { session, host } = registry.create({ config, seatPlan, hostName: body.hostName });
    return reply.status(201).send({
      matchId: session.id,
      playerId: host.playerId,
      seat: host.seat,
      bearer: bearerOf(host.playerId, host.token),
      view: session.view(host.playerId),
    });
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/join', async (req, reply) => {
    const session = requireMatch(req.params.id);
    const body = joinBody.parse(req.body);
    const creds = session.join(body.name, body.seat);
    return reply.status(201).send({
      matchId: session.id,
      playerId: creds.playerId,
      seat: creds.seat,
      bearer: bearerOf(creds.playerId, creds.token),
      view: session.view(creds.playerId),
    });
  });

  app.get<{ Params: { id: string } }>('/api/matches/:id', async (req) => {
    const session = requireMatch(req.params.id);
    return session.view(optionalPlayer(session, req));
  });

  app.get<{ Params: { id: string } }>('/api/matches/:id/events', async (req) => {
    const session = requireMatch(req.params.id);
    const { since } = eventsQuery.parse(req.query);
    return { events: session.eventsSince(since), seq: session.view().seq };
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/start', async (req) => {
    const session = requireMatch(req.params.id);
    const playerId = requirePlayer(session, req);
    session.start(playerId);
    return session.view(playerId);
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/character', async (req) => {
    const session = requireMatch(req.params.id);
    const playerId = requirePlayer(session, req);
    session.pickCharacter(playerId, characterBody.parse(req.body).characterId);
    return session.view(playerId);
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/color', async (req) => {
    const session = requireMatch(req.params.id);
    const playerId = requirePlayer(session, req);
    session.pickColor(playerId, colorBody.parse(req.body).colorId);
    return session.view(playerId);
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/throw', async (req) => {
    const session = requireMatch(req.params.id);
    const playerId = requirePlayer(session, req);
    const body = throwBody.parse(req.body);
    session.throw(playerId, {
      power: body.power,
      aim: body.aim,
      arc: body.arc,
      spin: body.spin,
      ...(body.leftHanded !== undefined ? { leftHanded: body.leftHanded } : {}),
    });
    return { accepted: true, seq: session.view().seq };
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/leave', async (req) => {
    const session = requireMatch(req.params.id);
    const playerId = requirePlayer(session, req);
    session.leave(playerId);
    return { left: true };
  });

  registerRealtime(app, registry);
  app.addHook('onClose', async () => registry.dispose());

  return { app, registry };
}
