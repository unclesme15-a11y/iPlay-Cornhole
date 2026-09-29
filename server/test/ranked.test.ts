import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gestureToward } from '../src/bots/botPolicy.js';
import { RankedService } from '../src/ranking/ranked.js';
import { FORFEIT_COOLDOWN_MS } from '../src/ranking/rules.js';
import { TestEnv, type Booted } from './helpers/app.js';

let env: TestEnv;
beforeAll(async () => {
  env = await TestEnv.create();
});
afterAll(async () => {
  await env.destroy();
});
afterEach(async () => {
  await env.closeAll();
});

type Player = { token: string; id: string; name: string };
const PERFECT = gestureToward({ x: 0, y: 39 }, 1);

const signUp = async (t: Booted, n: number): Promise<Player[]> => {
  const out: Player[] = [];
  for (let i = 0; i < n; i++) out.push(await t.guest(`Player ${i + 1}`));
  return out;
};

const queue = (t: Booted, p: Player, mode: 'singles' | 'teams' = 'singles') => t.call(p.token, 'POST', '/api/ranked/queue', { mode });
const status = async (t: Booted, p: Player) => (await t.call(p.token, 'GET', '/api/ranked/queue')).json();

/** Two players queue and the matchmaker pairs them. Returns the match id. */
async function pairUp(t: Booted, a: Player, b: Player): Promise<string> {
  expect((await queue(t, a)).statusCode).toBe(202);
  expect((await queue(t, b)).statusCode).toBe(202);
  t.services.ranked.tick();
  const s = await status(t, a);
  expect(s.status).toBe('matched');
  return s.matchId;
}

/** What the websocket does when the phone connects. */
const connect = (t: Booted, matchId: string, players: Player[]) => {
  const session = t.services.registry.get(matchId)!;
  for (const p of players) session.setConnected(p.id, true);
};

async function play(t: Booted, matchId: string, players: Player[], until: (view: any) => boolean = (v) => v.phase === 'finished') {
  const byId = new Map(players.map((p) => [p.id, p]));
  for (let i = 0; i < 4000; i++) {
    const view = t.services.registry.get(matchId)!.view();
    if (until(view)) return view as any;
    if (view.turn?.controlledBy === 'human') {
      const seat = view.seats.find((s) => s.id === view.turn!.seat)!;
      const p = byId.get(seat.accountId!);
      if (p) await t.call(p.token, 'POST', `/api/matches/${matchId}/throw`, PERFECT);
    }
    t.scheduler.advance(500);
  }
  throw new Error('did not reach the wanted state');
}

const settle = async (t: Booted) => {
  // let the history save (a database write) finish
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 10));
    t.scheduler.advance(0);
  }
};
const singlesRating = async (t: Booted, p: Player) =>
  (await t.db.query<{ rating: number; games: number }>('SELECT rating, games FROM singles_ratings WHERE account_id = $1', [p.id])).rows[0];

