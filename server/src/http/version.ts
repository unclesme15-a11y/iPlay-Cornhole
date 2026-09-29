import type { FastifyInstance } from 'fastify';
import { compareVersions } from '../config.js';
import { DomainError } from '../core/errors.js';
import { PROTOCOL_VERSION } from '../lobby/session.js';
import type { Services } from '../services.js';

export const CLIENT_VERSION_HEADER = 'x-client-version';
export const CLIENT_PLATFORM_HEADER = 'x-client-platform';

const VERSION = /^\d+\.\d+\.\d+/;

/** Reads "1.4.2" (or "1.4.2-beta") to "1.4.2". Returns null if it is not a version. */
export function parseClientVersion(raw: string | undefined): string | null {
  const match = raw ? VERSION.exec(raw.trim()) : null;
  return match ? match[0] : null;
}

/** Throws 426 if `version` is older than the minimum the server allows. */
export function assertClientVersion(services: Services, version: string | null): void {
  const { MIN_CLIENT_VERSION, LATEST_CLIENT_VERSION, IOS_STORE_URL, ANDROID_STORE_URL } = services.config;
  if (MIN_CLIENT_VERSION === '0.0.0') return; // check switched off
  if (!version) {
    throw new DomainError('client_version_required', 'Send your app version in the X-Client-Version header', 426, {
      minVersion: MIN_CLIENT_VERSION,
      latestVersion: LATEST_CLIENT_VERSION ?? MIN_CLIENT_VERSION,
    });
  }
  if (compareVersions(version, MIN_CLIENT_VERSION) < 0) {
    throw new DomainError('client_outdated', 'Please update iPlay Cornhole to keep playing', 426, {
      minVersion: MIN_CLIENT_VERSION,
      latestVersion: LATEST_CLIENT_VERSION ?? MIN_CLIENT_VERSION,
      storeUrls: { ios: IOS_STORE_URL ?? null, android: ANDROID_STORE_URL ?? null },
    });
  }
}

/**
 * Turns away apps that are too old. Every /api route is checked except /api/version itself, so an
 * old app can still find out that it needs to update.
 */
export function registerVersionGate(app: FastifyInstance, services: Services): void {
  app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/') || path === '/api/version') return;
    // Game clients often cannot set headers on a WebSocket, so the version is checked in their first message instead.
    if (req.headers.upgrade?.toLowerCase() === 'websocket') return;
    const header = req.headers[CLIENT_VERSION_HEADER];
    const raw = Array.isArray(header) ? header[0] : header;
    const version = parseClientVersion(raw);
    if (raw && !version) throw new DomainError('bad_client_version', 'X-Client-Version must look like 1.2.3', 400);
    assertClientVersion(services, version);
  });

  app.get('/api/version', { config: { rateLimit: false } }, async () => ({
    protocol: PROTOCOL_VERSION,
    minClientVersion: services.config.MIN_CLIENT_VERSION,
    latestClientVersion: services.config.LATEST_CLIENT_VERSION ?? services.config.MIN_CLIENT_VERSION,
    maintenance: services.registry.maintenance,
    serverTime: new Date(services.scheduler.now()).toISOString(),
  }));
}
