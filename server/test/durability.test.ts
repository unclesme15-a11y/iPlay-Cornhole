import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../src/config.js';
import { createRng } from '../src/core/rng.js';
import { DEFAULT_CONFIG, type MatchConfig } from '../src/core/types.js';
import { gestureToward } from '../src/bots/botPolicy.js';
import { connectDb } from '../src/db/connect.js';
import type { Db, Queryable, QueryResult } from '../src/db/types.js';
import { LiveMatchStore } from '../src/lobby/persistence.js';
import { ManualScheduler } from '../src/lobby/scheduler.js';
import { MatchSession, type Timing } from '../src/lobby/session.js';
import { startServer, type RunningServer } from '../src/server.js';
import { PG_URL, backends, type TestDb } from './helpers/db.js';
import { connectWs } from './helpers/app.js';

const FAST: Partial<Timing> = { botThinkMinMs: 200, botThinkMaxMs: 400, reactionMs: 300, inningEndMs: 300 };
const PERFECT = gestureToward({ x: 0, y: 39 }, 1);
const acct = (name: string) => ({ id: `acct-${name}`, displayName: name });

/** Wraps a database so tests can count or break particular statements. */
function spyOn(db: Db, hooks: { onQuery?: (sql: string) => void; failWhen?: (sql: string) => boolean }): Db {
  const check = (sql: string): void => {
    hooks.onQuery?.(sql);
    if (hooks.failWhen?.(sql)) throw new Error('database unavailable (test)');
  };
  return {
    kind: db.kind,
    query: <T>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>> => {
      try {
        check(sql);
      } catch (e) {
        return Promise.reject(e);
      }
      return db.query<T>(sql, params);
    },
    exec: (sql) => db.exec(sql),
    transaction: <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> =>
      db.transaction((tx) =>
        fn({
          query: <U>(sql: string, params?: readonly unknown[]) => {
            check(sql);
            return tx.query<U>(sql, params);
          },
          exec: (sql) => tx.exec(sql),
        }),
      ),
    tryOwnership: () => db.tryOwnership(),
    releaseOwnership: () => db.releaseOwnership(),
    onOwnershipLost: (h) => db.onOwnershipLost(h),
    close: () => db.close(),
  };
}

function newSession(sched: ManualScheduler, store: LiveMatchStore | null, id = 'DURA2345', cfg: Partial<MatchConfig> = {}) {
  const host = acct('Host');
  const session = new MatchSession({
    id,
    config: { ...DEFAULT_CONFIG, mode: '1v1', playTo: 11, ...cfg },
    seatPlan: { B1: { kind: 'bot', level: 'regular' } },
    scheduler: sched,
    rng: createRng(3),
    timing: FAST,
    hooks: store ? { onChange: (s) => store.markDirty(s) } : {},
  });
  session.createHost(host);
  return { session, host };
}