describe('ranked singles', () => {
  it('needs an adult on the current terms', async () => {
    const t = await env.boot({ env: { TERMS_VERSION: '2' } });
    const [a] = await signUp(t, 1);
    await t.db.query('UPDATE accounts SET terms_version = $2 WHERE id = $1', [a!.id, '1']);
    t.services.sessions.forget(a!.id);
    expect((await queue(t, a!)).json().error.code).toBe('terms_update_required');
    await t.db.query('UPDATE accounts SET terms_version = $2, adult_confirmed_at = NULL WHERE id = $1', [a!.id, '2']);
    t.services.sessions.forget(a!.id);
    expect((await queue(t, a!)).json().error.code).toBe('adult_confirmation_required');
  });

  it('pairs two players into a fixed-rules match with both seated and no bots', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    expect(await status(t, a!)).toMatchObject({ status: 'idle', party: null });
    expect((await queue(t, a!)).json()).toMatchObject({ status: 'searching', mode: 'singles' });
    expect(await status(t, a!)).toMatchObject({ status: 'searching', playersSearching: 1 });
    t.services.ranked.tick(); // alone: nobody to play
    expect((await status(t, a!)).status).toBe('searching');
    await queue(t, b!);
    t.services.ranked.tick();
    const [sa, sb] = [await status(t, a!), await status(t, b!)];
    expect(sa).toMatchObject({ status: 'matched', mode: 'singles' });
    expect(sb.matchId).toBe(sa.matchId);
    const view = (await t.call(a!.token, 'GET', `/api/matches/${sa.matchId}`)).json();
    expect(view).toMatchObject({ ranked: 'singles', phase: 'characters', config: { mode: '1v1', playTo: 21, bust: false, skunk: false, distance: 'regulation', throwTimerSec: 20 } });
    expect(view.seats.map((s: any) => s.kind)).toEqual(['human', 'human']);
    expect(new Set(view.seats.map((s: any) => s.accountId))).toEqual(new Set([a!.id, b!.id]));
    expect((await t.call(a!.token, 'GET', '/api/me')).json().activeMatchId).toBe(sa.matchId);
  });

  it('cannot queue twice, or while already in a match', async () => {
    const t = await env.boot();
    const [a, b, c] = await signUp(t, 3);
    await queue(t, a!);
    expect((await queue(t, a!)).json().error.code).toBe('already_queued');
    await queue(t, b!);
    t.services.ranked.tick();
    expect((await queue(t, a!)).json().error.code).toBe('already_in_match');
    expect((await queue(t, c!)).statusCode).toBe(202);
  });

  it('can stop searching', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    await queue(t, a!);
    expect((await t.call(a!.token, 'DELETE', '/api/ranked/queue')).json()).toEqual({ left: true });
    await queue(t, b!);
    t.services.ranked.tick();
    expect((await status(t, b!)).status).toBe('searching');
    expect((await status(t, a!)).status).toBe('idle');
  });

  it('gives up after five minutes and says so', async () => {
    const t = await env.boot();
    const [a] = await signUp(t, 1);
    await queue(t, a!);
    t.scheduler.advance(5 * 60_000 + 1);
    t.services.ranked.tick();
    expect(await status(t, a!)).toMatchObject({ status: 'expired', mode: 'singles' });
  });

  it('keeps far-apart ratings apart at first, then widens the search while they wait', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    for (const [p, r] of [[a!, 1000], [b!, 1400]] as const) {
      await t.db.query('INSERT INTO singles_ratings (account_id, rating, peak, games, last_played_at) VALUES ($1, $2, $2, 20, now())', [p.id, r]);
    }
    await queue(t, a!);
    await queue(t, b!);
    t.services.ranked.tick();
    expect((await status(t, a!)).status).toBe('searching');
    expect((await status(t, a!)).ratingWindow).toBe(100);
    t.scheduler.advance(5000 * 6); // window is now 400
    t.services.ranked.tick();
    expect((await status(t, a!)).status).toBe('matched');
  });

  it('never pairs people who blocked each other', async () => {
    const t = await env.boot();
    const [a, b, c] = await signUp(t, 3);
    await t.call(a!.token, 'PUT', `/api/blocks/${b!.id}`);
    await queue(t, a!);
    await queue(t, b!);
    t.services.ranked.tick();
    expect((await status(t, a!)).status).toBe('searching');
    expect((await status(t, b!)).status).toBe('searching');
    await queue(t, c!);
    t.services.ranked.tick();
    const [sa, sb, sc] = [await status(t, a!), await status(t, b!), await status(t, c!)];
    expect([sa.status, sb.status, sc.status].filter((s) => s === 'matched')).toHaveLength(2);
    expect(sc.status).toBe('matched'); // c plays whichever of them searched first
  });

  it('pairs the closest ratings when several are searching', async () => {
    const t = await env.boot();
    const ps = await signUp(t, 4);
    const ratings = [1000, 1500, 1010, 1490];
    for (const [i, p] of ps.entries()) {
      await t.db.query('INSERT INTO singles_ratings (account_id, rating, peak, games, last_played_at) VALUES ($1, $2, $2, 20, now())', [p.id, ratings[i]]);
      await queue(t, p);
    }
    t.scheduler.advance(5000 * 10);
    t.services.ranked.tick();
    const ids = await Promise.all(ps.map(async (p) => (await status(t, p)).matchId));
    expect(ids[0]).toBe(ids[2]);
    expect(ids[1]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('plays to the end, moves ratings, shows them on the results screen and offers no rematch', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    const id = await pairUp(t, a!, b!);
    connect(t, id, [a!, b!]);
    const view = await play(t, id, [a!, b!]);
    expect(view.phase).toBe('finished');
    await settle(t);
    const winner = view.winner === view.seats.find((s: any) => s.accountId === a!.id).team ? a! : b!;
    const loser = winner === a! ? b! : a!;
    expect(await singlesRating(t, winner)).toMatchObject({ rating: 1220, games: 1 });
    expect(await singlesRating(t, loser)).toMatchObject({ rating: 1180, games: 1 });

    const mine = (await t.call(winner.token, 'GET', `/api/matches/${id}`)).json();
    expect(mine.ratings).toMatchObject({ voided: false, you: { before: 1200, after: 1220, change: 20, mode: 'singles' } });
    expect(mine.ratings.players).toHaveLength(2);
    expect(mine.rematch).toBeNull();
    expect((await t.call(winner.token, 'POST', `/api/matches/${id}/rematch`, { accept: true })).statusCode).toBe(409);

    expect(t.services.registry.activeMatchOf(a!.id)).toBeUndefined(); // free to queue again
    const me = (await t.call(winner.token, 'GET', '/api/me')).json();
    expect(me.ratings.singles).toMatchObject({ rating: 1220, games: 1, wins: 1 });
    const history = (await t.call(winner.token, 'GET', '/api/me/matches')).json();
    expect(history.matches).toHaveLength(1);
  });

  it('a phone that never connects forfeits at the end of the reconnect window, and the match is void', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    const id = await pairUp(t, a!, b!);
    connect(t, id, [a!]); // b never shows up
    t.scheduler.advance(31_000);
    const view = t.services.registry.get(id)!.view();
    expect(view.phase).toBe('abandoned');
    await settle(t);
    expect(await singlesRating(t, a!)).toBeUndefined();
    expect(await singlesRating(t, b!)).toBeUndefined();
    expect((await status(t, b!)).status).toBe('cooldown');
    expect((await status(t, a!)).status).toBe('idle');
  });

  it('leaving mid-match loses the match for the one who left, and they wait before queueing again', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    const id = await pairUp(t, a!, b!);
    connect(t, id, [a!, b!]);
    await play(t, id, [a!, b!], (v) => v.phase === 'playing' && v.scores.A + v.scores.B > 0);
    const res = await t.call(a!.token, 'POST', `/api/matches/${id}/leave`);
    expect(res.statusCode).toBeLessThan(300);
    const view = t.services.registry.get(id)!.view();
    expect(view.phase).toBe('finished');
    expect(view.winReason).toBe('forfeit');
    const bTeam = view.seats.find((s) => s.accountId === b!.id)!.team;
    expect(view.winner).toBe(bTeam);
    await settle(t);
    expect(await singlesRating(t, a!)).toMatchObject({ games: 1 });
    expect((await singlesRating(t, a!))!.rating).toBeLessThan(1200);
    expect((await singlesRating(t, b!))!.rating).toBeGreaterThan(1200);
    const s = await status(t, a!);
    expect(s.status).toBe('cooldown');
    const denied = await queue(t, a!);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('ranked_cooldown');
    t.scheduler.advance(10 * 60_000 + 1);
    expect((await queue(t, a!)).statusCode).toBe(202);
    // the one who stayed is not punished
    expect((await queue(t, b!)).statusCode).toBe(202);
  });

  it('walking out and re-queueing in the same instant is still refused (the cooldown does not wait for the database)', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    const id = await pairUp(t, a!, b!);
    connect(t, id, [a!, b!]);
    await t.call(a!.token, 'POST', `/api/matches/${id}/leave`);
    // no settling: the database write for the cooldown may not have finished yet
    const denied = await queue(t, a!);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('ranked_cooldown');
    await settle(t);
    // once it is saved, staff can lift it by deleting the row
    await t.db.query('DELETE FROM ranked_cooldowns WHERE account_id = $1', [a!.id]);
    expect((await queue(t, a!)).statusCode).toBe(202);
  });

  it('the cooldown holds even while its database write is still in flight, and afterwards the database decides', async () => {
    const t = await env.boot();
    const [a] = await signUp(t, 1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = Object.create(t.db) as typeof t.db;
    slow.query = (sql: string, params?: readonly unknown[]) =>
      sql.includes('INSERT INTO ranked_cooldowns') ? gate.then(() => t.db.query(sql, params)) : t.db.query(sql, params);
    const ranked = new RankedService(slow, t.services.registry, t.services.ratings, t.scheduler);
    const saving = ranked.penalize(a!.id); // not awaited: the write is stuck
    expect(await ranked.cooldownUntil(a!.id)).not.toBeNull(); // still refused, from memory
    release();
    await saving;
    expect(await ranked.cooldownUntil(a!.id)).not.toBeNull(); // now from the database
    await t.db.query('DELETE FROM ranked_cooldowns WHERE account_id = $1', [a!.id]);
    expect(await ranked.cooldownUntil(a!.id)).toBeNull(); // staff lifted it
    t.scheduler.advance(FORFEIT_COOLDOWN_MS + 1);
  });

  it('a connected player who stops throwing forfeits after three timed-out throws in a row (no holding a match hostage)', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    const id = await pairUp(t, a!, b!);
    connect(t, id, [a!, b!]);
    for (let i = 0; i < 4000 && t.services.registry.get(id)!.view().phase !== 'finished'; i++) t.scheduler.advance(500); // nobody throws
    const view = t.services.registry.get(id)!.view();
    expect(view.phase).toBe('finished');
    expect(view.winReason).toBe('forfeit');
    const events = t.services.registry.get(id)!.eventsSince(0);
    const forfeit = events.find((e) => e.type === 'seat_forfeit')!;
    expect(forfeit.data.reason).toBe('idle');
    // whoever was due to throw first ran out of clock first, so they are the one who walked away
    const loserSeat = view.seats.find((s) => s.id === forfeit.data.seat)!;
    const loser = loserSeat.accountId === a!.id ? a! : b!;
    const winner = loser === a! ? b! : a!;
    expect(view.winner).not.toBe(loserSeat.team);
    await settle(t);
    expect((await status(t, loser)).status).toBe('cooldown');
    expect((await status(t, winner)).status).toBe('idle');
    expect((await singlesRating(t, winner))!.rating).toBeGreaterThan(1200);
    expect((await singlesRating(t, loser))!.rating).toBeLessThan(1200);
  });

  it('one timed-out throw is forgiven: throwing again clears the count', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    const id = await pairUp(t, a!, b!);
    connect(t, id, [a!, b!]);
    let timeouts = 0;
    const session = t.services.registry.get(id)!;
    for (let i = 0; i < 6000; i++) {
      const view = session.view();
      if (view.phase === 'finished') break;
      if (view.turn?.controlledBy === 'human') {
        const seat = view.seats.find((s) => s.id === view.turn!.seat)!;
        const p = seat.accountId === a!.id ? a! : b!;
        // every player lets every third throw run out, and throws the others: nobody ever times out three in a row
        if (session.eventsSince(0).filter((e) => e.type === 'turn_start').length % 3 !== 0) await t.call(p.token, 'POST', `/api/matches/${id}/throw`, PERFECT);
        else timeouts++;
      }
      t.scheduler.advance(500);
    }
    expect(timeouts).toBeGreaterThan(2);
    expect(session.eventsSince(0).some((e) => e.type === 'seat_forfeit')).toBe(false);
  });

  it('leaving before anyone has thrown voids the match: nobody gains or loses', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    const id = await pairUp(t, a!, b!);
    connect(t, id, [a!, b!]);
    await play(t, id, [a!, b!], (v) => v.phase === 'playing');
    await t.call(b!.token, 'POST', `/api/matches/${id}/leave`);
    await settle(t);
    expect(await singlesRating(t, a!)).toBeUndefined();
    expect(await singlesRating(t, b!)).toBeUndefined();
    const m = (await t.db.query<{ voided: boolean; ranked: string }>('SELECT voided, ranked FROM matches')).rows;
    expect(m).toEqual([{ voided: true, ranked: 'singles' }]);
    const mine = (await t.call(a!.token, 'GET', `/api/matches/${id}`)).json();
    expect(mine.ratings).toMatchObject({ voided: true, you: null });
  });

  it('leaving during the picks cancels the match', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    const id = await pairUp(t, a!, b!);
    connect(t, id, [a!, b!]);
    await t.call(a!.token, 'POST', `/api/matches/${id}/leave`);
    expect(t.services.registry.get(id)!.view().phase).toBe('abandoned');
    expect((await status(t, a!)).status).toBe('cooldown');
    expect((await queue(t, b!)).statusCode).toBe(202);
  });

  it('a ban removes the player from the queue at once', async () => {
    const t = await env.boot({ env: { ADMIN_TOKEN: 'a'.repeat(40) } });
    const [a, b] = await signUp(t, 2);
    await queue(t, a!);
    await t.call('a'.repeat(40), 'POST', `/admin/accounts/${a!.id}/ban`, { reason: 'cheating' });
    await queue(t, b!);
    t.services.ranked.tick();
    expect((await status(t, b!)).status).toBe('searching');
  });

  it('is refused during maintenance', async () => {
    const t = await env.boot({ env: { MAINTENANCE: 'true' } });
    const [a] = await signUp(t, 1);
    expect((await queue(t, a!)).json().error.code).toBe('maintenance');
  });
});

