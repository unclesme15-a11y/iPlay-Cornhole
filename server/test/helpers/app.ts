import type { AddressInfo } from 'node:net';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import WebSocket from 'ws';
import { loadConfig, type AppConfig } from '../../src/config.js';
import type { Db } from '../../src/db/types.js';
import { buildApp, type BuiltApp } from '../../src/http/app.js';
import { ManualScheduler } from '../../src/lobby/scheduler.js';
import { createServices, type ServiceOverrides, type Services } from '../../src/services.js';
import { backends, openTestDb, type TestDb } from './db.js';

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export interface Booted {
  app: FastifyInstance;
  services: Services;
  scheduler: ManualScheduler;
  db: Db;
  built: BuiltApp;
  /** Sign up a fresh guest and return their token and account. */
  guest(name?: string): Promise<{ token: string; id: string; name: string }>;
  /** Shortcut for an authenticated request. */
  call(token: string | null, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers?: Record<string, string>): Promise<LightMyRequestResponse>;
  /** Start listening on a random port (for WebSocket tests). */
  listen(): Promise<number>;
  close(): Promise<void>;
}

export interface BootOptions {
  env?: Record<string, string>;
  overrides?: ServiceOverrides;
  scheduler?: ManualScheduler;
}

/**
 * One database per test file (they are slow to create); every `boot()` gets clean tables and its own
 * services, clock and app, so tests cannot affect each other.
 */
export class TestEnv {
  private handle: TestDb | null = null;
  private live: Booted[] = [];

  static async create(): Promise<TestEnv> {
    const env = new TestEnv();
    env.handle = await openTestDb();
    return env;
  }

  get db(): Db {
    return this.handle!.db;
  }

  async boot(opts: BootOptions = {}): Promise<Booted> {
    const db = this.db;
    await db.exec('TRUNCATE accounts, matches, live_matches, reports RESTART IDENTITY CASCADE');
    const scheduler = opts.scheduler ?? new ManualScheduler();
    const config: AppConfig = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_PER_MIN: '100000', ...opts.env });
    const services = createServices(db, scheduler, config, { persistDebounceMs: 10, ...opts.overrides });
    const built = await buildApp(services);
    const { app } = built;

    const call: Booted['call'] = (token, method, url, payload, headers) => {
      const options: InjectOptions = { method, url, headers: { ...(token ? auth(token) : {}), ...headers } };
      if (payload !== undefined) options.payload = payload as InjectOptions['payload'];
      return app.inject(options);
    };
    let n = 0;
    const booted: Booted = {
      app,
      services,
      scheduler,
      db,
      built,
      call,
      async guest(name) {
        const res = await call(null, 'POST', '/api/auth/guest', name ? { displayName: name, confirmAdult: true } : { confirmAdult: true });
        if (res.statusCode !== 201) throw new Error(`guest sign-up failed: ${res.statusCode} ${res.body}`);
        const json = res.json();
        n++;
        return { token: json.token as string, id: json.account.id as string, name: json.account.displayName as string };
      },
      async listen() {
        await app.listen({ port: 0, host: '127.0.0.1' });
        return (app.server.address() as AddressInfo).port;
      },
      async close() {
        services.registry.dispose();
        await app.close();
      },
    };
    this.live.push(booted);
    return booted;
  }

  async closeAll(): Promise<void> {
    for (const b of this.live.splice(0)) await b.close().catch(() => undefined);
  }

  async destroy(): Promise<void> {
    await this.closeAll();
    await this.handle?.close();
  }
}

export { backends };

/** A tiny WebSocket client that records what it receives. */
export function connectWs(port: number, matchId: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/matches/${matchId}/ws`);
  const messages: Array<Record<string, any>> = [];
  ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  const opened = new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  const waitFor = async (pred: (m: Record<string, any>) => boolean, timeoutMs = 3000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = messages.find(pred);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out waiting for message; got ' + JSON.stringify(messages.map((m) => m.type)));
  };
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  return { ws, messages, opened, waitFor, closed, hello: (body: Record<string, unknown> = {}) => ws.send(JSON.stringify({ type: 'hello', ...body })) };
}
