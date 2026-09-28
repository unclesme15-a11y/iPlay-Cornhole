import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/core/errors.js';
import { MatchEngine, seatFor } from '../src/core/match.js';
import { bags, cfg, playInning, startEngine } from './helpers.js';

describe('turn order', () => {
  it('alternates teams starting with the first team, 8 bags per inning', () => {
    const e = startEngine({ mode: '1v1' }, 'B');
    const order: string[] = [];
    for (let i = 0; i < 8; i++) {
      const n = e.next()!;
      order.push(n.team);
      e.recordThrow(n.seat, { bagId: n.bagId, status: 'board', updates: {} });
    }
    expect(order).toEqual(['B', 'A', 'B', 'A', 'B', 'A', 'B', 'A']);
  });

  it('1v1: same two seats throw every inning, from alternating ends', () => {
    const e = startEngine({ mode: '1v1' });
    expect(e.next()).toMatchObject({ seat: 'A1', fromEnd: 0, inning: 1 });
    playInning(e, { first: bags(), second: bags() });
    expect(e.next()).toMatchObject({ seat: 'A1', fromEnd: 1, inning: 2 });
  });

  it('2v2: near-end pair throws inning 1, far-end pair throws inning 2', () => {
    const e = startEngine({ mode: '2v2' });
    const seatsInning1 = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const n = e.next()!;
      seatsInning1.add(n.seat);
      e.recordThrow(n.seat, { bagId: n.bagId, status: 'ground', foul: 'missed_board', updates: {} });
    }
    expect([...seatsInning1].sort()).toEqual(['A1', 'B1']);
    const seatsInning2 = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const n = e.next()!;
      seatsInning2.add(n.seat);
      e.recordThrow(n.seat, { bagId: n.bagId, status: 'ground', foul: 'missed_board', updates: {} });
    }
    expect([...seatsInning2].sort()).toEqual(['A2', 'B2']);
  });

  it('each player throws exactly 4 bags per inning', () => {
    const e = startEngine({ mode: '2v2' });
    const counts: Record<string, number> = {};
    for (let i = 0; i < 8; i++) {
      const n = e.next()!;
      counts[n.seat] = (counts[n.seat] ?? 0) + 1;
      e.recordThrow(n.seat, { bagId: n.bagId, status: 'board', updates: {} });
    }
    expect(counts).toEqual({ A1: 4, B1: 4 });
  });

  it('reports bags left per team, counting the upcoming bag', () => {
    const e = startEngine({ mode: '1v1' });
    expect(e.next()!.bagsLeft).toEqual({ A: 4, B: 4 });
    const n = e.next()!;
    e.recordThrow(n.seat, { bagId: n.bagId, status: 'board', updates: {} });
    expect(e.next()!.bagsLeft).toEqual({ A: 3, B: 4 });
  });

  it('seatFor maps mode/team/end', () => {
    expect(seatFor('1v1', 'B', 1)).toBe('B1');
    expect(seatFor('2v2', 'A', 0)).toBe('A1');
    expect(seatFor('2v2', 'B', 1)).toBe('B2');
  });
});

describe('inning scoring and who throws first', () => {
  it('scoring team throws first next inning', () => {
    const e = startEngine({ mode: '1v1' }, 'A');
    playInning(e, { first: bags('board'), second: bags('hole') }); // B scores 2
    expect(e.scores).toEqual({ A: 0, B: 2 });
    expect(e.next()).toMatchObject({ team: 'B', inning: 2 });
  });

  it('after a wash the same team throws first again', () => {
    const e = startEngine({ mode: '1v1' }, 'B');
    playInning(e, { first: bags('board'), second: bags('board') });
    expect(e.scores).toEqual({ A: 0, B: 0 });
    expect(e.next()).toMatchObject({ team: 'B', inning: 2 });
  });

  it('records inning history', () => {
    const e = startEngine({ mode: '1v1' });
    playInning(e, { first: bags('hole', 'board'), second: bags('board') });
    const h = e.snapshot().history[0]!;
    expect(h).toMatchObject({ inning: 1, scoringTeam: 'A', scored: 3, points: { A: 4, B: 1 } });
    expect(h.bags.holes.A).toBe(1);
  });

  it('clears bags between innings', () => {
    const e = startEngine({ mode: '1v1' });
    playInning(e, { first: bags('board'), second: bags('board') });
    expect(e.bags).toHaveLength(0);
  });

  it('provisional tally tracks the live inning', () => {
    const e = startEngine({ mode: '1v1' });
    const n = e.next()!;
    e.recordThrow(n.seat, { bagId: n.bagId, status: 'hole', updates: {} });
    expect(e.provisional()).toMatchObject({ scoringTeam: 'A', scored: 3 });
  });
});