describe('idle players in casual matches', () => {
  it('after three timed-out throws in a row a bot plays for them, and they get the seat back when they act again', async () => {
    const t = await env.boot();
    const me = await t.guest('Idle Ian');
    const created = (await t.call(me.token, 'POST', '/api/matches', { config: { mode: '1v1', playTo: 21 } })).json();
    const id = created.matchId as string;
    await t.call(me.token, 'POST', `/api/matches/${id}/start`, {});
    const session = t.services.registry.get(id)!;
    session.setConnected(me.id, true);
    for (let i = 0; i < 4000 && !session.eventsSince(0).some((e) => e.type === 'seat_takeover'); i++) t.scheduler.advance(500); // never throws
    const takeover = session.eventsSince(0).find((e) => e.type === 'seat_takeover')!;
    expect(takeover.data).toMatchObject({ seat: 'A1', reason: 'idle' });
    expect(session.view(me.id).seats.find((s) => s.id === 'A1')!.controlledByBot).toBe(true);
    expect(session.view().phase).toBe('playing'); // the match carried on
    // coming back (a new connection) hands the seat back and clears the count
    session.setConnected(me.id, false);
    session.setConnected(me.id, true);
    expect(session.view(me.id).seats.find((s) => s.id === 'A1')!.controlledByBot).toBe(false);
  });
});

