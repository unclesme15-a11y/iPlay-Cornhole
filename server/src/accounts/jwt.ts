import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { DomainError } from '../core/errors.js';

export interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

/** Something that can hand back the public key a token was signed with. */
export interface KeySource {
  getKey(kid: string): Promise<KeyObject | null>;
}

export interface JwtClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
  [claim: string]: unknown;
}

export interface VerifyOptions {
  keys: KeySource;
  issuers: readonly string[];
  audiences: readonly string[];
  /** Current time in seconds. */
  now: number;
  clockSkewSec?: number;
}

const b64urlToBuffer = (s: string): Buffer => Buffer.from(s, 'base64url');

const invalid = (why: string): DomainError => new DomainError('invalid_identity_token', `Sign-in token rejected: ${why}`, 401);

/**
 * Verifies an RS256 JSON Web Token (what Apple and Google send as an "identity token").
 * Checks the signature against the provider's published key, then who issued it, who it is for,
 * and that it has not expired. Anything unexpected is rejected: only RS256 is accepted, so a token
 * cannot trick us into a weaker algorithm ("alg":"none" or an HMAC using the public key).
 */
export async function verifyRs256Jwt(token: string, opts: VerifyOptions): Promise<JwtClaims> {
  if (typeof token !== 'string' || token.length > 8192) throw invalid('malformed');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) throw invalid('malformed');
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  let header: { alg?: unknown; kid?: unknown; typ?: unknown };
  let claims: Partial<JwtClaims>;
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString('utf8'));
    claims = JSON.parse(b64urlToBuffer(payloadB64).toString('utf8'));
  } catch {
    throw invalid('malformed');
  }
  if (header.alg !== 'RS256') throw invalid('unsupported algorithm');
  if (typeof header.kid !== 'string' || header.kid.length === 0) throw invalid('missing key id');

  const key = await opts.keys.getKey(header.kid);
  if (!key) throw invalid('unknown signing key');
  const signature = b64urlToBuffer(sigB64);
  const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), key, signature);
  if (!ok) throw invalid('bad signature');

  const skew = opts.clockSkewSec ?? 60;
  if (typeof claims.iss !== 'string' || !opts.issuers.includes(claims.iss)) throw invalid('wrong issuer');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.some((a) => typeof a === 'string' && opts.audiences.includes(a))) throw invalid('not issued for this app');
  if (typeof claims.exp !== 'number' || claims.exp + skew < opts.now) throw invalid('expired');
  if (typeof claims.iat === 'number' && claims.iat - skew > opts.now) throw invalid('issued in the future');
  if (typeof claims.nbf === 'number' && claims.nbf - skew > opts.now) throw invalid('not valid yet');
  if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 255) throw invalid('missing subject');
  return claims as JwtClaims;
}

export interface JwksOptions {
  /** Fetches a URL and returns the parsed JSON. Injectable for tests. */
  fetchJson?: (url: string) => Promise<{ keys?: Jwk[] }>;
  /** Milliseconds a fetched key set is trusted. */
  ttlMs?: number;
  /** Minimum gap between refetches triggered by an unknown key id. */
  refetchGapMs?: number;
  now?: () => number;
}

const defaultFetchJson = async (url: string): Promise<{ keys?: Jwk[] }> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  return (await res.json()) as { keys?: Jwk[] };
};

/**
 * Downloads a provider's public keys (a "JWKS") and caches them. If the provider rotates its keys
 * and we see an unknown key id, we refetch (at most once every few minutes). If a refetch fails we
 * keep using the keys we already have instead of locking everyone out.
 */
export class JwksKeySource implements KeySource {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private lastAttempt = -Infinity;
  private inflight: Promise<void> | null = null;
  private readonly fetchJson;
  private readonly ttl;
  private readonly gap;
  private readonly now;

  constructor(
    private readonly url: string,
    opts: JwksOptions = {},
  ) {
    this.fetchJson = opts.fetchJson ?? defaultFetchJson;
    this.ttl = opts.ttlMs ?? 6 * 60 * 60_000;
    this.gap = opts.refetchGapMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  async getKey(kid: string): Promise<KeyObject | null> {
    const stale = this.now() - this.fetchedAt > this.ttl;
    if (!this.keys.has(kid) || stale) {
      const canTry = this.now() - this.lastAttempt >= this.gap || this.keys.size === 0;
      if (canTry) await this.refresh();
    }
    return this.keys.get(kid) ?? null;
  }

  private refresh(): Promise<void> {
    this.inflight ??= (async () => {
      this.lastAttempt = this.now();
      try {
        const body = await this.fetchJson(this.url);
        const next = new Map<string, KeyObject>();
        for (const jwk of body.keys ?? []) {
          if (jwk.kty === 'RSA' && jwk.kid && jwk.n && jwk.e && (!jwk.use || jwk.use === 'sig')) {
            next.set(jwk.kid, createPublicKey({ key: jwk as unknown as import('node:crypto').JsonWebKey, format: 'jwk' }));
          }
        }
        if (next.size > 0) {
          this.keys = next;
          this.fetchedAt = this.now();
        }
      } catch {
        // keep whatever we had
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}