describe.each(backends)('saving live matches ($name)', (backend) => {
  let handle: TestDb;
  let db: Db;
  beforeAll(async () => {
    handle = await backend.open();
    db = handle.db;
  });
  afterAll(async () => {
    await handle.close();
  });
  afterEach(async () => {
    await db.exec('TRUNCATE live_matches');
  });

  const rows = async () => (await db.query<{ id: string; phase: string; state: { seq: number } }>('SELECT id, phase, state FROM live_matches ORDER BY id')).rows;

  it('saves a match shortly after it changes, once for a whole burst of changes', async () => {
    let writes = 0;
    const sched = new ManualScheduler();
    const store = new LiveMatchStore(spyOn(db, { onQuery: (sql) => sql.includes('INSERT INTO live_matches') && writes++ }), sched, { debounceMs: 250 });
    const { session, host } = newSession(sched, store);
    session.start(host.id);
    session.pickCharacter(host.id, 'keisha');
    session.pickColor(host.id, 'teal');
    expect(writes).toBe(0); // nothing written yet
    sched.advance(249);
    expect(writes).toBe(0);
    sched.advance(2);
    await store.idle();
    expect(writes).toBe(1); // five phase changes and a dozen events, one write
    const saved = await rows();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: 'DURA2345', phase: 'toss' });
    expect(saved[0]!.state.seq).toBe(session.seqNumber);
  });

  it('the row always holds the latest state', async () => {
    const sched = new ManualScheduler();
    const store = new LiveMatchStore(db, sched, { debounceMs: 100 });
    const { session, host } = newSession(sched, store);
    sched.advance(150);
    await store.idle();
    const first = (await rows())[0]!.state.seq;
    session.start(host.id);
    sched.advance(150);
    await store.idle();
    const second = (await rows())[0]!;
    expect(second.state.seq).toBeGreaterThan(first);
    expect(second.phase).toBe('characters');
  });

  it('flushAll saves everything waiting, immediately', async () => {
    const sched = new ManualScheduler();
    const store = new LiveMatchStore(db, sched, { debounceMs: 60_000 });
    const a = newSession(sched, store, 'FLUSHAAA');
    const b = newSession(sched, store, 'FLUSHBBB');
    b.host.id; // a second, separate match
    expect(await rows()).toHaveLength(0);
    await store.flushAll();
    expect((await rows()).map((r) => r.id)).toEqual(['FLUSHAAA', 'FLUSHBBB']);
    void a;
  });

  it('remove deletes the row, and a write that was still waiting cannot bring it back', async () => {
    const sched = new ManualScheduler();
    const store = new LiveMatchStore(db, sched, { debounceMs: 100 });
    const { session } = newSession(sched, store);
    await store.flushAll();
    expect(await rows()).toHaveLength(1);
    session.setSeat(session.hostName ? acct('Host').id : '', 'B1', 'human'); // a change: dirty again
    await store.remove('DURA2345');
    sched.advance(500);
    await store.idle();
    expect(await rows()).toHaveLength(0);
  });

  it('never saves a match that is over', async () => {
    const sched = new ManualScheduler();
    const store = new LiveMatchStore(db, sched, { debounceMs: 50 });
    const { session, host } = newSession(sched, store);
    await store.flushAll();
    session.leave(host.id); // abandoned
    store.markDirty(session);
    sched.advance(200);
    await store.idle();
    expect((await rows()).find((r) => r.phase === 'abandoned')).toBeUndefined();
  });

  it('a failing database is reported, does not break the match, and saving resumes when it recovers', async () => {
    const sched = new ManualScheduler();
    let broken = true;
    const errors: string[] = [];
    const store = new LiveMatchStore(spyOn(db, { failWhen: (sql) => broken && sql.includes('INSERT INTO live_matches') }), sched, { debounceMs: 50, onError: (m) => errors.push(m) });
    const { session, host } = newSession(sched, store);
    sched.advance(100);
    await store.idle();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('DURA2345');
    expect(await rows()).toHaveLength(0);
    broken = false;
    expect(() => session.start(host.id)).not.toThrow(); // the match itself carries on
    sched.advance(100);
    await store.idle();
    expect(await rows()).toHaveLength(1);
  });

  it('loads what was saved, oldest first, and throws away anything older than the limit', async () => {
    let now = 1_800_000_000_000;
    const sched = new ManualScheduler(now);
    const store = new LiveMatchStore(db, sched, { debounceMs: 10 });
    newSession(sched, store, 'OLDMATCH');
    await store.flushAll();
    sched.advance(3 * 60 * 60_000); // three hours pass
    newSession(sched, store, 'NEWMATCH');
    await store.flushAll();
    const loaded = await store.loadAll(2 * 60 * 60_000);
    expect(loaded.map((l) => l.snapshot.id)).toEqual(['NEWMATCH']);
    expect((await rows()).map((r) => r.id)).toEqual(['NEWMATCH']); // the stale one was deleted
    void now;
  });
});

