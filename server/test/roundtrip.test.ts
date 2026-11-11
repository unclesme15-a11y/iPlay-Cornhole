import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gestureToward } from '../src/bots/botPolicy.js';
import { TestEnv, type Booted } from './helpers/app.js';
import {
  CLIENT_HEADERS,
  Phone,
  cuesBetween,
  replayAt,
  type ClientThrow,
  type Gesture,
  type ReleaseBody,
} from './helpers/phoneClient.js';

/**
 * Client-server round trip for one casual match.
 *
 * The server runs in-process and listens on a real port. Each "phone" is a WebSocket client that
 * hellos, applies the stream, and posts throws the way the Unity `MatchSocket` / `MatchModel` /
 * `ThrowReplay` do. See `test/helpers/phoneClient.ts`.
 */

let env: TestEnv;
const phones: Phone[] = [];

beforeAll(async () => {
  env = await TestEnv.create();
});
afterAll(async () => {
  await env.destroy();
});
afterEach(async () => {
  await Promise.all(phones.splice(0).map((p) => p.disconnect().catch(() => undefined)));
  await env.closeAll();
});

const MISS: Gesture = { power: 0.05, aim: 0, arc: 0.5, spin: 0 };
const BOARD: Gesture = gestureToward({ x: 6, y: 20 }, 1);
const HOLE: Gesture = gestureToward({ x: 0, y: 39 }, 1);
/** Spread out so four lobs in one inning do not land on each other. */
const BOARD_SPOTS: Gesture[] = [
  gestureToward({ x: -7, y: 10 }, 1),
  gestureToward({ x: 7, y: 10 }, 1),
  gestureToward({ x: -7, y: 26 }, 1),
  gestureToward({ x: 7, y: 26 }, 1),
];
const PURE: ReleaseBody = { angleDeg: 0, speed: 8, holdMs: 400, curve: 0 };

const MATCH = {
  config: { mode: '1v1', playTo: 11, wind: 'off', throwTimerSec: null, bust: false, skunk: false },
  seats: { B1: { kind: 'human' } },
};

interface MatchView {
  protocol: number;
  seq: number;
  phase: string;
  scores: { A: number; B: number };
  inning: number;
  firstTeam: string | null;
  winner: string | null;
  winReason: string | null;
  turn: { seat: string; team: string; bagId: string; controlledBy: string; throwNumber: number; fromEnd: number; targetEnd: number } | null;
  board: Array<{ id: string; team: string; status: string; x: number | null; y: number | null }>;
  seats: Array<{ id: string; characterId: string | null; name: string | null; accountId: string | null; claimed: boolean; connected: boolean }>;
  history: Array<{ scoringTeam: string | null; scored: number; scoreAfter: { A: number; B: number } }>;
}

