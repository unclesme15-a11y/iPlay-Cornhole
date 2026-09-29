import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { JwksKeySource, verifyRs256Jwt } from '../src/accounts/jwt.js';
import { IdentityProviders } from '../src/accounts/providers.js';
import { StaticKeys, makeKey, signJwt } from './helpers/jwt.js';

const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1000;
const key = makeKey('k1');
const other = makeKey('k1'); // same key id, different key: a forger

const goodApple = (over: Record<string, unknown> = {}) => ({
  iss: 'https://appleid.apple.com',
  aud: 'com.iplay.cornhole',
  sub: 'apple-user-1',
  iat: NOW - 10,
  exp: NOW + 600,
  ...over,
});

const providers = (over: Partial<ConstructorParameters<typeof IdentityProviders>[0]> = {}) =>
  new IdentityProviders({
    appleClientIds: ['com.iplay.cornhole'],
    googleClientIds: ['google-client-1.apps.googleusercontent.com'],
    allowMissingNonce: false,
    now: () => NOW_MS,
    appleKeys: new StaticKeys([key]),
    googleKeys: new StaticKeys([key]),
    ...over,
  });

describe('verifyRs256Jwt', () => {
  const opts = { keys: new StaticKeys([key]), issuers: ['https://appleid.apple.com'], audiences: ['com.iplay.cornhole'], now: NOW };

  it('accepts a good token and returns its claims', async () => {
    const claims = await verifyRs256Jwt(signJwt(key, goodApple()), opts);
    expect(claims.sub).toBe('apple-user-1');
  });

  it('accepts an audience list that includes ours', async () => {
    await expect(verifyRs256Jwt(signJwt(key, goodApple({ aud: ['other', 'com.iplay.cornhole'] })), opts)).resolves.toBeTruthy();
  });

  it.each([
    ['a forged signature', () => signJwt(other, goodApple())],
    ['the wrong issuer', () => signJwt(key, goodApple({ iss: 'https://evil.example' }))],
    ['a different app', () => signJwt(key, goodApple({ aud: 'com.someone.else' }))],
    ['an expired token', () => signJwt(key, goodApple({ exp: NOW - 3600 }))],
    ['a token from the future', () => signJwt(key, goodApple({ iat: NOW + 3600 }))],
    ['a token not valid yet', () => signJwt(key, goodApple({ nbf: NOW + 3600 }))],
    ['no subject', () => signJwt(key, goodApple({ sub: '' }))],
    ['an unknown key id', () => signJwt(key, goodApple(), { kid: 'nope' })],
    ['no key id', () => signJwt(key, goodApple(), { kid: undefined })],
    ['the "none" algorithm', () => `${Buffer.from('{"alg":"none","kid":"k1"}').toString('base64url')}.${Buffer.from(JSON.stringify(goodApple())).toString('base64url')}.x`],
    ['an HMAC algorithm', () => signJwt(key, goodApple(), { alg: 'HS256' })],
    ['garbage', () => 'not.a.jwt'],
    ['too few parts', () => 'abc.def'],
    ['empty parts', () => '..'],
    ['a giant token', () => 'a'.repeat(9000)],
  ])('rejects %s', async (_name, make) => {
    await expect(verifyRs256Jwt(make(), opts)).rejects.toMatchObject({ code: 'invalid_identity_token', status: 401 });
  });

  it('allows a little clock drift but not a lot', async () => {
    await expect(verifyRs256Jwt(signJwt(key, goodApple({ exp: NOW - 30 })), opts)).resolves.toBeTruthy();
    await expect(verifyRs256Jwt(signJwt(key, goodApple({ exp: NOW - 120 })), opts)).rejects.toThrow(/expired/);
  });

  it('rejects a token whose payload was changed after signing', async () => {
    const [h, , s] = signJwt(key, goodApple()).split('.');
    const tampered = `${h}.${Buffer.from(JSON.stringify(goodApple({ sub: 'someone-else' }))).toString('base64url')}.${s}`;
    await expect(verifyRs256Jwt(tampered, opts)).rejects.toThrow(/bad signature/);
  });
});

