import { createHmac, randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';

export type VivoxAction = 'login' | 'join' | 'join_muted';

export interface SignedVivoxToken {
  channelName: string | null;
  channelUri: string | null;
  token: string;
  /** When the token stops working (epoch ms). */
  expiresAt: number;
}

const TOKEN_LIFETIME_S = 300;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const MAX_URI = 256;

const b64url = (input: string | Buffer): string => Buffer.from(input).toString('base64url');

/**
 * Makes the short-lived tokens the phone needs to log in to Unity Vivox and join a voice channel.
 * The signing key never leaves the server: the phone only ever holds a 5-minute token for one Vivox
 * identity and one channel. (Same scheme as iPlay Street Dice.)
 *
 * The Vivox Unity SDK picks the player's Vivox identity itself (from their Unity player id) and asks
 * us to sign for it, so the identity is passed in rather than derived from the account.
 */
export class VivoxSigner {
  private readonly domain: string;

  constructor(
    private readonly issuer: string,
    domain: string,
    private readonly key: string,
    private readonly environmentId: string,
  ) {
    this.domain = domain.replace(/^@+/, '');
  }

  /** Null unless every Vivox setting is present. */
  static fromConfig(config: Pick<AppConfig, 'VIVOX_ISSUER' | 'VIVOX_DOMAIN' | 'VIVOX_SIGNING_KEY' | 'VIVOX_UNITY_ENVIRONMENT_ID'>): VivoxSigner | null {
    const { VIVOX_ISSUER: i, VIVOX_DOMAIN: d, VIVOX_SIGNING_KEY: k, VIVOX_UNITY_ENVIRONMENT_ID: e } = config;
    return i && d && k && e ? new VivoxSigner(i, d, k, e) : null;
  }

  static isSafeSegment(value: string): boolean {
    return value.length > 0 && value.length <= 64 && SAFE_SEGMENT.test(value);
  }

  /** A Vivox address for a given id, in this project's environment. Used when the phone does not name its own. */
  userUri(id: string): string {
    this.assertSafe(id, 'participant');
    return `sip:.${this.issuer}.${id}.${this.environmentId}.@${this.domain}`;
  }

  /** True if this is a Vivox user address in our project and environment (so we never sign for someone else's project). */
  isOurUserUri(uri: string): boolean {
    const lower = uri.toLowerCase();
    return (
      uri.length <= MAX_URI &&
      lower.startsWith(`sip:.${this.issuer}.`.toLowerCase()) &&
      lower.endsWith(`.${this.environmentId}.@${this.domain}`.toLowerCase())
    );
  }

  channelUri(channelName: string): string {
    this.assertSafe(channelName, 'channel');
    return `sip:confctl-g-${this.issuer}.${channelName}.${this.environmentId}@${this.domain}`;
  }

  private assertSafe(value: string, what: string): void {
    if (!VivoxSigner.isSafeSegment(value)) throw new Error(`Invalid voice ${what}`);
  }

  /**
   * `login` has no channel; `join` and `join_muted` are for one named channel.
   * `fromUserUri` is the Vivox identity the phone is using.
   */
  sign(action: VivoxAction, fromUserUri: string, channelName: string | null, nowMs: number): SignedVivoxToken {
    if (action !== 'login' && action !== 'join' && action !== 'join_muted') throw new Error('Unsupported voice action');
    if (action !== 'login' && !channelName) throw new Error('A channel is required to join');
    if (!this.isOurUserUri(fromUserUri)) throw new Error('That voice identity does not belong to this Vivox environment');
    const expiresAt = nowMs + TOKEN_LIFETIME_S * 1000;
    const channelUri = action === 'login' ? null : this.channelUri(channelName!);
    const payload: Record<string, string | number> = {
      iss: this.issuer,
      exp: Math.floor(expiresAt / 1000),
      vxa: action,
      vxi: randomUUID().replaceAll('-', ''),
      f: fromUserUri,
    };
    if (channelUri) payload.t = channelUri;
    const unsigned = `${b64url('{}')}.${b64url(JSON.stringify(payload))}`;
    const signature = createHmac('sha256', this.key).update(unsigned).digest('base64url');
    return { channelName: action === 'login' ? null : channelName, channelUri, token: `${unsigned}.${signature}`, expiresAt };
  }
}