describe('a real server stopping and starting again', () => {
  let handle: TestDb;
  const running: RunningServer[] = [];
  beforeAll(async () => {
    handle = await backends[0]!.open();
  });
  afterAll(async () => {
    await handle.close();
  });
  afterEach(async () => {
    for (const s of running.splice(0)) await s.stop({ closeDb: false }).catch(() => undefined);
    await handle.db.exec('TRUNCATE accounts, matches, live_matches, reports RESTART IDENTITY CASCADE');
  });

  const config = (env: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', PORT: '0', HOST: '127.0.0.1', RATE_LIMIT_PER_MIN: '100000', ...env });
  const boot = async (sched: ManualScheduler, env: Record<string, string> = {}, debounce = 10) => {
    let seed = 1;
    const s = await startServer(config(env), { db: handle.db, scheduler: sched, overrides: { timing: FAST, persistDebounceMs: debounce, seedSource: () => (seed += 7919) } });
    running.push(s);
    return s;
  };
  const port = (s: RunningServer) => (s.app.server.address() as AddressInfo).port;
  const call = (s: RunningServer, token: string | null, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    s.app.inject({ method, url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });

  async function startMatchWithHuman(s: RunningServer) {
    const guest = (await call(s, null, 'POST', '/api/auth/guest', { displayName: 'Uncle Me', confirmAdult: true })).json();
    const token = guest.token as string;
    const created = (await call(s, token, 'POST', '/api/matches', { config: { mode: '1v1', playTo: 21 } })).json();
    const id = created.matchId as string;
    await call(s, token, 'POST', `/api/matches/${id}/start`, {});
    await call(s, token, 'POST', `/api/matches/${id}/character`, { characterId: 'tanya' });
    await call(s, token, 'POST', `/api/matches/${id}/color`, { colorId: 'teal' });
    return { token, id, accountId: guest.account.id as string };
  }

  async function playUntil(s: RunningServer, sched: ManualScheduler, m: { token: string; id: string }, done: () => boolean) {
    for (let i = 0; i < 6000; i++) {
      const view = s.services.registry.get(m.id)!.view();
      if (done() || view.phase === 'finished') return;
      if (view.turn?.controlledBy === 'human') await call(s, m.token, 'POST', `/api/matches/${m.id}/throw`, PERFECT);
      sched.advance(250);
    }
    throw new Error('did not reach the goal');
  }

  it('shutting down with many matches running saves each one last, then stops saving (no writes after the database closes)', async () => {
    const sched = new ManualScheduler();
    const writes: string[] = [];
    const errors: string[] = [];
    const watched = spyOn(handle.db, { onQuery: (sql) => sql.includes('INSERT INTO live_matches') && writes.push(sql) });
    let seed = 1;
    const s = await startServer(config(), {
      db: watched,
      scheduler: sched,
      overrides: { timing: FAST, persistDebounceMs: 10, seedSource: () => (seed += 7919), log: (level, message) => level === 'error' && errors.push(message) },
    });
    running.push(s);
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      // straight to the services: sign-up and match creation are rate limited per address over HTTP
      const account = await s.services.accounts.createGuest(`Many ${i}`, { adultConfirmed: true });
      const session = s.services.registry.create({ config: { ...DEFAULT_CONFIG, mode: '1v1' }, host: { id: account.id, displayName: account.displayName } });
      session.start(account.id, {});
      ids.push(session.id);
    }
    sched.advance(60_000); // picks time out, bots start throwing
    await new Promise((r) => setTimeout(r, 200));
    const before = s.services.registry.get(ids[0]!)!.view().seq;
    expect(ids.every((i) => !s.services.registry.get(i)!.isOver)).toBe(true);
    await s.stop({ closeDb: false });
    const writesAtStop = writes.length;
    // a late change (for example a socket that closes just after the stop) must not be saved either
    s.services.persistence.markDirty(s.services.registry.get(ids[0]!)!);
    // Time keeps passing after the stop (timers that were about to fire, late socket closes): nothing may be saved or fail.
    sched.advance(120_000);
    await new Promise((r) => setTimeout(r, 200));
    expect(writes.length).toBe(writesAtStop);
    expect(errors).toEqual([]);
    expect(s.services.registry.get(ids[0]!)!.view().seq).toBe(before); // frozen: no more throws after the last save
    // and every match was saved in its final state
    const saved = (await handle.db.query<{ id: string }>('SELECT id FROM live_matches')).rows.map((r) => r.id).sort();
    expect(saved).toEqual([...ids].sort());
  });

  it('a match in progress survives the server being stopped and started, and plays on to a saved result', async () => {
    const sched1 = new ManualScheduler();
    const one = await boot(sched1);
    const m = await startMatchWithHuman(one);
    sched1.advance(3000);
    await playUntil(one, sched1, m, () => one.services.registry.get(m.id)!.view().history.length >= 1);
    const before = one.services.registry.get(m.id)!.view();
    expect(before.history.length).toBeGreaterThanOrEqual(1);
    expect(before.phase).toBe('playing'); // 21 cannot be reached in one inning (12 is the most)

    // The app is connected when the server goes down: it must be told to reconnect (1012)
    const listening = connectWs(port(one), m.id);
    await listening.opened;
    listening.hello({ bearer: m.token });
    await listening.waitFor((x) => x.type === 'welcome');
    await one.stop({ closeDb: false });
    expect(await listening.closed).toBe(1012);

    // A new server starts against the same database
    const sched2 = new ManualScheduler(sched1.now() + 4000);
    const two = await boot(sched2);
    expect(two.services.registry.size).toBe(1);
    const restored = two.services.registry.get(m.id)!;
    expect(restored.currentPhase).toBe('playing');
    const after = restored.view();
    expect(after.scores).toEqual(before.scores);
    expect(after.history).toEqual(before.history);
    expect(after.colors).toEqual({ A: 'teal', B: expect.any(String) });
    expect(after.seats.find((s) => s.id === 'A1')).toMatchObject({ name: 'Uncle Me', characterId: 'tanya', accountId: m.accountId });

    // The same login still works, and the app is told which match to go back to
    const me = (await call(two, m.token, 'GET', '/api/me')).json();
    expect(me.activeMatchId).toBe(m.id);

    // Reconnecting with an old event number gets a reload instruction
    const back = connectWs(port(two), m.id);
    await back.opened;
    back.hello({ bearer: m.token, since: before.seq + 500 });
    const welcome = await back.waitFor((x) => x.type === 'welcome');
    expect(welcome.resync).toBe(true);
    expect(welcome.view.seats.find((s: { id: string }) => s.id === 'A1').connected).toBe(true);

    // ...and the match plays to a proper end (the player stays connected, as a real one would), with the result saved
    await playUntil(two, sched2, m, () => false);
    expect(restored.view().phase).toBe('finished');
    back.ws.close();
    await two.services.persistence.idle();
    await new Promise((r) => setTimeout(r, 100));
    const saved = (await handle.db.query<{ code: string; outcome: string }>('SELECT code, outcome FROM matches')).rows;
    expect(saved).toEqual([{ code: m.id, outcome: expect.stringMatching(/score|skunk/) }]);
    expect((await handle.db.query('SELECT 1 FROM live_matches')).rowCount).toBe(0);
    const stats = (await call(two, m.token, 'GET', '/api/me')).json().stats;
    expect(stats.games).toBe(1);
    expect(stats.throws).toBeGreaterThan(before.history.length * 4 - 1); // throws from before AND after the restart both count
  });

  it('stopping saves what was still waiting to be saved', async () => {
    const sched = new ManualScheduler();
    const one = await boot(sched, {}, 60_000); // the normal timer would not fire for a minute
    const m = await startMatchWithHuman(one);
    expect((await handle.db.query('SELECT 1 FROM live_matches')).rowCount).toBe(0);
    await one.stop({ closeDb: false });
    const saved = (await handle.db.query<{ phase: string }>('SELECT phase FROM live_matches')).rows;
    expect(saved).toEqual([{ phase: 'toss' }]);
    const two = await boot(new ManualScheduler(sched.now()));
    expect(two.services.registry.get(m.id)!.currentPhase).toBe('toss');
  });

  it('a server that is stopping refuses new matches', async () => {
    const sched = new ManualScheduler();
    const one = await boot(sched);
    const guest = (await call(one, null, 'POST', '/api/auth/guest', { confirmAdult: true })).json();
    const stopping = one.stop({ closeDb: false });
    one.services.registry.maintenance = true;
    const res = await call(one, guest.token, 'POST', '/api/matches', {}).catch(() => null);
    if (res) expect([503, 500]).toContain(res.statusCode);
    await stopping;
  });

  it('a match that ended before the restart is not brought back', async () => {
    const sched = new ManualScheduler();
    const one = await boot(sched);
    const guest = (await call(one, null, 'POST', '/api/auth/guest', { confirmAdult: true })).json();
    const created = (await call(one, guest.token, 'POST', '/api/matches', {})).json();
    await call(one, guest.token, 'POST', `/api/matches/${created.matchId}/leave`, {});
    await one.services.persistence.idle();
    await one.stop({ closeDb: false });
    const two = await boot(new ManualScheduler(sched.now()));
    expect(two.services.registry.size).toBe(0);
  });

  it('bad saved rows are thrown away without stopping the server from starting', async () => {
    const sched = new ManualScheduler();
    const one = await boot(sched);
    const good = await startMatchWithHuman(one);
    await one.stop({ closeDb: false });
    // While the server is down, two saved rows are damaged: one is missing its data, one is from a newer version
    await handle.db.query(`INSERT INTO live_matches (id, phase, state) VALUES ('BROKEN11', 'playing', '{"version":1,"phase":"playing"}'::jsonb)`);
    await handle.db.query(`INSERT INTO live_matches (id, phase, state) VALUES ('OLDVER22', 'playing', '{"version":99}'::jsonb)`);
    await handle.db.query(`INSERT INTO live_matches (id, phase, state) VALUES ('LIAR3333', 'playing', (SELECT jsonb_set(state, '{id}', '"SOMEONEE"') FROM live_matches WHERE id = $1))`, [good.id]);
    const errors: string[] = [];
    const two = await startServer(config(), {
      db: handle.db,
      scheduler: new ManualScheduler(sched.now()),
      overrides: { timing: FAST, persistDebounceMs: 10, log: (level, message) => level === 'error' && errors.push(message) },
    });
    running.push(two);
    expect(two.services.registry.size).toBe(1);
    expect(two.services.registry.get(good.id)).toBeDefined();
    expect((await handle.db.query<{ id: string }>('SELECT id FROM live_matches ORDER BY id')).rows.map((r) => r.id)).toEqual([good.id]);
    expect(errors.filter((m) => m.includes('could not restore'))).toHaveLength(3); // every bad row was reported
  });

  it('restoring twice does not duplicate anything', async () => {
    const sched = new ManualScheduler();
    const one = await boot(sched);
    await startMatchWithHuman(one);
    await one.services.registry.flush();
    const before = one.services.registry.size;
    expect(await one.services.registry.restoreAll()).toEqual({ restored: 0, discarded: 0 });
    expect(one.services.registry.size).toBe(before);
  });

  it('the result of a finished match is retried if the database hiccups, and logged with the full details if it never works', async () => {
    const sched = new ManualScheduler();
    let failures = 0;
    const flaky = spyOn(handle.db, { failWhen: (sql) => sql.includes('INSERT INTO matches') && failures++ < 1 });
    const logged: Array<{ level: string; message: string; data?: Record<string, unknown> }> = [];
    const s = await startServer(config(), {
      db: flaky,
      scheduler: sched,
      overrides: { timing: FAST, persistDebounceMs: 10, log: (level, message, data) => logged.push({ level, message, ...(data ? { data } : {}) }) },
    });
    running.push(s);
    const m = await startMatchWithHuman(s);
    sched.advance(3000);
    await playUntil(s, sched, m, () => false);
    await s.services.persistence.idle();
    await new Promise((r) => setTimeout(r, 100));
    expect((await handle.db.query('SELECT 1 FROM matches')).rowCount).toBe(0); // first attempt failed
    sched.advance(2001); // retry after 2 s
    await new Promise((r) => setTimeout(r, 200));
    expect((await handle.db.query('SELECT 1 FROM matches')).rowCount).toBe(1);
    expect(logged.some((l) => l.level === 'warn' && l.message.includes('will retry'))).toBe(true);
    await s.stop({ closeDb: false });

    // and when it never works: nothing saved, but the whole result is in the log to be replayed by hand
    await handle.db.exec('TRUNCATE accounts, matches, live_matches, reports RESTART IDENTITY CASCADE');
    const sched2 = new ManualScheduler();
    const dead = spyOn(handle.db, { failWhen: (sql) => sql.includes('INSERT INTO matches') });
    const logged2: Array<{ level: string; message: string; data?: Record<string, unknown> }> = [];
    const s2 = await startServer(config(), {
      db: dead,
      scheduler: sched2,
      overrides: { timing: FAST, persistDebounceMs: 10, log: (level, message, data) => logged2.push({ level, message, ...(data ? { data } : {}) }) },
    });
    running.push(s2);
    const m2 = await startMatchWithHuman(s2);
    sched2.advance(3000);
    await playUntil(s2, sched2, m2, () => false);
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 100));
      sched2.advance(11_000);
    }
    await new Promise((r) => setTimeout(r, 200));
    const final = logged2.find((l) => l.level === 'error' && l.message.includes('could not save match history'));
    expect(final).toBeDefined();
    expect((final!.data!.summary as { code: string }).code).toBe(m2.id);
  });
});

