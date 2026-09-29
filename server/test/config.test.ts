import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { resolveConfig } from '../src/core/config.js';
import { DEFAULT_CONFIG } from '../src/core/types.js';

describe('match config', () => {
  it('defaults to play to 21, 2v2, regulation, 20 s timer, board cam on', () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toMatchObject({ playTo: 21, mode: '2v2', distance: 'regulation', throwTimerSec: 20, boardCam: true, bust: false, skunk: false, tutorial: false });
  });
  it('merges partial input over the defaults', () => {
    expect(resolveConfig({ playTo: 11 })).toEqual({ ...DEFAULT_CONFIG, playTo: 11 });
  });
  it('rejects unknown keys (so there can be no wager option) and bad values', () => {
    expect(() => resolveConfig({ wager: 5 })).toThrow();
    expect(() => resolveConfig({ playTo: 25 })).toThrow();
    expect(() => resolveConfig({ throwTimerSec: 45 })).toThrow();
    expect(() => resolveConfig({ mode: '3v3' })).toThrow();
  });
});

describe('server config', () => {
  it('has safe defaults', () => {
    expect(loadConfig({})).toMatchObject({ PORT: 3000, HOST: '0.0.0.0', LOG_LEVEL: 'info', TRUST_PROXY: false });
  });
  it('reads and validates the environment', () => {
    expect(loadConfig({ PORT: '8080', TRUST_PROXY: 'true', LOG_LEVEL: 'warn' })).toMatchObject({ PORT: 8080, TRUST_PROXY: true, LOG_LEVEL: 'warn' });
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ LOG_LEVEL: 'shout' })).toThrow(/LOG_LEVEL/);
  });
});

describe('empty values', () => {
  it('count as not set, so a filled-in env file with blank lines still loads', () => {
    const config = loadConfig({ NODE_ENV: 'test', ADMIN_TOKEN: '', VIVOX_ISSUER: '', APPLE_CLIENT_IDS: '', LATEST_CLIENT_VERSION: '', TERMS_VERSION: '' });
    expect(config.ADMIN_TOKEN).toBeUndefined();
    expect(config.VIVOX_ISSUER).toBeUndefined();
    expect(config.TERMS_VERSION).toBe(1);
  });
  it('the deploy example env file loads as-is once the two required secrets are filled in', () => {
    const text = readFileSync(new URL('../../deploy/.env.example', import.meta.url), 'utf8');
    const env: Record<string, string> = { NODE_ENV: 'test' };
    for (const line of text.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m) env[m[1]!] = m[2]!;
    }
    env.ADMIN_TOKEN = 'a'.repeat(40);
    const config = loadConfig(env);
    expect(config.REQUIRE_ADULT_CONFIRMATION).toBe(true);
    expect(config.ADS_ENABLED).toBe(false);
    expect(config.MAX_MATCHES).toBe(2000);
  });
});