describe('IdentityProviders', () => {
  const nonce = 'raw-nonce-123';
  const hashed = createHash('sha256').update(nonce).digest('hex');

  it('Apple: returns the provider subject', async () => {
    const id = await providers().verify('apple', signJwt(key, goodApple({ nonce: hashed })), nonce);
    expect(id).toEqual({ provider: 'apple', subject: 'apple-user-1' });
  });

  it('accepts the nonce either raw or hashed', async () => {
    await expect(providers().verify('apple', signJwt(key, goodApple({ nonce })), nonce)).resolves.toBeTruthy();
    await expect(providers().verify('apple', signJwt(key, goodApple({ nonce: hashed })), nonce)).resolves.toBeTruthy();
  });

  it('rejects a replayed token with the wrong nonce, and a token with no nonce at all', async () => {
    await expect(providers().verify('apple', signJwt(key, goodApple({ nonce: hashed })), 'different')).rejects.toMatchObject({ code: 'invalid_identity_token' });
    await expect(providers().verify('apple', signJwt(key, goodApple()), nonce)).rejects.toMatchObject({ code: 'invalid_identity_token' });
  });

  it('requires a nonce unless the server is told it may skip it', async () => {
    await expect(providers().verify('apple', signJwt(key, goodApple()), undefined)).rejects.toMatchObject({ code: 'nonce_required', status: 400 });
    await expect(providers({ allowMissingNonce: true }).verify('apple', signJwt(key, goodApple()), undefined)).resolves.toBeTruthy();
  });

  it('Google: checks the Google issuer and client id', async () => {
    const claims = { iss: 'https://accounts.google.com', aud: 'google-client-1.apps.googleusercontent.com', sub: 'g-99', exp: NOW + 600, iat: NOW, nonce };
    expect(await providers().verify('google', signJwt(key, claims), nonce)).toEqual({ provider: 'google', subject: 'g-99' });
    await expect(providers().verify('google', signJwt(key, { ...claims, iss: 'https://appleid.apple.com' }), nonce)).rejects.toThrow();
    // an Apple token must not work as a Google one
    await expect(providers().verify('google', signJwt(key, goodApple({ nonce })), nonce)).rejects.toThrow();
  });

  it('reports a provider that is not set up with a 501, not a crash', async () => {
    const none = providers({ appleClientIds: [] });
    expect(none.isConfigured('apple')).toBe(false);
    await expect(none.verify('apple', 'x.y.z', nonce)).rejects.toMatchObject({ code: 'provider_not_configured', status: 501 });
  });
});

describe('JwksKeySource', () => {
  const body = (...keys: ReturnType<typeof makeKey>[]) => ({ keys: keys.map((k) => k.jwk) });

  it('fetches keys once and reuses them', async () => {
    let calls = 0;
    const src = new JwksKeySource('u', { fetchJson: async () => (calls++, body(key)), now: () => NOW_MS });
    expect(await src.getKey('k1')).toBeTruthy();
    expect(await src.getKey('k1')).toBeTruthy();
    expect(calls).toBe(1);
  });

  it('refetches when the provider rotates keys, but not more than once per gap', async () => {
    const k2 = makeKey('k2');
    let now = NOW_MS;
    let served = [key];
    let calls = 0;
    const src = new JwksKeySource('u', { fetchJson: async () => (calls++, body(...served)), now: () => now, refetchGapMs: 300_000 });
    await src.getKey('k1');
    served = [k2];
    expect(await src.getKey('k2')).toBeNull(); // too soon to refetch
    expect(calls).toBe(1);
    now += 301_000;
    expect(await src.getKey('k2')).toBeTruthy();
    expect(calls).toBe(2);
    expect(await src.getKey('never-seen')).toBeNull();
    expect(calls).toBe(2); // did not hammer the provider
  });

  it('keeps using the keys it has if the provider is down', async () => {
    let now = NOW_MS;
    let fail = false;
    const src = new JwksKeySource('u', {
      fetchJson: async () => {
        if (fail) throw new Error('down');
        return body(key);
      },
      now: () => now,
      ttlMs: 1000,
      refetchGapMs: 0,
    });
    await src.getKey('k1');
    fail = true;
    now += 10_000;
    expect(await src.getKey('k1')).toBeTruthy();
  });

  it('ignores keys that are not RSA signing keys, and returns null when nothing has loaded', async () => {
    const src = new JwksKeySource('u', { fetchJson: async () => ({ keys: [{ kty: 'EC', kid: 'e', use: 'sig' }, { ...key.jwk, use: 'enc', kid: 'x' }] }) });
    expect(await src.getKey('e')).toBeNull();
    expect(await src.getKey('x')).toBeNull();
    const broken = new JwksKeySource('u', { fetchJson: async () => { throw new Error('down'); } });
    expect(await broken.getKey('k1')).toBeNull();
  });

  it('shares one download between simultaneous requests', async () => {
    let calls = 0;
    const src = new JwksKeySource('u', { fetchJson: async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return body(key); } });
    await Promise.all([src.getKey('k1'), src.getKey('k1'), src.getKey('k1')]);
    expect(calls).toBe(1);
  });
});
