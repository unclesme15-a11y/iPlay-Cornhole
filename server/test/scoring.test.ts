import { describe, expect, it } from 'vitest';
import { tallyInning } from '../src/core/scoring.js';
import type { BagRecord } from '../src/core/types.js';

function bag(team: 'A' | 'B', status: BagRecord['status'], n: number): BagRecord {
  return { id: `${team}${n}`, team, seat: `${team}1`, status };
}

describe('cancellation scoring', () => {
  it('one hole + one board vs one board: scoring team gets 3 (rules doc example)', () => {
    const t = tallyInning([bag('A', 'hole', 1), bag('A', 'board', 2), bag('B', 'board', 1)]);
    expect(t.points).toEqual({ A: 4, B: 1 });
    expect(t.scoringTeam).toBe('A');
    expect(t.scored).toBe(3);
  });

  it('equal points are a wash', () => {
    const t = tallyInning([bag('A', 'hole', 1), bag('A', 'board', 2), bag('B', 'hole', 1), bag('B', 'board', 2)]);
    expect(t.scoringTeam).toBeNull();
    expect(t.scored).toBe(0);
  });

  it('ground bags score nothing', () => {
    const t = tallyInning([bag('A', 'ground', 1), bag('B', 'board', 1)]);
    expect(t.points).toEqual({ A: 0, B: 1 });
    expect(t.scoringTeam).toBe('B');
  });

  it('max inning is 12 (four holes vs nothing)', () => {
    const t = tallyInning([1, 2, 3, 4].map((n) => bag('A', 'hole', n)));
    expect(t.scored).toBe(12);
  });

  it('empty inning is a wash', () => {
    expect(tallyInning([]).scoringTeam).toBeNull();
  });
});
