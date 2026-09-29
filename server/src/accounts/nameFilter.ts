import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

export type NameProblem = 'name_length' | 'name_chars' | 'name_reserved' | 'name_profane';

export type NameCheck = { ok: true; name: string } | { ok: false; code: NameProblem; message: string };

export const NAME_MIN = 3;
export const NAME_MAX = 20;

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

/** Letters people swap for look-alikes when impersonating: compare names after folding these together. */
const LOOKALIKE: Record<string, string> = { i: 'l', '1': 'l', '|': 'l', '!': 'l', '0': 'o', '3': 'e', '5': 's', $: 's', '4': 'a', '@': 'a', '7': 't' };

const skeleton = (s: string): string =>
  Array.from(s.toLowerCase())
    .filter((c) => /[\p{L}\p{N}|!$@]/u.test(c))
    .map((c) => LOOKALIKE[c] ?? c)
    .join('');

/** "iplay" after look-alike folding (i and l look the same in many fonts). */
const BRAND = skeleton('iplay');
/** Words that make a name look like it comes from the game's team. */
const STAFF = ['admin', 'moderator', 'official', 'support', 'staff', 'iplayteam'].map(skeleton);

const problem = (code: NameProblem, message: string): NameCheck => ({ ok: false, code, message });

/**
 * Validates and cleans a player-chosen display name. Used for every name a person can type.
 *
 * - 3 to 20 characters; letters (any language), numbers, spaces and . _ ' -
 * - no invisible or direction-changing characters, no emoji
 * - no profanity or slurs, including look-alike spellings (sh1t), stretched letters (fuuuck) and
 *   spaced-out letters (f.u.c.k)
 * - nothing that looks like the game itself or its staff (iPlay, Admin, Support ...)
 */
export function checkDisplayName(raw: unknown): NameCheck {
  if (typeof raw !== 'string') return problem('name_length', 'Name is required');
  const name = raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const length = Array.from(name).length;
  if (length < NAME_MIN || length > NAME_MAX) return problem('name_length', `Names are ${NAME_MIN} to ${NAME_MAX} characters`);
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._'-]*$/u.test(name) || (name.match(/\p{L}/gu)?.length ?? 0) < 2) {
    return problem('name_chars', "Use letters, numbers, spaces and . _ ' - only");
  }

  const folded = skeleton(name);
  if (folded.includes(BRAND) || STAFF.some((word) => folded.includes(word))) {
    return problem('name_reserved', 'That name is reserved');
  }

  const joined = name.replace(/[^\p{L}\p{N}]/gu, '');
  if (matcher.hasMatch(name) || matcher.hasMatch(joined) || matcher.hasMatch(joined.replace(/(.)\1+/gu, '$1'))) {
    return problem('name_profane', "That name isn't allowed");
  }
  return { ok: true, name };
}

/** A friendly default for a brand-new guest: Player4821. */
export function defaultGuestName(random: () => number = Math.random): string {
  return `Player${String(1000 + Math.floor(random() * 9000))}`;
}