describe('winning', () => {
  function race(over: Parameters<typeof cfg>[0], perInning: 'hole' | 'board', target?: number) {
    const e = startEngine({ mode: '1v1', ...over }, 'A');
    void target;
    while (!e.finished) playInning(e, { first: bags(perInning, perInning, perInning, perInning), second: bags() });
    return e;
  }

  it('first to 21 wins, overshoot allowed', () => {
    const e = race({}, 'hole'); // A scores 12 per inning: 12, 24
    expect(e.winner).toBe('A');
    expect(e.scores.A).toBe(24);
    expect(e.snapshot().winReason).toBe('score');
  });

  it('play to 11 ends earlier', () => {
    const e = race({ playTo: 11 }, 'hole');
    expect(e.scores.A).toBe(12);
    expect(e.snapshot().history).toHaveLength(1);
  });

  it('play to 15', () => {
    const e = race({ playTo: 15 }, 'hole');
    expect(e.snapshot().history).toHaveLength(2);
  });

  it('no next throw after the match ends and recording is rejected', () => {
    const e = race({}, 'hole');
    expect(e.next()).toBeNull();
    expect(() => e.recordThrow('A1', { bagId: 'x', status: 'board', updates: {} })).toThrow(DomainError);
  });

  it('only the scoring team can win in an inning', () => {
    const e = startEngine({ mode: '1v1', playTo: 11 });
    // A: 4 holes (12), B: 4 holes (12) => wash, nobody wins.
    playInning(e, { first: bags('hole', 'hole', 'hole', 'hole'), second: bags('hole', 'hole', 'hole', 'hole') });
    expect(e.finished).toBe(false);
  });
});

describe('bust house rule', () => {
  it('going over the target drops the team back (21 -> 15)', () => {
    const e = startEngine({ mode: '1v1', bust: true }, 'A');
    // A: 12 + 6 = 18 after 2 innings (4 holes then 2 holes)
    playInning(e, { first: bags('hole', 'hole', 'hole', 'hole'), second: bags() });
    playInning(e, { first: bags('hole', 'hole'), second: bags() });
    expect(e.scores.A).toBe(18);
    // Next inning +12 would be 30 > 21 => bust to 15
    playInning(e, { first: bags('hole', 'hole', 'hole', 'hole'), second: bags() });
    expect(e.scores.A).toBe(15);
    expect(e.finished).toBe(false);
    expect(e.snapshot().history.at(-1)!.busted).toBe('A');
  });

  it('landing exactly on the target wins under bust', () => {
    const e = startEngine({ mode: '1v1', bust: true }, 'A');
    playInning(e, { first: bags('hole', 'hole', 'hole', 'hole'), second: bags() }); // 12
    playInning(e, { first: bags('hole', 'hole', 'hole', 'board'), second: bags() }); // +10 = 22 -> bust to 15
    expect(e.scores.A).toBe(15);
    playInning(e, { first: bags('hole', 'hole'), second: bags() }); // +6 = 21 exactly
    expect(e.winner).toBe('A');
  });

  it('bust off: overshoot wins', () => {
    const e = startEngine({ mode: '1v1', bust: false }, 'A');
    playInning(e, { first: bags('hole', 'hole', 'hole', 'hole'), second: bags() });
    playInning(e, { first: bags('hole', 'hole', 'hole', 'hole'), second: bags() });
    expect(e.winner).toBe('A');
    expect(e.scores.A).toBe(24);
  });
});