describe.skipIf(!PG_URL)('deploying a new server while the old one is running (real Postgres)', () => {
  const pg = backends.find((b) => b.name === 'postgres')!;
  let handle: TestDb;
  const running: RunningServer[] = [];
  beforeAll(async () => {
    handle = await pg.open();
  });
  afterEach(async () => {
    // Only one server can own the matches, so every test must stop the servers it started.
    for (const s of running.splice(0)) await s.stop().catch(() => undefined);
  });
  afterAll(async () => {
    await handle.close();
  });

  const config = (env: Record<string, string> = {}) =>
    loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', PORT: '0', HOST: '127.0.0.1', RATE_LIMIT_PER_MIN: '100000', DATABASE_URL: handle.url!, ...env });
  const start = async (sched: ManualScheduler, env: Record<string, string> = {}, opts: { onOwnershipLost?: () => void } = {}) => {
    const s = await startServer(config(env), { scheduler: sched, overrides: { timing: FAST, persistDebounceMs: 10 }, ...opts });
    running.push(s);
    return s;
  };
  const call = (s: RunningServer, token: string | null, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    s.app.inject({ method, url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });

  it('a second server cannot take over until the first lets go, then it picks up the running match', async () => {
    const sched = new ManualScheduler();
    const old = await start(sched);
    const guest = (await call(old, null, 'POST', '/api/auth/guest', { displayName: 'Deploy Test', confirmAdult: true })).json();
    const created = (await call(old, guest.token, 'POST', '/api/matches', { config: { mode: '1v1', playTo: 11 } })).json();
    await call(old, guest.token, 'POST', `/api/matches/${created.matchId}/start`, {});

    // with no patience the new server gives up straight away
    await expect(start(new ManualScheduler(sched.now()), { OWNERSHIP_WAIT_SEC: '0' })).rejects.toThrow(/Another server instance owns/);

    // with patience it waits while the old one shuts down, then takes over
    const waiting = start(new ManualScheduler(sched.now() + 2000), { OWNERSHIP_WAIT_SEC: '10' });
    await new Promise((r) => setTimeout(r, 1500));
    await old.stop(); // flushes the match, tells clients to reconnect, releases ownership
    const fresh = await waiting;
    expect(fresh.services.registry.get(created.matchId)!.currentPhase).toBe('characters');
    const me = (await call(fresh, guest.token, 'GET', '/api/me')).json();
    expect(me.account.displayName).toBe('Deploy Test');
    expect(me.activeMatchId).toBe(created.matchId);
  }, 30_000);

  it('a server that loses its database connection shuts itself down instead of running two copies of the matches', async () => {
    let lost = 0;
    const s = await start(new ManualScheduler(), {}, { onOwnershipLost: () => lost++ });
    const admin = await connectDb(handle.url!);
    await admin.query("SELECT pg_terminate_backend(l.pid) FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid <> pg_backend_pid()");
    for (let i = 0; i < 60 && lost === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(lost).toBe(1);
    await admin.close();
    await s.stop().catch(() => undefined);
  }, 30_000);
});
