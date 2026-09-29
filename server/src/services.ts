import { AccountService } from './accounts/service.js';
import { MatchHistory } from './accounts/history.js';
import { ModerationService } from './accounts/moderation.js';
import { IdentityProviders } from './accounts/providers.js';
import { SessionService } from './accounts/sessions.js';
import type { KeySource } from './accounts/jwt.js';
import type { AppConfig } from './config.js';
import type { Db } from './db/types.js';
import { LiveMatchStore } from './lobby/persistence.js';
import { RankedService, type RankedOptions } from './ranking/ranked.js';
import { RatingsReader } from './ranking/reader.js';
import { VoiceService } from './voice/service.js';
import type { Scheduler } from './lobby/scheduler.js';
import type { Timing } from './lobby/session.js';
import { MatchRegistry, type LogFn } from './store/registry.js';

export interface Services {
  db: Db;
  config: AppConfig;
  scheduler: Scheduler;
  accounts: AccountService;
  sessions: SessionService;
  providers: IdentityProviders;
  moderation: ModerationService;
  history: MatchHistory;
  persistence: LiveMatchStore;
  registry: MatchRegistry;
  ratings: RatingsReader;
  ranked: RankedService;
  voice: VoiceService;
  log: LogFn;
}

export interface ServiceOverrides {
  log?: LogFn;
  timing?: Partial<Timing>;
  appleKeys?: KeySource;
  googleKeys?: KeySource;
  /** Fixed throw seeds, so a test match plays out the same way every time. */
  seedSource?: () => number;
  /** Milliseconds live-match changes are batched before saving. */
  persistDebounceMs?: number;
  registry?: { finishedTtlMs?: number; idleTtlMs?: number; sweepEveryMs?: number };
  ranked?: RankedOptions;
}

/** Builds every service on top of one database and one clock. Used by the server and by tests. */
export function createServices(db: Db, scheduler: Scheduler, config: AppConfig, over: ServiceOverrides = {}): Services {
  const now = (): number => scheduler.now();
  const log: LogFn = over.log ?? (() => undefined);
  const history = new MatchHistory(db);
  const persistence = new LiveMatchStore(db, scheduler, {
    debounceMs: over.persistDebounceMs ?? 250,
    onError: (message, error) => log('error', message, { error: String(error) }),
  });
  const registry = new MatchRegistry({
    scheduler,
    maxMatches: config.MAX_MATCHES,
    persistence,
    history,
    log,
    restoreMaxAgeMs: config.RESTORE_MAX_AGE_MIN * 60_000,
    ...(over.timing ? { timing: over.timing } : {}),
    ...(over.seedSource ? { seedSource: over.seedSource } : {}),
    ...over.registry,
  });
  registry.maintenance = config.MAINTENANCE;
  const moderation = new ModerationService(db, now);
  const ratings = new RatingsReader(db, now);
  registry.onRatingsChanged = () => ratings.invalidate();
  const ranked = new RankedService(db, registry, ratings, scheduler, log, over.ranked);
  return {
    db,
    config,
    scheduler,
    accounts: new AccountService(db, now, { requireAdult: config.REQUIRE_ADULT_CONFIRMATION, termsVersion: config.TERMS_VERSION }),
    sessions: new SessionService(db, now),
    providers: new IdentityProviders({
      appleClientIds: config.APPLE_CLIENT_IDS,
      googleClientIds: config.GOOGLE_CLIENT_IDS,
      allowMissingNonce: config.ALLOW_MISSING_NONCE,
      now,
      ...(over.appleKeys ? { appleKeys: over.appleKeys } : {}),
      ...(over.googleKeys ? { googleKeys: over.googleKeys } : {}),
    }),
    moderation,
    history,
    persistence,
    registry,
    ratings,
    ranked,
    voice: new VoiceService(config, moderation, now),
    log,
  };
}
