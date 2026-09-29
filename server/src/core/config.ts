import { z } from 'zod';
import { TARGET_SCORES } from './constants.js';
import { DEFAULT_CONFIG, type MatchConfig } from './types.js';

/** Validates a partial config from a client and fills in defaults. */
export const matchConfigSchema = z
  .object({
    mode: z.enum(['1v1', '2v2']),
    playTo: z.union([z.literal(11), z.literal(15), z.literal(21)]),
    bust: z.boolean(),
    skunk: z.boolean(),
    distance: z.enum(['regulation', 'backyard']),
    throwTimerSec: z.union([z.literal(20), z.null()]),
    boardCam: z.boolean(),
    tutorial: z.boolean(),
    wind: z.enum(['off', 'light', 'breezy', 'gusty']),
  })
  .strict()
  .partial();

export function resolveConfig(input: unknown): MatchConfig {
  const parsed = matchConfigSchema.parse(input ?? {});
  const merged: MatchConfig = { ...DEFAULT_CONFIG, ...stripUndefined(parsed) };
  if (!(TARGET_SCORES as readonly number[]).includes(merged.playTo)) {
    throw new Error(`playTo must be one of ${TARGET_SCORES.join(', ')}`);
  }
  return merged;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