describe('skunk house rule', () => {
  it('leading 11-0 at end of an inning wins even when playing to 21', () => {
    const e = startEngine({ mode: '1v1', skunk: true, playTo: 21 }, 'A');
    playInning(e, { first: bags('hole', 'hole', 'hole', 'board'), second: bags() }); // 10-0
    expect(e.finished).toBe(false);
    playInning(e, { first: bags('board'), second: bags() }); // 11-0
    expect(e.winner).toBe('A');
    expect(e.snapshot().winReason).toBe('skunk');
  });

  it('does not trigger if the other team has any points', () => {
    const e = startEngine({ mode: '1v1', skunk: true, playTo: 21 }, 'A');
    playInning(e, { first: bags('hole', 'hole', 'hole', 'hole'), second: bags() }); // 12-0 -> skunk
    expect(e.winner).toBe('A');
    const f = startEngine({ mode: '1v1', skunk: true, playTo: 21 }, 'A');
    playInning(f, { first: bags('board'), second: bags() }); // 1-0
    playInning(f, { first: bags(), second: bags('board') }); // B scores 1: 1-1
    playInning(f, { first: bags('hole', 'hole', 'hole'), second: bags() }); // 10-1
    expect(f.finished).toBe(false);
  });

  it('off by default', () => {
    const e = startEngine({ mode: '1v1', playTo: 21 }, 'A');
    playInning(e, { first: bags('hole', 'hole', 'hole', 'hole'), second: bags() });
    expect(e.finished).toBe(false);
  });
});

describe('fouls, knocked bags and validation', () => {
  it('timer foul scores 0 and advances the turn', () => {
    const e = startEngine({ mode: '1v1' });
    const first = e.next()!;
    const events = e.foulTimeout(first.seat);
    expect(events[0]).toMatchObject({ type: 'bag_thrown', status: 'ground', foul: 'timer' });
    expect(e.next()).toMatchObject({ team: 'B', throwNumber: 2 });
    expect(e.provisional().points).toEqual({ A: 0, B: 0 });
  });

  it('a later bag can knock an earlier bag into the hole (scores 3 for its owner)', () => {
    const e = startEngine({ mode: '1v1' });
    const a1 = e.next()!;
    e.recordThrow(a1.seat, { bagId: a1.bagId, status: 'board', updates: {} });
    const b1 = e.next()!;
    e.recordThrow(b1.seat, { bagId: b1.bagId, status: 'board', updates: { [a1.bagId]: 'hole' } });
    expect(e.provisional().points).toEqual({ A: 3, B: 1 });
  });

  it('a later bag can knock an earlier bag off (removed, 0)', () => {
    const e = startEngine({ mode: '1v1' });
    const a1 = e.next()!;
    e.recordThrow(a1.seat, { bagId: a1.bagId, status: 'board', updates: {} });
    const b1 = e.next()!;
    const events = e.recordThrow(b1.seat, { bagId: b1.bagId, status: 'board', updates: { [a1.bagId]: 'ground' } });
    expect(e.provisional().points).toEqual({ A: 0, B: 1 });
    expect(e.bags.find((b) => b.id === a1.bagId)!.foul).toBe('knocked_off');
    expect(events[0]).toMatchObject({ updates: { [a1.bagId]: 'ground' } });
  });

  it('a bag in the hole cannot be removed again', () => {
    const e = startEngine({ mode: '1v1' });
    const a1 = e.next()!;
    e.recordThrow(a1.seat, { bagId: a1.bagId, status: 'hole', updates: {} });
    const b1 = e.next()!;
    expect(() =>
      e.recordThrow(b1.seat, { bagId: b1.bagId, status: 'board', updates: { [a1.bagId]: 'ground' } }),
    ).toThrow(/cannot change/);
  });

  it('rejects the wrong seat, wrong bag, unknown bag updates and ground without foul', () => {
    const e = startEngine({ mode: '1v1' });
    const n = e.next()!;
    expect(() => e.recordThrow('B1', { bagId: n.bagId, status: 'board', updates: {} })).toThrow(/not_your_turn|B1/);
    expect(() => e.recordThrow(n.seat, { bagId: 'nope', status: 'board', updates: {} })).toThrow(/Expected bag/);
    expect(() => e.recordThrow(n.seat, { bagId: n.bagId, status: 'board', updates: { ghost: 'ground' } })).toThrow(/unknown bag/);
    expect(() => e.recordThrow(n.seat, { bagId: n.bagId, status: 'ground', updates: {} })).toThrow(/foul reason/);
    // a rejected call must not have changed anything
    expect(e.next()).toEqual(n);
    expect(e.bags).toHaveLength(0);
  });

  it('rejects a partial failure atomically (bad update after a good one)', () => {
    const e = startEngine({ mode: '1v1' });
    const a1 = e.next()!;
    e.recordThrow(a1.seat, { bagId: a1.bagId, status: 'board', updates: {} });
    const b1 = e.next()!;
    expect(() =>
      e.recordThrow(b1.seat, { bagId: b1.bagId, status: 'board', updates: { [a1.bagId]: 'hole', ghost: 'hole' } }),
    ).toThrow();
    expect(e.bags.find((b) => b.id === a1.bagId)!.status).toBe('board');
  });
});

