import { AccountService } from './accounts/service.js';
import { MatchHistory } from './accounts/history.js';
import { ModerationService } from './accounts/moderation.js';
import { IdentityProviders } from './accounts/providers.js';
import { SessionService } from './accounts/sessions.js';
import type { KeySource } from './accounts/jwt.js';
import type { AppConfig } from './config.js';
import type { Db } from './db/types.js';
import { LiveMatchStore } from './lobby/persistence.js';
import { Janitor } from './maintenance.js';
import { RankedService, type RankedOptions } from './ranking/ranked.js';
import { RatingsReader } from './ranking/reader.js';
import { VoiceService } from './voice/service.js';
import type { Scheduler } from './lobby/scheduler.js';
import type { Timing } from './lobby/session.js';
import { Alerts, type FetchLike } from './alerts.js';
import { ApnsSender, FcmSender, readServiceAccount, type PushSender } from './push/senders.js';
import { PushService, type PushPlatform } from './push/service.js';
import { SeasonService } from './ranking/seasons.js';
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
  seasons: SeasonService;
  push: PushService;
  voice: VoiceService;
  janitor: Janitor;
  alerts: Alerts;
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
  /** Replaces the push senders (tests). */
  pushSenders?: Partial<Record<PushPlatform, PushSender>>;
  /** Replaces fetch for the alert webhook (tests). */
  alertFetch?: FetchLike;
}

/** Builds every service on top of one database and one clock. Used by the server and by tests. */
export function createServices(db: Db, scheduler: Scheduler, config: AppConfig, over: ServiceOverrides = {}): Services {
  const now = (): number => scheduler.now();
  const baseLog: LogFn = over.log ?? (() => undefined);
  const alerts = new Alerts(config.ALERT_WEBHOOK_URL, `iPlay Cornhole ${config.PUBLIC_BASE_URL}`, over.alertFetch, Date.now, (error) =>
    baseLog('warn', 'could not send an alert', { error: String(error) }),
  );
  // Anything logged as an error also goes to the alert webhook (if one is set).
  const log: LogFn = (level, message, data) => {
    baseLog(level, message, data);
    if (level === 'error') alerts.send(`error:${message}`, `Error: ${message}`);
  };
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
  const seasons = new SeasonService(
    db,
    scheduler,
    { firstStart: new Date(`${config.SEASON_ONE_START}T00:00:00Z`), lengthMonths: config.SEASON_LENGTH_MONTHS, keep: config.SEASON_SOFT_RESET },
    log,
  );
  const push = new PushService(db, scheduler, over.pushSenders ?? pushSendersFrom(config), log);
  registry.onPlayerAway = (s, playerId) => push.playerAway(s, playerId);
  ranked.onMatched = (ids, matchId, mode) => push.rankedMatched(ids, matchId, mode);
  seasons.onSeasonClosed = (s) => {
    ratings.invalidate();
    alerts.send('season', `${s.name} ended: final standings saved and ratings soft-reset. The next season has started.`);
    push.seasonClosed(s.number, `Season ${s.number + 1}`).catch((error) => log('warn', 'season push failed', { error: String(error) }));
  };
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
    seasons,
    push,
    voice: new VoiceService(config, moderation, now),
    janitor: new Janitor(db, scheduler, log, undefined, { matchHistoryDays: config.MATCH_HISTORY_DAYS }),
    alerts,
    log,
  };
}

/** Builds the push senders from the settings; a platform without keys simply gets no notifications. */
function pushSendersFrom(config: AppConfig): Partial<Record<PushPlatform, PushSender>> {
  const senders: Partial<Record<PushPlatform, PushSender>> = {};
  if (config.APNS_KEY_ID && config.APNS_PRIVATE_KEY) {
    try {
      senders.ios = new ApnsSender({
        keyId: config.APNS_KEY_ID,
        privateKey: config.APNS_PRIVATE_KEY,
        teamId: (config.APNS_TEAM_ID ?? config.APPLE_TEAM_ID)!,
        bundleId: (config.APNS_BUNDLE_ID ?? config.IOS_BUNDLE_ID)!,
        sandbox: config.APNS_SANDBOX,
        ...(config.APNS_HOST ? { host: config.APNS_HOST } : {}),
      });
    } catch (error) {
      throw new Error(`APNS_PRIVATE_KEY is not a valid .p8 key: ${String(error)}`);
    }
  }
  if (config.FCM_SERVICE_ACCOUNT) {
    try {
      senders.android = new FcmSender({
        ...readServiceAccount(config.FCM_SERVICE_ACCOUNT),
        ...(config.FCM_SEND_URL ? { sendUrl: config.FCM_SEND_URL } : {}),
        ...(config.FCM_TOKEN_URL ? { tokenUrl: config.FCM_TOKEN_URL } : {}),
      });
    } catch (error) {
      throw new Error(`FCM_SERVICE_ACCOUNT is not a usable Firebase service account: ${String(error)}`);
    }
  }
  return senders;
}
