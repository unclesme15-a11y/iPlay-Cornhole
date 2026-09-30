import type { AppConfig } from './config.js';
import { connectDb } from './db/connect.js';
import { migrate } from './db/migrate.js';
import type { Db } from './db/types.js';
import { buildApp, type BuiltApp } from './http/app.js';
import { RealScheduler, type Scheduler } from './lobby/scheduler.js';
import { createServices, type ServiceOverrides, type Services } from './services.js';
import type { LogFn } from './store/registry.js';

export interface RunningServer {
  app: BuiltApp['app'];
  services: Services;
  /**
   * Stop cleanly: no new matches, tell clients to reconnect, save live matches, hand over ownership.
   * Pass `closeDb: false` if the caller owns the database connection and will close it itself.
   */
  stop(opts?: { closeDb?: boolean }): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Brings the whole server up, in the order that keeps live matches safe:
 *
 * 1. connect to the database
 * 2. become the one instance that owns live matches (a deploy's new server waits here while the old one finishes)
 * 3. bring the database schema up to date
 * 4. restore matches that were running when the last server stopped
 * 5. only then start answering requests
 */
export async function startServer(
  config: AppConfig,
  opts: { db?: Db; scheduler?: Scheduler; overrides?: ServiceOverrides; onOwnershipLost?: () => void; listen?: boolean } = {},
): Promise<RunningServer> {
  const scheduler = opts.scheduler ?? new RealScheduler();
  const db = opts.db ?? (await connectDb(config.DATABASE_URL ?? 'pglite://memory', { ssl: config.DATABASE_SSL }));
  let logger: LogFn = () => undefined;
  const extraLog = opts.overrides?.log;
  const log: LogFn = (level, message, data) => {
    logger(level, message, data);
    extraLog?.(level, message, data);
  };

  const deadline = Date.now() + config.OWNERSHIP_WAIT_SEC * 1000;
  for (;;) {
    if (await db.tryOwnership()) break;
    if (Date.now() >= deadline) {
      await db.close();
      throw new Error('Another server instance owns the live matches and did not let go in time');
    }
    await sleep(1000);
  }
  db.onOwnershipLost(() => {
    log('error', 'lost ownership of live matches: another server may take over, shutting down');
    services?.alerts.send('ownership', 'Lost the database lock and shut down. If it does not come back by itself, check the database and restart it.');
    (opts.onOwnershipLost ?? (() => process.exit(1)))();
  });

  let services: Services | undefined;
  let built: BuiltApp;
  try {
    await migrate(db);
    services = createServices(db, scheduler, config, { ...opts.overrides, log });
    built = await buildApp(services);
    logger = (level, message, data) => built.app.log[level]({ ...data }, message);

    const { restored, discarded } = await services.registry.restoreAll();
    services.alerts.send(
      'start',
      `Server started (live matches restored: ${restored}${discarded ? `, discarded: ${discarded}` : ''}). One of these per deploy is normal; several in a row means it keeps crashing.`,
    );
    services.ranked.start();
    services.janitor.start();
    if (opts.listen !== false) await built.app.listen({ port: config.PORT, host: config.HOST });
  } catch (error) {
    // Don't leave the database connection (and the ownership lock) hanging if start-up fails part-way.
    await db.close().catch(() => undefined);
    throw error;
  }

  let stopped = false;
  return {
    app: built.app,
    services,
    async stop(stopOpts = {}) {
      if (stopped) return;
      stopped = true;
      services.registry.maintenance = true; // nobody can start a match on a server that is going away
      services.ranked.stop();
      services.janitor.stop();
      built.closeSockets();
      await services.registry.shutdown();
      await built.app.close();
      if (stopOpts.closeDb === false) await db.releaseOwnership();
      else await db.close();
    },
  };
}