describe('forfeit and persistence', () => {
  it('forfeit gives the other team the win', () => {
    const e = startEngine({ mode: '1v1' });
    const events = e.forfeit('A');
    expect(events[0]).toMatchObject({ type: 'match_complete', winner: 'B', reason: 'forfeit' });
    expect(e.finished).toBe(true);
    expect(() => e.forfeit('B')).toThrow(/already over/);
  });

  it('snapshot/restore round-trips mid-inning and continues identically', () => {
    const a = startEngine({ mode: '2v2' });
    for (let i = 0; i < 5; i++) {
      const n = a.next()!;
      a.recordThrow(n.seat, { bagId: n.bagId, status: i % 2 ? 'hole' : 'board', updates: {} });
    }
    const b = MatchEngine.restore(a.snapshot());
    expect(b.snapshot()).toEqual(a.snapshot());
    for (let i = 0; i < 3; i++) {
      const na = a.next()!;
      const nb = b.next()!;
      expect(nb).toEqual(na);
      a.recordThrow(na.seat, { bagId: na.bagId, status: 'board', updates: {} });
      b.recordThrow(nb.seat, { bagId: nb.bagId, status: 'board', updates: {} });
    }
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it('snapshot is a copy, not a live reference', () => {
    const e = startEngine({ mode: '1v1' });
    const snap = e.snapshot();
    snap.scores.A = 99;
    expect(e.scores.A).toBe(0);
  });
});

describe('full random matches always terminate correctly', () => {
  it('1000 random matches: scores consistent with history, exactly one winner', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let m = 0; m < 1000; m++) {
      const playTo = ([11, 15, 21] as const)[Math.floor(rnd() * 3)]!;
      const e = new MatchEngine(cfg({ mode: rnd() < 0.5 ? '1v1' : '2v2', playTo, bust: rnd() < 0.3, skunk: rnd() < 0.3 }), rnd() < 0.5 ? 'A' : 'B');
      let guard = 0;
      while (!e.finished) {
        if (++guard > 2000) throw new Error('match did not terminate');
        const n = e.next()!;
        const r = rnd();
        const status = r < 0.25 ? 'hole' : r < 0.65 ? 'board' : 'ground';
        e.recordThrow(n.seat, { bagId: n.bagId, status, ...(status === 'ground' ? { foul: 'missed_board' as const } : {}), updates: {} });
      }
      const snap = e.snapshot();
      expect(snap.winner).not.toBeNull();
      const last = snap.history.at(-1)!;
      expect(last.scoreAfter).toEqual(snap.scores);
      expect(snap.history.every((h) => h.scored >= 0)).toBe(true);
    }
  });
});