interface Table {
  t: Booted;
  matchId: string;
  host: Phone;
  guest: Phone;
  hostAccount: { token: string; id: string; name: string };
  guestAccount: { token: string; id: string; name: string };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function twoPlayer(): Promise<Table> {
  const t = await env.boot();
  const hostAccount = await t.guest('Host');
  const guestAccount = await t.guest('Guest');
  const port = await t.listen();
  const created = await t.call(hostAccount.token, 'POST', '/api/matches', MATCH, CLIENT_HEADERS);
  expect(created.statusCode, created.body).toBe(201);
  const matchId = created.json().matchId as string;

  const host = new Phone({ port, matchId, token: hostAccount.token, accountId: hostAccount.id, call: t.call });
  phones.push(host);
  await host.connect();

  const joined = await t.call(guestAccount.token, 'POST', `/api/matches/${matchId}/join`, { seat: 'B1' }, CLIENT_HEADERS);
  expect(joined.statusCode, joined.body).toBe(201);
  expect(joined.json().seat).toBe('B1');

  const guest = new Phone({ port, matchId, token: guestAccount.token, accountId: guestAccount.id, call: t.call });
  phones.push(guest);
  await guest.connect();
  await host.waitFor(() => host.model.seat('B1')?.accountId === guestAccount.id, 'host sees the guest');
  return { t, matchId, host, guest, hostAccount, guestAccount };
}

async function serverView(table: Table): Promise<MatchView> {
  const res = await table.t.call(table.hostAccount.token, 'GET', `/api/matches/${table.matchId}`, undefined, CLIENT_HEADERS);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as MatchView;
}

/** Wait until both phones have applied every event the server has already produced. */
async function settle(table: Table): Promise<MatchView> {
  const view = await serverView(table);
  await table.host.waitFor(() => table.host.model.seq === view.seq, 'host caught up');
  await table.guest.waitFor(() => table.guest.model.seq === view.seq, 'guest caught up');
  return view;
}

async function reachPlaying(table: Table): Promise<void> {
  const started = await table.t.call(table.hostAccount.token, 'POST', `/api/matches/${table.matchId}/start`, {}, CLIENT_HEADERS);
  expect(started.statusCode, started.body).toBe(200);
  expect(await table.host.pickCharacter('keisha')).toBe(true);
  expect(await table.guest.pickCharacter('tanya')).toBe(true);
  expect(await table.host.pickColor('royal-blue')).toBe(true);
  expect(await table.guest.pickColor('hot-pink')).toBe(true);
  for (let i = 0; i < 30 && table.host.model.phase !== 'playing'; i++) {
    table.t.scheduler.advance(500);
    await delay(15);
  }
  await table.host.waitFor(() => table.host.model.phase === 'playing', 'host playing');
  await table.guest.waitFor(() => table.guest.model.phase === 'playing', 'guest playing');
  await settle(table);
}

function current(table: Table): Phone {
  const who = [table.host, table.guest].find((p) => p.model.isMyTurn);
  if (!who) throw new Error(`no human turn (phase ${table.host.model.phase})`);
  return who;
}

function other(table: Table, phone: Phone): Phone {
  return phone === table.host ? table.guest : table.host;
}

async function openNextTurn(table: Table): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (table.host.model.turn || table.guest.model.turn) {
      await settle(table);
      return;
    }
    table.t.scheduler.advance(500);
    await delay(15);
  }
  throw new Error('the next turn never opened');
}

async function throwOne(table: Table, gesture: Gesture, release?: ReleaseBody): Promise<{ thrown: ClientThrow; view: MatchView }> {
  const who = current(table);
  const bagId = who.model.turn?.bagId;
  if (!bagId) throw new Error('the open turn has no bag');
  const sent = await who.sendThrow(gesture, release);
  expect(sent.ok, JSON.stringify(sent)).toBe(true);
  expect(sent.body?.accepted).toBe(true);
  await table.host.waitFor(() => table.host.model.lastThrow?.bagId === bagId, 'host saw the throw');
  await table.guest.waitFor(() => table.guest.model.lastThrow?.bagId === bagId, 'guest saw the throw');
  const view = await settle(table);
  const thrown = table.host.model.lastThrow;
  if (!thrown) throw new Error('the throw was not applied');
  return { thrown, view };
}

function expectBoard(phone: Phone, view: MatchView, label: string): void {
  const server = [...view.board].sort((a, b) => a.id.localeCompare(b.id));
  const client = [...phone.model.board.values()].sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''));
  expect(client.map((b) => b.id), label).toEqual(server.map((b) => b.id));
  for (let i = 0; i < server.length; i++) {
    const got = client[i]!;
    const want = server[i]!;
    expect(got.team, label).toBe(want.team);
    expect(got.status, label).toBe(want.status);
    if (want.x == null) expect(got.hasPosition, `${label} ${want.id}`).toBe(false);
    else {
      expect(got.hasPosition, label).toBe(true);
      expect(got.x, label).toBeCloseTo(want.x, 5);
      expect(got.y, label).toBeCloseTo(want.y ?? 0, 5);
    }
  }
}

