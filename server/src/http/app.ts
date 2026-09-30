import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  BAG,
  BAG_COLORS,
  BOARD,
  CHARACTERS,
  CHARACTER_PICK_TIMER_MS,
  COLOR_PICK_TIMER_MS,
  DISTANCE_IN,
  TARGET_SCORES,
} from '../core/constants.js';
import { DomainError } from '../core/errors.js';
import { DEFAULT_CONFIG } from '../core/types.js';
import { BOT_LEVELS } from '../bots/botPolicy.js';
import { NAME_MAX, NAME_MIN } from '../accounts/nameFilter.js';
import { PROTOCOL_VERSION } from '../lobby/session.js';
import { LED_BOARD, SOUNDS } from '../presentation/effects.js';
import { THROWING_GUIDE } from '../physics/guide.js';
import type { Services } from '../services.js';
import { makeAuth } from './context.js';
import { registerRealtime } from './realtime.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerClientErrorRoutes } from './routes/clientErrors.js';
import { registerInviteRoutes } from './routes/invites.js';
import { registerMatchRoutes } from './routes/matches.js';
import { registerMeRoutes } from './routes/me.js';
import { registerRankedRoutes } from './routes/ranked.js';
import { registerSiteRoutes } from './routes/site.js';
import { registerSocialRoutes } from './routes/social.js';
import { registerVoiceRoutes } from './routes/voice.js';
import { registerVersionGate } from './version.js';

export interface BuiltApp {
  app: FastifyInstance;
  services: Services;
  /** Closes every open realtime connection with the "server restarting, please reconnect" code. */
  closeSockets(): void;
}

export async function buildApp(services: Services): Promise<BuiltApp> {
  const { config, registry } = services;
  const app = Fastify({
    logger: config.LOG_LEVEL === 'silent' ? false : { level: config.LOG_LEVEL, redact: ['req.headers.authorization'] },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 16 * 1024,
  });

  // Clients like Unity send `Content-Type: application/json` on every POST, even the ones with no
  // body (start, leave). Fastify rejects that by default, so drop the header when the body is empty.
  app.addHook('onRequest', async (req) => {
    if (req.headers['content-length'] === '0' && req.headers['content-type']?.startsWith('application/json')) {
      delete req.headers['content-type'];
    }
  });

  await app.register(rateLimit, { global: true, max: config.RATE_LIMIT_PER_MIN, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 4096 } });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message, ...error.details } });
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
    services.alerts.send('error:unhandled', `Unexpected error on ${request.method} ${request.routeOptions?.url ?? request.url.split('?')[0]}: ${(error as Error).message}`);
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong' } });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } }));

  const auth = makeAuth(services);
  registerVersionGate(app, services);

  // ---------------------------------------------------------------- health / meta
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/ready', { config: { rateLimit: false } }, async () => {
    await services.db.query('SELECT 1');
    return { status: 'ready', matches: registry.size, maintenance: registry.maintenance };
  });

  app.get('/api/meta', async () => ({
    protocol: PROTOCOL_VERSION,
    defaults: DEFAULT_CONFIG,
    targetScores: TARGET_SCORES,
    botLevels: BOT_LEVELS,
    colors: BAG_COLORS,
    characters: CHARACTERS,
    board: BOARD,
    bag: BAG,
    distanceIn: DISTANCE_IN,
    timers: { colorPickMs: COLOR_PICK_TIMER_MS, characterPickMs: CHARACTER_PICK_TIMER_MS },
    limits: { displayName: { min: NAME_MIN, max: NAME_MAX } },
    signIn: {
      guest: config.ALLOW_GUESTS,
      apple: services.providers.isConfigured('apple'),
      google: services.providers.isConfigured('google'),
    },
    led: LED_BOARD,
    sounds: SOUNDS,
    voice: { enabled: services.voice.enabled, provider: services.voice.enabled ? 'vivox' : null },
    ads: {
      enabled: config.ADS_ENABLED,
      interstitialEveryNMatches: config.ADS_INTERSTITIAL_EVERY_N_MATCHES,
      minSecondsBetweenInterstitials: config.ADS_MIN_SECONDS_BETWEEN_INTERSTITIALS,
      menuBanner: config.ADS_MENU_BANNER,
      /** Never show an ad while a match is being played (from the coin toss to the last bag). */
      duringMatch: false,
    },
    ranked: { modes: ['singles', 'teams'], playTo: 21, cooldownMinutes: 10 },
    terms: { currentVersion: config.TERMS_VERSION, minAge: 18 },
    /** The public pages this server hosts (the app's Profile > Help links). */
    links: {
      privacy: `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/privacy`,
      terms: `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/terms`,
      support: `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/support`,
      deleteAccount: `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/delete-account`,
    },
    throwing: THROWING_GUIDE,
  }));

  registerAuthRoutes(app, services, auth);
  registerMeRoutes(app, services, auth);
  registerSocialRoutes(app, services, auth);
  registerMatchRoutes(app, services, auth);
  registerRankedRoutes(app, services, auth);
  registerVoiceRoutes(app, services, auth);
  registerInviteRoutes(app, services);
  registerSiteRoutes(app, services);
  registerClientErrorRoutes(app, services);
  registerAdminRoutes(app, services);
  const realtime = registerRealtime(app, services);

  return { app, services, closeSockets: realtime.closeAll };
}
