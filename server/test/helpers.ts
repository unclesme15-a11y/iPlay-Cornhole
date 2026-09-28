import { MatchEngine } from '../src/core/match.js';
import { DEFAULT_CONFIG, type BagStatus, type MatchConfig, type TeamId } from '../src/core/types.js';

export function cfg(over: Partial<MatchConfig> = {}): MatchConfig {
  return { ...DEFAULT_CONFIG, ...over };
}

/**
 * Throw a whole inning. `plan` lists the status of each bag in throw order for each team:
 * plan.first are the bags of the team throwing first, plan.second the other team's.
 */
export function playInning(
  engine: MatchEngine,
  plan: { first: BagStatus[]; second: BagStatus[] },
): void {
  for (let i = 0; i < 8; i++) {
    const next = engine.next()!;
    const isFirst = i % 2 === 0;
    const status = (isFirst ? plan.first : plan.second)[Math.floor(i / 2)]!;
    engine.recordThrow(next.seat, {
      bagId: next.bagId,
      status,
      ...(status === 'ground' ? { foul: 'missed_board' as const } : {}),
      updates: {},
    });
  }
}

/** Shorthand: scoring plan for one team = list of bag statuses, others all `ground`. */
export function bags(...statuses: BagStatus[]): BagStatus[] {
  const out = [...statuses];
  while (out.length < 4) out.push('ground');
  return out;
}

export function startEngine(over: Partial<MatchConfig> = {}, first: TeamId = 'A'): MatchEngine {
  return new MatchEngine(cfg(over), first);
}