function expectClientMatches(phone: Phone, view: MatchView, label: string): void {
  const m = phone.model;
  expect(m.seq, label).toBe(view.seq);
  expect(m.phase, label).toBe(view.phase);
  expect(m.scoreA, label).toBe(view.scores.A);
  expect(m.scoreB, label).toBe(view.scores.B);
  // While the next turn is still closed, the phone keeps the inning from the last turn_start.
  // The engine has already stepped the view's inning forward. They meet again on the next turn.
  if (view.turn || view.phase !== 'playing') expect(m.inning, label).toBe(view.inning);
  // The phone stores the coin toss. The engine rewrites firstTeam to whoever leads the next
  // inning, and the only screen that reads it is the toss screen, which has already moved on.
  if ((view.inning ?? 0) <= 1 && view.phase !== 'finished') expect(m.firstTeam, label).toBe(view.firstTeam);
  expect(m.winner, label).toBe(view.winner);
  expect(m.winReason, label).toBe(view.winReason);
  if (!view.turn) expect(m.turn, label).toBeNull();
  else {
    expect(m.turn?.seat, label).toBe(view.turn.seat);
    expect(m.turn?.team, label).toBe(view.turn.team);
    expect(m.turn?.bagId, label).toBe(view.turn.bagId);
    expect(m.turn?.controlledBy, label).toBe(view.turn.controlledBy);
    expect(m.turn?.throwNumber, label).toBe(view.turn.throwNumber);
  }
  const myTurn = view.phase === 'playing' && view.turn?.controlledBy === 'human' && view.turn.seat === m.youSeat;
  expect(m.isMyTurn, label).toBe(myTurn);
  // inning_complete always clears the phone's board. On a winning inning the engine keeps those
  // bags in the snapshot (the results screen never reads them), so the two lists differ only then.
  if (view.phase !== 'finished') expectBoard(phone, view, label);
}

function expectRenderableFlight(result: ClientThrow): void {
  expect(result.flight.length).toBeGreaterThan(8);
  const first = result.flight[0]!;
  const last = result.flight[result.flight.length - 1]!;
  expect(first.y).toBeLessThan(0);
  expect(first.z).toBeGreaterThan(30);
  expect(last.t).toBe(result.flightMs);
  let gap = 0;
  for (let i = 1; i < result.flight.length; i++) {
    const prev = result.flight[i - 1]!;
    const step = result.flight[i]!;
    expect(step.t).toBeGreaterThanOrEqual(prev.t);
    gap += step.t - prev.t;
  }
  const average = gap / (result.flight.length - 1);
  expect(average).toBeGreaterThan(20);
  expect(average).toBeLessThan(50);
}

async function playInning(table: Table): Promise<ClientThrow[]> {
  const thrown: ClientThrow[] = [];
  let aimed = 0;
  for (let n = 0; n < 8; n++) {
    const team = current(table).model.turn?.team;
    const gesture = team === 'A' ? BOARD_SPOTS[aimed++]! : MISS;
    const { thrown: result } = await throwOne(table, gesture);
    expect(result.team).toBe(team);
    if (team === 'A') expect(result.status, result.bagId ?? '').toBe('board');
    else {
      expect(result.status).toBe('ground');
      expect(result.foul).toBe('missed_board');
    }
    thrown.push(result);
    if (n < 7 && table.host.model.phase !== 'finished') await openNextTurn(table);
  }
  return thrown;
}

