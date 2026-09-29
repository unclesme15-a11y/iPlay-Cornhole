import { describe, expect, it } from 'vitest';
import { checkDisplayName, defaultGuestName } from '../src/accounts/nameFilter.js';

const ok = (s: string) => {
  const r = checkDisplayName(s);
  expect(r.ok, `${JSON.stringify(s)} should be allowed`).toBe(true);
  return r.ok ? r.name : '';
};
const bad = (s: unknown, code: string) => {
  const r = checkDisplayName(s);
  expect(r.ok, `${JSON.stringify(s)} should be refused`).toBe(false);
  if (!r.ok) expect(r.code).toBe(code);
};

describe('display names that are fine', () => {
  it.each(['Uncle Me', 'José', 'Big_Mike', "O'Brien", 'Keisha 34', 'Dre', 'Marisol', 'Zoë', 'Ünal', '山田太郎', 'Travis T.', 'Mary-Jane'])('%s', (name) => {
    ok(name);
  });

  it('does not block innocent words that contain rude ones (the Scunthorpe problem)', () => {
    for (const name of ['Scunthorpe', 'Assassin', 'Cocktail', 'Grasshopper', 'Classic', 'Passion', 'Analyst', 'Hancock Fan', 'Bassist']) ok(name);
  });

  it('cleans whitespace and full-width letters', () => {
    expect(ok('  Big   Mike  ')).toBe('Big Mike');
    expect(ok('ＫＥＩＳＨＡ')).toBe('KEISHA');
  });
});

describe('length and characters', () => {
  it('needs 3 to 20 characters', () => {
    bad('ab', 'name_length');
    bad('', 'name_length');
    bad('   ', 'name_length');
    bad('x'.repeat(21), 'name_length');
    ok('abc');
    ok('x'.repeat(20));
  });
  it('counts characters, not bytes', () => {
    ok('山'.repeat(3));
    bad('山'.repeat(21), 'name_length');
  });
  it('refuses anything that is not a string', () => {
    bad(undefined, 'name_length');
    bad(null, 'name_length');
    bad(42, 'name_length');
    bad({ toString: () => 'Uncle' }, 'name_length');
  });
  it('refuses invisible, direction-changing, emoji and symbol characters', () => {
    bad('Bob​by', 'name_chars'); // zero-width space
    bad('‮evil name', 'name_chars'); // right-to-left override
    bad('Bob\u0000by', 'name_chars');
    bad('💩💩💩', 'name_chars');
    bad('!!!', 'name_chars');
    bad('<b>Bob</b>', 'name_chars');
    bad('a;drop table', 'name_chars');
    bad('_Bobby', 'name_chars'); // must start with a letter or number
    bad('123', 'name_chars'); // needs some letters
  });
});

describe('profanity, including the usual disguises', () => {
  it.each(['shit', 'sh1t', 'SH1T', 'fuck', 'fuuuck', 'f.u.c.k', 'f u c k', 'f_u_c_k', 'ｆｕｃｋ', 'a$$hole', 'bitch', 'fvck you'])('refuses %s', (name) => {
    const r = checkDisplayName(name);
    expect(r.ok, name).toBe(false);
  });
  it('uses the profane code for real profanity', () => {
    bad('shithead', 'name_profane');
    bad('f.u.c.k', 'name_profane');
  });
});

describe('impersonation', () => {
  it.each(['admin', 'Admin', 'xX admin Xx', 'iPlay', 'iPlay Support', 'iPIay', 'i Play Fan', '1Play', 'IPLAY_OFFICIAL', 'Moderator Mike', 'Support Team', 'Staff'])('refuses %s', (name) => {
    bad(name, 'name_reserved');
  });
  it('still allows ordinary names that share a letter or two', () => {
    for (const name of ['Playa Pete', 'Ipswich', 'Pilar', 'Admiral Ray']) ok(name);
  });
});

describe('default guest name', () => {
  it('looks like Player and four digits, and always passes the filter', () => {
    for (let i = 0; i < 200; i++) {
      const name = defaultGuestName();
      expect(name).toMatch(/^Player\d{4}$/);
      expect(checkDisplayName(name).ok).toBe(true);
    }
  });
});
