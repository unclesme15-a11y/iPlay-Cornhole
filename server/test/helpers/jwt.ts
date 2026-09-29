import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { Jwk, KeySource } from '../../src/accounts/jwt.js';

export interface TestKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  jwk: Jwk;
}

export function makeKey(kid: string): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Jwk), kid, use: 'sig', alg: 'RS256' };
  return { kid, privateKey, publicKey, jwk };
}

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

export function signJwt(key: TestKey, claims: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header });
  const body = b64(claims);
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key.privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

export class StaticKeys implements KeySource {
  constructor(private readonly keys: TestKey[]) {}
  async getKey(kid: string): Promise<KeyObject | null> {
    return this.keys.find((k) => k.kid === kid)?.publicKey ?? null;
  }
}