describe('client-server round trip', () => {
  it('a friend joins an open seat and both phones take the welcome', async () => {
    const table = await twoPlayer();
    expect(table.host.model.youSeat).toBe('A1');
    expect(table.host.model.youAreHost).toBe(true);
    expect(table.host.model.mode).toBe('1v1');
    expect(table.host.model.playTo).toBe(11);
    expect(table.host.model.windSetting).toBe('off');
    expect(table.host.model.phase).toBe('lobby');
    expect(table.guest.model.youSeat).toBe('B1');
    expect(table.guest.model.youAreHost).toBe(false);
    expect(table.host.model.seat('B1')).toMatchObject({ name: 'Guest', accountId: table.guestAccount.id, claimed: true, kind: 'human' });
    expect(table.guest.model.seat('A1')).toMatchObject({ name: 'Host', accountId: table.hostAccount.id });

    const view = await settle(table);
    expect(view.protocol).toBe(2);
    expectClientMatches(table.host, view, 'host');
    expectClientMatches(table.guest, view, 'guest');

    await reachPlaying(table);
    const late = await table.t.guest('Late');
    const denied = await table.t.call(late.token, 'POST', `/api/matches/${table.matchId}/join`, {}, CLIENT_HEADERS);
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.code).toBe('wrong_phase');

    const again = await table.t.call(table.guestAccount.token, 'POST', `/api/matches/${table.matchId}/join`, {}, CLIENT_HEADERS);
    expect(again.statusCode).toBe(201);
    expect(again.json().seat).toBe('B1');
  });

  it('a throw is accepted, resolved by the server, and both phones replay the same flight', async () => {
    const table = await twoPlayer();
    await reachPlaying(table);
    expect(table.host.model.colors).toEqual({ A: 'royal-blue', B: 'hot-pink' });
    expect(table.guest.model.colors).toEqual(table.host.model.colors);
    expect(table.host.model.windMph).toBe(0);
    expect([table.host, table.guest].filter((p) => p.model.isMyTurn)).toHaveLength(1);
    const tossing = current(table).model.turn;
    expect(tossing?.windMph).toBe(0);
    expect(tossing?.fromEnd).toBe(0);
    expect(tossing?.targetEnd).toBe(1);

    const { thrown, view } = await throwOne(table, BOARD, PURE);
    expectClientMatches(table.host, view, 'host');
    expectClientMatches(table.guest, view, 'guest');
    expect(table.guest.model.lastThrow).toEqual(thrown);
    expect(thrown.status).toBe('board');
    expect(thrown.foul).toBeNull();
    expect(thrown.framesOmitted).toBe(false);
    expectRenderableFlight(thrown);
    expect(thrown.slide.length).toBeGreaterThan(0);
    expect(Object.keys(thrown.slide[0]!.bags).length).toBeGreaterThan(0);
    expect(thrown.release).toMatchObject({ verdict: 'pure', pushIn: 0, shortIn: 0, aimedPower: BOARD.power, aimedAim: BOARD.aim, aimedArc: BOARD.arc });
    expect(thrown.windCross).toBe(0);
    expect(thrown.windAlong).toBe(0);
    expect(thrown.driftX).toBe(0);
    expect(thrown.driftY).toBe(0);

    const raw = table.host.model.rawThrow;
    expect(raw).toBeTruthy();
    const echoed = raw!.gesture as Gesture;
    expect(echoed.power).toBeCloseTo(BOARD.power, 5);
    expect(echoed.aim).toBeCloseTo(BOARD.aim, 5);
    expect(typeof raw!.seed).toBe('number');
    expect(raw!.flight as unknown[]).toHaveLength(thrown.flight.length);
    expect(raw!.slide as unknown[]).toHaveLength(thrown.slide.length);

    const before = table.host.model.boardBeforeLastThrow;
    const mid = replayAt(thrown, thrown.flightMs / 2, before);
    expect(mid.phase).toBe('flight');
    expect(mid.height).toBeGreaterThan(10);
    expect(mid.bag.y).toBeLessThan(0);
    expect(cuesBetween(thrown, -1, thrown.flightMs - 1).map((c) => c.sound)).not.toContain('bag_thud');
    expect(cuesBetween(thrown, thrown.flightMs - 1, thrown.flightMs).map((c) => c.sound)).toContain('bag_thud');
    const rest = replayAt(thrown, thrown.durationMs, before);
    expect(rest.phase).toBe('rest');
    expect(rest.bag).toEqual(thrown.resting[thrown.bagId!]!);
    expect(table.host.model.board.get(thrown.bagId!)?.status).toBe('board');

    await openNextTurn(table);
    const next = current(table).model.turn;
    expect(next?.seat).not.toBe(thrown.seat);
    expect(next?.throwNumber).toBe(2);
  });

  it('a miss is a foul: the bag leaves the board, and the flight is still replayable', async () => {
    const table = await twoPlayer();
    await reachPlaying(table);
    const { thrown, view } = await throwOne(table, MISS);
    expect(thrown.status).toBe('ground');
    expect(thrown.foul).toBe('missed_board');
    expect(thrown.slide).toEqual([]);
    expect(thrown.holeEvents).toEqual([]);
    expect(thrown.cues.map((c) => c.sound)).toEqual(['ground_thud']);
    expect(thrown.resting[thrown.bagId!]).toBeUndefined();
    expect(table.host.model.board.has(thrown.bagId!)).toBe(false);
    expect(table.guest.model.board.has(thrown.bagId!)).toBe(false);
    expectRenderableFlight(thrown);
    const mid = replayAt(thrown, thrown.flightMs / 2, table.host.model.boardBeforeLastThrow);
    expect(mid.phase).toBe('flight');
    expect(mid.height).toBeGreaterThan(0);
    expect(mid.bag.y).toBeLessThan(0);
    expectClientMatches(table.host, view, 'host');
    expectClientMatches(table.guest, view, 'guest');
    expect(table.guest.model.lastThrow).toEqual(thrown);
  });

  it('a bag in the hole carries the ring-in cue, and the replay drops it in', async () => {
    const table = await twoPlayer();
    await reachPlaying(table);
    let thrown: ClientThrow | null = null;
    let view: MatchView | null = null;
    for (let i = 0; i < 12 && !thrown; i++) {
      const shot = await throwOne(table, HOLE);
      if (shot.thrown.status === 'hole') {
        thrown = shot.thrown;
        view = shot.view;
      } else if (table.host.model.phase !== 'finished') {
        await openNextTurn(table);
      }
    }
    expect(thrown, 'a calm lob at the hole did not go in within 12 throws').not.toBeNull();
    const hole = thrown!;
    const holeView = view!;
    expect(hole.holeEvents.length).toBeGreaterThan(0);
    expect(hole.holeEvents[0]).toMatchObject({ bagId: hole.bagId });
    expect(['direct', 'slide']).toContain(hole.holeEvents[0]!.cause);
    expect(hole.cues.some((c) => c.reason === 'hole' && c.sound === 'cornhole_hit' && c.led?.pattern === 'flash_burst' && (c.led?.colors.length ?? 0) > 0)).toBe(true);
    expect(hole.resting[hole.bagId!]).toBeUndefined();
    expectRenderableFlight(hole);
    const atHole = replayAt(hole, hole.holeEvents[0]!.tMs, table.host.model.boardBeforeLastThrow);
    expect(atHole.inHole).toContain(hole.bagId);
    expect(atHole.board[hole.bagId!]).toBeUndefined();
    expect(table.host.model.board.get(hole.bagId!)).toMatchObject({ status: 'hole', hasPosition: false });
    expect(table.guest.model.board.get(hole.bagId!)).toMatchObject({ status: 'hole', hasPosition: false });
    expect(table.guest.model.lastThrow).toEqual(hole);
    expectClientMatches(table.host, holeView, 'host');
    expectClientMatches(table.guest, holeView, 'guest');
  });

  it('an inning scores the difference, clears the board, and the match ends on the target', async () => {
    const table = await twoPlayer();
    await reachPlaying(table);

    const first = await playInning(table);
    expect(first.filter((t) => t.seat === 'A1')).toHaveLength(4);
    expect(first.filter((t) => t.seat === 'B1')).toHaveLength(4);
    for (let i = 1; i < first.length; i++) expect(first[i]!.seat).not.toBe(first[i - 1]!.seat);
    expect(first.every((t) => t.fromEnd === 0 && t.targetEnd === 1)).toBe(true);

    const scored = await settle(table);
    expect(scored.scores).toEqual({ A: 4, B: 0 });
    expect(scored.history[0]).toMatchObject({ scoringTeam: 'A', scored: 4, scoreAfter: { A: 4, B: 0 } });
    expect(scored.board).toEqual([]);
    expect(table.host.model.scoreLog).toEqual([{ team: 'A', points: 4 }]);
    expect(table.guest.model.scoreLog).toEqual([{ team: 'A', points: 4 }]);
    expect(table.host.model.board.size).toBe(0);
    expect(table.host.model.inning).toBe(1);
    expectClientMatches(table.host, scored, 'host after the inning');
    expectClientMatches(table.guest, scored, 'guest after the inning');

    await openNextTurn(table);
    expect(current(table).model.turn).toMatchObject({ team: 'A', throwNumber: 1, fromEnd: 1, targetEnd: 0 });
    expect(table.host.model.inning).toBe(2);

    for (let i = 0; i < 5 && table.host.model.phase !== 'finished'; i++) {
      await playInning(table);
      if (table.host.model.phase !== 'finished') await openNextTurn(table);
    }
    const end = await settle(table);
    expect(end.phase).toBe('finished');
    expect(end.winner).toBe('A');
    expect(end.winReason).toBe('score');
    expect(end.scores.A).toBeGreaterThanOrEqual(11);
    expect(end.scores.B).toBe(0);
    expect(end.turn).toBeNull();
    expect(table.host.model.isOver).toBe(true);
    expect(table.guest.model.isOver).toBe(true);
    expect(table.host.model.board.size).toBe(0);
    expect(table.guest.model.board.size).toBe(0);
    expectClientMatches(table.host, end, 'host at the end');
    expectClientMatches(table.guest, end, 'guest at the end');
  });

  it('rejects a throw in the wrong phase, out of turn, or with a bad gesture, and still accepts the real one', async () => {
    const table = await twoPlayer();
    const early = await table.host.postThrow(MISS);
    expect(early.status).toBe(409);
    expect(early.code).toBe('wrong_phase');
    expect((await table.host.sendThrow(MISS)).code).toBe('not_sent');

    const stranger = await table.t.guest('Stranger');
    const outsider = await table.t.call(stranger.token, 'POST', `/api/matches/${table.matchId}/throw`, MISS, CLIENT_HEADERS);
    expect(outsider.statusCode).toBe(404);
    expect(outsider.json().error.code).toBe('unknown_player');

    await reachPlaying(table);
    const mine = current(table);
    const them = other(table, mine);
    const seq = table.host.model.seq;

    expect((await them.sendThrow(MISS)).code).toBe('not_sent');
    const stolen = await them.postThrow(MISS);
    expect(stolen.status).toBe(409);
    expect(stolen.code).toBe('not_your_turn');
    await delay(40);
    expect(table.host.model.seq).toBe(seq);
    expect(table.guest.model.seq).toBe(seq);
    expect(mine.model.isMyTurn).toBe(true);

    const wild = await mine.postThrow({ power: 1.5, aim: 0, arc: 0.4, spin: 0 });
    expect(wild.status).toBe(400);
    expect(wild.code).toBe('bad_gesture');
    const extra = await mine.post(`/api/matches/${table.matchId}/throw`, { power: 0.5, aim: 0, arc: 0.5, spin: 0, foo: 1 });
    expect(extra.status).toBe(400);
    expect(extra.code).toBe('bad_request');
    expect(mine.model.isMyTurn).toBe(true);
    expect(table.host.model.seq).toBe(seq);

    const { thrown, view } = await throwOne(table, MISS);
    expect(thrown.status).toBe('ground');
    expect(thrown.seat).toBe(mine.model.youSeat);
    expectClientMatches(mine, view, 'after the legal miss');
  });

  it('a reconnect applies the throws it missed without their animation frames, and a seq from the future reloads the view', async () => {
    const table = await twoPlayer();
    await reachPlaying(table);
    const stayer = current(table);
    const watcher = other(table, stayer);
    const watcherSeat = watcher.model.youSeat;
    expect(watcherSeat).toBeTruthy();

    await watcher.disconnect();
    await stayer.waitFor(() => stayer.model.seat(watcherSeat!)?.connected === false, 'the seat shows disconnected');

    const bagId = stayer.model.turn?.bagId;
    expect(bagId).toBeTruthy();
    const sent = await stayer.sendThrow(BOARD);
    expect(sent.ok, JSON.stringify(sent)).toBe(true);
    await stayer.waitFor(() => stayer.model.lastThrow?.bagId === bagId, 'live throw');
    const live = stayer.model.lastThrow!;
    expect(live.framesOmitted).toBe(false);
    expect(live.flight.length).toBeGreaterThan(8);

    await watcher.reconnect();
    await watcher.waitFor(() => watcher.model.lastThrow?.bagId === bagId, 'missed throw applied');
    const missed = watcher.model.lastThrow!;
    expect(missed.framesOmitted).toBe(true);
    expect(missed.flight).toEqual([]);
    expect(missed.slide).toEqual([]);
    expect(missed.status).toBe(live.status);
    expect(missed.resting).toEqual(live.resting);
    expect(missed.foul).toBe(live.foul);
    expect(watcher.model.rawThrow?.framesOmitted).toBe(true);
    expect(watcher.model.rawThrow?.flight).toBeUndefined();
    expect(watcher.model.rawThrow?.slide).toBeUndefined();

    const resumed = await settle(table);
    expectClientMatches(stayer, resumed, 'stayer');
    expectClientMatches(watcher, resumed, 'watcher');
    expect(watcher.model.seat(watcherSeat!)?.connected).toBe(true);

    await openNextTurn(table);
    const { thrown } = await throwOne(table, MISS);
    expect(watcher.model.lastThrow?.bagId).toBe(thrown.bagId);
    expect(watcher.model.lastThrow?.framesOmitted).toBe(false);
    expect(watcher.model.lastThrow?.flight.length).toBeGreaterThan(8);
    expect(watcher.model.lastThrow).toEqual(stayer.model.lastThrow);

    watcher.model.seq = 999_999;
    await watcher.reconnect();
    expect(watcher.resynced).toBe(1);
    const reloaded = await settle(table);
    expect(watcher.model.seq).toBe(reloaded.seq);
    expect(watcher.model.seq).toBeLessThan(999_999);
    expectClientMatches(watcher, reloaded, 'after resync');
    expectClientMatches(stayer, reloaded, 'stayer after the other phone resynced');
  });

  it('the server stores a character pick and tells the other phone', async () => {
    const table = await twoPlayer();
    const started = await table.t.call(table.hostAccount.token, 'POST', `/api/matches/${table.matchId}/start`, {}, CLIENT_HEADERS);
    expect(started.statusCode, started.body).toBe(200);
    const before = table.guest.model.seq;
    expect(await table.host.pickCharacter('keisha')).toBe(true);
    await table.guest.waitFor(() => table.guest.model.seq > before, 'character event');
    await table.host.waitFor(() => table.host.model.seq > before, 'host character event');
    const view = await serverView(table);
    expect(view.seats.find((s) => s.id === 'A1')?.characterId).toBe('keisha');
    expect(view.phase).toBe('characters');
  });

  // MatchModel.ApplyEvent ignores character_picked, and MatchSession.PickCharacterAsync throws
  // away the view from POST /character. The pick screen (CornholeApp.Match.DrawCharacterPick)
  // decides which names are taken by reading Seat.CharacterId, so neither phone can see the pick.
  // The server side of this is the test above. Remove `.fails` once the client records the pick.
  it.fails('a phone records a character pick on the seat the pick screen reads', async () => {
    const table = await twoPlayer();
    const started = await table.t.call(table.hostAccount.token, 'POST', `/api/matches/${table.matchId}/start`, {}, CLIENT_HEADERS);
    expect(started.statusCode, started.body).toBe(200);
    const before = table.guest.model.seq;
    expect(await table.host.pickCharacter('keisha')).toBe(true);
    await table.guest.waitFor(() => table.guest.model.seq > before, 'character event');
    expect(table.guest.model.seat('A1')?.characterId).toBe('keisha');
    expect(table.host.model.seat('A1')?.characterId).toBe('keisha');
  });

  // The event log strips flight and slide and sets framesOmitted. MatchModel still raises
  // ThrowResultReceived for that event, and nothing in the client reads FramesOmitted, so the
  // presenter starts a replay that has no samples. The contract says to show the new state and
  // not replay the old animation. The reconnect test above checks the board; this one checks the
  // notification. Remove `.fails` once an omitted throw does not start a replay.
  it.fails('a throw whose animation frames were dropped does not start a replay', async () => {
    const table = await twoPlayer();
    await reachPlaying(table);
    const stayer = current(table);
    const watcher = other(table, stayer);
    await watcher.disconnect();
    const bagId = stayer.model.turn?.bagId;
    const sent = await stayer.sendThrow(BOARD);
    expect(sent.ok, JSON.stringify(sent)).toBe(true);
    await stayer.waitFor(() => stayer.model.lastThrow?.bagId === bagId, 'live throw');
    await watcher.reconnect();
    await watcher.waitFor(() => watcher.model.lastThrow?.bagId === bagId, 'missed throw');
    expect(watcher.model.lastThrow?.framesOmitted).toBe(true);
    expect(watcher.model.presented.filter((t) => t.framesOmitted)).toEqual([]);
  });
});