describe('ranked teams', () => {
  const makeParty = async (t: Booted, owner: Player, partner: Player) => {
    const created = await t.call(owner.token, 'POST', '/api/parties');
    expect(created.statusCode).toBe(201);
    const code = created.json().party.code as string;
    const joined = await t.call(partner.token, 'POST', '/api/parties/join', { code });
    expect(joined.statusCode).toBe(200);
    return code;
  };

  it('needs a party of two, and the partner is the person who joined it', async () => {
    const t = await env.boot();
    const [a, b, c] = await signUp(t, 3);
    expect((await queue(t, a!, 'teams')).json().error.code).toBe('party_required');
    const created = (await t.call(a!.token, 'POST', '/api/parties')).json().party;
    expect(created).toMatchObject({ members: [{ accountId: a!.id }], full: false });
    expect((await queue(t, a!, 'teams')).json().error.code).toBe('party_required');
    expect((await t.call(b!.token, 'POST', '/api/parties/join', { code: created.code.toLowerCase() })).json().party).toMatchObject({ full: true });
    expect((await t.call(c!.token, 'POST', '/api/parties/join', { code: created.code })).json().error.code).toBe('party_full');
    expect((await t.call(c!.token, 'POST', '/api/parties/join', { code: 'ZZZZZZ' })).json().error.code).toBe('party_not_found');
  });

  it('queues both partners together and starts a fixed-rules 2v2 with partners on the same team', async () => {
    const t = await env.boot();
    const [a, b, c, d] = await signUp(t, 4);
    await makeParty(t, a!, b!);
    await makeParty(t, c!, d!);
    expect((await queue(t, a!, 'teams')).json()).toMatchObject({ status: 'searching', mode: 'teams' });
    expect((await status(t, b!)).status).toBe('searching'); // partner is searching too
    expect((await queue(t, b!, 'teams')).json().error.code).toBe('already_queued');
    await queue(t, c!, 'teams');
    t.services.ranked.tick();
    const s = await status(t, a!);
    expect(s.status).toBe('matched');
    for (const p of [b!, c!, d!]) expect((await status(t, p)).matchId).toBe(s.matchId);
    const view = (await t.call(a!.token, 'GET', `/api/matches/${s.matchId}`)).json();
    expect(view).toMatchObject({ ranked: 'teams', config: { mode: '2v2', playTo: 21 } });
    const teamOf = (p: Player) => view.seats.find((x: any) => x.accountId === p.id).team;
    expect(teamOf(a!)).toBe(teamOf(b!));
    expect(teamOf(c!)).toBe(teamOf(d!));
    expect(teamOf(a!)).not.toBe(teamOf(c!));
  });

  it('plays a 2v2 and rates the two duos', async () => {
    const t = await env.boot();
    const ps = await signUp(t, 4);
    const [a, b, c, d] = ps as [Player, Player, Player, Player];
    await makeParty(t, a, b);
    await makeParty(t, c, d);
    await queue(t, a, 'teams');
    await queue(t, c, 'teams');
    t.services.ranked.tick();
    const id = (await status(t, a)).matchId;
    connect(t, id, ps);
    const view = await play(t, id, ps);
    await settle(t);
    const duos = (await t.db.query<{ rating: number; games: number }>('SELECT rating, games FROM duo_ratings ORDER BY rating DESC')).rows;
    expect(duos).toEqual([{ rating: 1220, games: 1 }, { rating: 1180, games: 1 }]);
    const winners = view.winner === 'A' ? ['A1', 'A2'] : ['B1', 'B2'];
    const winnerId = view.seats.find((s: any) => s.id === winners[0]).accountId;
    const me = (await t.call(ps.find((p) => p.id === winnerId)!.token, 'GET', '/api/me')).json();
    expect(me.ratings.teams).toHaveLength(1);
    expect(me.ratings.teams[0]).toMatchObject({ rating: 1220, games: 1, wins: 1 });
    expect(me.ratings.singles).toMatchObject({ rating: 1200, games: 0 });
  });

  it('a partner who walks out loses it for the whole team', async () => {
    const t = await env.boot();
    const ps = await signUp(t, 4);
    const [a, b, c, d] = ps as [Player, Player, Player, Player];
    await makeParty(t, a, b);
    await makeParty(t, c, d);
    await queue(t, a, 'teams');
    await queue(t, c, 'teams');
    t.services.ranked.tick();
    const id = (await status(t, a)).matchId;
    connect(t, id, ps);
    await play(t, id, ps, (v) => v.phase === 'playing' && v.scores.A + v.scores.B > 0);
    await t.call(a.token, 'POST', `/api/matches/${id}/leave`);
    const view = t.services.registry.get(id)!.view();
    expect(view.phase).toBe('finished');
    const aTeam = view.seats.find((s) => s.accountId === a.id)!.team;
    expect(view.winner).not.toBe(aTeam);
    await settle(t);
    expect((await status(t, a)).status).toBe('cooldown');
    expect((await status(t, b)).status).toBe('idle');
    const lost = (await t.db.query<{ rating: number }>('SELECT rating FROM duo_ratings ORDER BY rating')).rows;
    expect(lost[0]!.rating).toBeLessThan(1200);
  });

  it('leaving the party takes the duo out of the queue', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    await makeParty(t, a!, b!);
    await queue(t, a!, 'teams');
    await t.call(b!.token, 'DELETE', '/api/parties/me');
    expect((await status(t, a!)).status).toBe('idle');
    expect((await t.call(a!.token, 'GET', '/api/parties/me')).json().party).toMatchObject({ members: [{ accountId: a!.id }], full: false });
  });

  it('two people joining the last spot at the same moment: only one gets in', async () => {
    const t = await env.boot();
    const [a, b, c] = await signUp(t, 3);
    const code = (await t.call(a!.token, 'POST', '/api/parties')).json().party.code;
    // straight to the service so both checks run in the same instant (over HTTP the two requests can be staggered)
    const results = await Promise.allSettled([
      t.services.ranked.joinParty(code, { id: b!.id, displayName: 'B' }),
      t.services.ranked.joinParty(code, { id: c!.id, displayName: 'C' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(t.services.ranked.party(a!.id)!.members).toHaveLength(2);
  });

  it('joining a party whose owner left while you were joining fails cleanly', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    const code = (await t.call(a!.token, 'POST', '/api/parties')).json().party.code;
    const joining = t.call(b!.token, 'POST', '/api/parties/join', { code });
    t.services.ranked.leaveParty(a!.id); // happens while the join is waiting on the database
    expect((await joining).statusCode).toBe(404);
    expect(t.services.ranked.party(b!.id)).toBeNull();
  });

  it('will not let blocked players share a party', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    await t.call(a!.token, 'PUT', `/api/blocks/${b!.id}`);
    const code = (await t.call(a!.token, 'POST', '/api/parties')).json().party.code;
    expect((await t.call(b!.token, 'POST', '/api/parties/join', { code })).statusCode).toBe(403);
  });
});

describe('leaderboards', () => {
  const rate = (t: Booted, p: Player, rating: number, games = 12, ageDays = 0) =>
    t.db.query(
      `INSERT INTO singles_ratings (account_id, rating, peak, games, wins, losses, last_played_at) VALUES ($1, $2, $2, $3, $3, 0, $4)`,
      [p.id, rating, games, new Date(t.scheduler.now() - ageDays * 86_400_000)],
    );
  const board = async (t: Booted, p: Player, mode = 'singles', qs = '') => (await t.call(p.token, 'GET', `/api/leaderboards/${mode}${qs}`)).json();

  it('lists players best first, with rank, and hides the unqualified, inactive, opted-out and banned', async () => {
    const t = await env.boot({ env: { ADMIN_TOKEN: 'a'.repeat(40) } });
    const ps = await signUp(t, 8);
    const [top, mid, low, few, stale, hidden, banned, viewer] = ps as Player[] & [Player, Player, Player, Player, Player, Player, Player, Player];
    await rate(t, top, 1600);
    await rate(t, mid, 1400);
    await rate(t, low, 1250);
    await rate(t, few, 1900, 9); // not enough games
    await rate(t, stale, 1800, 20, 91); // not active
    await rate(t, hidden, 1700);
    await rate(t, banned, 1650);
    await t.call(hidden.token, 'PATCH', '/api/me', { showOnLeaderboards: false });
    await t.call('a'.repeat(40), 'POST', `/admin/accounts/${banned.id}/ban`, { reason: 'cheating' });
    const page = await board(t, viewer);
    expect(page).toMatchObject({ mode: 'singles', total: 3, minGames: 10, activeDays: 90, next: null });
    expect(page.entries.map((e: any) => [e.rank, e.members[0].accountId, e.rating])).toEqual([
      [1, top.id, 1600],
      [2, mid.id, 1400],
      [3, low.id, 1250],
    ]);
    expect(page.entries[0]).toMatchObject({ games: 12, wins: 12, losses: 0, members: [{ displayName: 'Player 1' }] });
  });

  it('a banned player who is unbanned comes back, and one who plays again returns from inactive', async () => {
    const t = await env.boot({ env: { ADMIN_TOKEN: 'a'.repeat(40) } });
    const [a, viewer] = await signUp(t, 2);
    await rate(t, a!, 1500, 12, 100);
    expect((await board(t, viewer!)).total).toBe(0);
    await t.db.query('UPDATE singles_ratings SET last_played_at = $2 WHERE account_id = $1', [a!.id, new Date(t.scheduler.now())]);
    t.services.ratings.invalidate();
    expect((await board(t, viewer!)).total).toBe(1);
    await t.call('a'.repeat(40), 'POST', `/admin/accounts/${a!.id}/ban`, { reason: 'x' });
    t.services.ratings.invalidate();
    expect((await board(t, viewer!)).total).toBe(0);
    await t.call('a'.repeat(40), 'POST', `/admin/accounts/${a!.id}/unban`);
    t.services.ratings.invalidate();
    expect((await board(t, viewer!)).total).toBe(1);
  });

  it('pages through, and breaks ties by games played', async () => {
    const t = await env.boot();
    const ps = await signUp(t, 5);
    await rate(t, ps[0]!, 1500, 12);
    await rate(t, ps[1]!, 1500, 30);
    await rate(t, ps[2]!, 1400);
    await rate(t, ps[3]!, 1300);
    await rate(t, ps[4]!, 1200);
    const p1 = await board(t, ps[4]!, 'singles', '?limit=2');
    expect(p1.entries.map((e: any) => e.members[0].accountId)).toEqual([ps[1]!.id, ps[0]!.id]);
    expect(p1).toMatchObject({ total: 5, next: 2, offset: 0 });
    const p2 = await board(t, ps[4]!, 'singles', '?limit=2&offset=2');
    expect(p2.entries.map((e: any) => e.rank)).toEqual([3, 4]);
    const p3 = await board(t, ps[4]!, 'singles', '?limit=2&offset=4');
    expect(p3).toMatchObject({ next: null });
    expect(p3.entries).toHaveLength(1);
    expect((await t.call(ps[0]!.token, 'GET', '/api/leaderboards/singles?limit=1000')).statusCode).toBe(400);
    expect((await t.call(ps[0]!.token, 'GET', '/api/leaderboards/doubles')).statusCode).toBe(400);
  });

  it('shows where I am, with the players around me, and what is missing if I am not on it yet', async () => {
    const t = await env.boot();
    const ps = await signUp(t, 6);
    for (const [i, p] of ps.slice(0, 5).entries()) await rate(t, p, 1500 - i * 50);
    await rate(t, ps[5]!, 1000, 4);
    const mine = (await t.call(ps[2]!.token, 'GET', '/api/leaderboards/singles/me')).json();
    expect(mine.standings).toHaveLength(1);
    expect(mine.standings[0]).toMatchObject({ rank: 3, rating: 1400, gamesNeeded: 0, hiddenReason: null });
    expect(mine.standings[0].neighbours.map((n: any) => n.rank)).toEqual([1, 2, 3, 4, 5]);
    const newbie = (await t.call(ps[5]!.token, 'GET', '/api/leaderboards/singles/me')).json();
    expect(newbie.standings[0]).toMatchObject({ rank: null, gamesNeeded: 6, games: 4, neighbours: [] });
    const nobody = await signUp(t, 1);
    expect((await t.call(nobody[0]!.token, 'GET', '/api/leaderboards/singles/me')).json()).toEqual({ standings: [] });
  });

  it('tells a player who hid themselves why they have no rank', async () => {
    const t = await env.boot();
    const [a] = await signUp(t, 1);
    await rate(t, a!, 1500);
    await t.call(a!.token, 'PATCH', '/api/me', { showOnLeaderboards: false });
    const mine = (await t.call(a!.token, 'GET', '/api/leaderboards/singles/me')).json();
    expect(mine.standings[0]).toMatchObject({ rank: null, hiddenReason: 'opted_out' });
  });

  it('ranks duos on the teams board and shows both names', async () => {
    const t = await env.boot();
    const [a, b, c, d] = await signUp(t, 4);
    const duo = async (x: Player, y: Player, rating: number) => {
      const [m1, m2] = x.id < y.id ? [x, y] : [y, x];
      await t.db.query(`INSERT INTO duo_ratings (duo_key, member_a, member_b, rating, peak, games, wins, last_played_at) VALUES ($1, $2, $3, $4, $4, 15, 15, now())`, [`${m1.id}:${m2.id}`, m1.id, m2.id, rating]);
    };
    await duo(a!, b!, 1500);
    await duo(a!, c!, 1300); // a plays with two different partners
    const page = await board(t, d!, 'teams');
    expect(page.total).toBe(2);
    expect(page.entries[0]).toMatchObject({ rank: 1, rating: 1500 });
    expect(page.entries[0].members.map((m: any) => m.displayName).sort()).toEqual(['Player 1', 'Player 2']);
    const mine = (await t.call(a!.token, 'GET', '/api/leaderboards/teams/me')).json();
    expect(mine.standings.map((s: any) => s.rank)).toEqual([1, 2]);
    const partner = (await t.call(b!.token, 'GET', '/api/leaderboards/teams/me')).json();
    expect(partner.standings.map((s: any) => s.rank)).toEqual([1]);
    // one partner hiding removes the duo
    await t.call(b!.token, 'PATCH', '/api/me', { showOnLeaderboards: false });
    t.services.ratings.invalidate();
    expect((await board(t, d!, 'teams')).total).toBe(1);
  });

  it('the data export includes ratings, the partner of each duo, and the leaderboard choice', async () => {
    const t = await env.boot();
    const [a, b] = await signUp(t, 2);
    await rate(t, a!, 1420, 14);
    const [m1, m2] = a!.id < b!.id ? [a!, b!] : [b!, a!];
    await t.db.query(`INSERT INTO duo_ratings (duo_key, member_a, member_b, rating, peak, games, wins, last_played_at) VALUES ($1, $2, $3, 1310, 1330, 11, 6, now())`, [`${m1.id}:${m2.id}`, m1.id, m2.id]);
    await t.call(a!.token, 'PATCH', '/api/me', { showOnLeaderboards: false });
    const data = (await t.call(a!.token, 'GET', '/api/me/export')).json();
    expect(data.ratings.singles).toMatchObject({ rating: 1420, games: 14 });
    expect(data.ratings.teams).toHaveLength(1);
    expect(data.ratings.teams[0]).toMatchObject({ partner_id: b!.id, rating: 1310 });
    expect(data.account).toMatchObject({ showOnLeaderboards: false });
    expect(data).toHaveProperty('rankedCooldown');
    // the partner sees the same duo from their side, with a as the partner
    const theirs = (await t.call(b!.token, 'GET', '/api/me/export')).json();
    expect(theirs.ratings.singles).toBeNull();
    expect(theirs.ratings.teams[0]).toMatchObject({ partner_id: a!.id });
  });

  it('erasing an account removes its ratings and its duos', async () => {
    const t = await env.boot();
    const [a, b, viewer] = await signUp(t, 3);
    await rate(t, a!, 1500);
    const [m1, m2] = a!.id < b!.id ? [a!, b!] : [b!, a!];
    await t.db.query(`INSERT INTO duo_ratings (duo_key, member_a, member_b, rating, peak, games, wins, last_played_at) VALUES ($1, $2, $3, 1500, 1500, 15, 15, now())`, [`${m1.id}:${m2.id}`, m1.id, m2.id]);
    await t.call(a!.token, 'DELETE', '/api/me');
    t.services.ratings.invalidate();
    expect((await board(t, viewer!)).total).toBe(0);
    expect((await board(t, viewer!, 'teams')).total).toBe(0);
  });

  it('serves a page from a short cache, and shows fresh data after a ranked result', async () => {
    const t = await env.boot();
    const [a, viewer] = await signUp(t, 2);
    await rate(t, a!, 1500);
    expect((await board(t, viewer!)).total).toBe(1);
    await t.db.query('DELETE FROM singles_ratings');
    expect((await board(t, viewer!)).total).toBe(1); // still cached
    t.scheduler.advance(11_000);
    expect((await board(t, viewer!)).total).toBe(0);
  });
});
