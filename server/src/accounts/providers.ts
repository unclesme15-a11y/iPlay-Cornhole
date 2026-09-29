import { createHash, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../core/errors.js';
import { JwksKeySource, verifyRs256Jwt, type KeySource } from './jwt.js';

export type Provider = 'apple' | 'google';

export interface VerifiedIdentity {
  provider: Provider;
  /** The provider's stable id for this person. Never changes, unlike names and emails. */
  subject: string;
}

export interface ProviderSettings {
  appleClientIds: readonly string[];
  googleClientIds: readonly string[];
  /** Accept sign-ins that carry no nonce. Off by default: a nonce stops a stolen token being replayed. */
  allowMissingNonce: boolean;
  now: () => number;
  appleKeys?: KeySource;
  googleKeys?: KeySource;
}

const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex');

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Turns an Apple or Google identity token into "this is provider X's person Y".
 * We keep only the provider's id for the person. No email is ever read or stored.
 */
export class IdentityProviders {
  private readonly apple: KeySource;
  private readonly google: KeySource;

  constructor(private readonly s: ProviderSettings) {
    this.apple = s.appleKeys ?? new JwksKeySource('https://appleid.apple.com/auth/keys');
    this.google = s.googleKeys ?? new JwksKeySource('https://www.googleapis.com/oauth2/v3/certs');
  }

  isConfigured(provider: Provider): boolean {
    return (provider === 'apple' ? this.s.appleClientIds : this.s.googleClientIds).length > 0;
  }

  async verify(provider: Provider, token: string, nonce: string | undefined): Promise<VerifiedIdentity> {
    if (!this.isConfigured(provider)) {
      throw new DomainError('provider_not_configured', `Sign in with ${provider === 'apple' ? 'Apple' : 'Google'} is not set up on this server`, 501);
    }
    if (!nonce && !this.s.allowMissingNonce) {
      throw new DomainError('nonce_required', 'Send the nonce you gave the sign-in provider', 400);
    }
    const claims = await verifyRs256Jwt(token, {
      keys: provider === 'apple' ? this.apple : this.google,
      issuers: provider === 'apple' ? ['https://appleid.apple.com'] : ['https://accounts.google.com', 'accounts.google.com'],
      audiences: provider === 'apple' ? this.s.appleClientIds : this.s.googleClientIds,
      now: Math.floor(this.s.now() / 1000),
    });
    if (nonce) {
      // Providers embed either the nonce itself or its SHA-256, depending on the client library.
      const embedded = typeof claims.nonce === 'string' ? claims.nonce : '';
      if (!embedded || !(safeEqual(embedded, nonce) || safeEqual(embedded.toLowerCase(), sha256hex(nonce)))) {
        throw new DomainError('invalid_identity_token', 'Sign-in token rejected: nonce does not match', 401);
      }
    }
    return { provider, subject: claims.sub };
  }
}
