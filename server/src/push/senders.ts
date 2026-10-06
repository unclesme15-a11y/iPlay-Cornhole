import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http2 from 'node:http2';

/**
 * The two ways to reach a phone:
 *   - Apple Push Notification service (APNs) for iPhones: HTTP/2, signed with a .p8 key from the Apple Developer account.
 *   - Firebase Cloud Messaging (FCM, HTTP v1) for Android: a Google service account exchanges a signed token for a
 *     short-lived access token, then posts each message.
 * Both are written against the providers' public HTTP APIs with Node's own libraries (no SDKs).
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Extra values the app receives with the notification (for example the match id to open). */
  data?: Record<string, string>;
  /** Newer messages with the same id replace older ones on the phone (so a phone never shows two "your match" alerts). */
  collapseId?: string;
  /** Drop the message if the phone cannot be reached within this many seconds. */
  ttlSec?: number;
}

/** What happened to one send. `gone` means the token is dead (app deleted, permission revoked): forget it. */
export type SendOutcome = 'sent' | 'gone' | 'failed';

export interface PushSender {
  send(token: string, msg: PushMessage): Promise<SendOutcome>;
  close(): void;
}

const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url');

function signJwt(header: object, claims: object, key: KeyObject, alg: 'ES256' | 'RS256'): string {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = alg === 'ES256' ? sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }) : sign('sha256', Buffer.from(input), key);
  return `${input}.${b64url(sig)}`;
}

/** Keys in env files often have their line breaks written as \n. */
const pem = (s: string): string => s.replace(/\\n/g, '\n').trim();

// ------------------------------------------------------------------------------------------- Apple

export interface ApnsSettings {
  keyId: string;
  teamId: string;
  /** The .p8 key's contents (PEM). */
  privateKey: string;
  /** The app's bundle id (the "topic"). */
  bundleId: string;
  sandbox: boolean;
  /** Override the host (tests). */
  host?: string;
}

export class ApnsSender implements PushSender {
  private readonly key: KeyObject;
  private jwt: { token: string; at: number } | null = null;
  private session: http2.ClientHttp2Session | null = null;

  constructor(
    private readonly s: ApnsSettings,
    private readonly now: () => number = Date.now,
  ) {
    this.key = createPrivateKey(pem(s.privateKey));
  }

  private host(): string {
    return this.s.host ?? (this.s.sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');
  }

  /** Apple wants a fresh token at most once every 20 minutes and refuses ones older than an hour: renew every 40. */
  private bearer(): string {
    const t = this.now();
    if (!this.jwt || t - this.jwt.at > 40 * 60_000) {
      this.jwt = { token: signJwt({ alg: 'ES256', kid: this.s.keyId }, { iss: this.s.teamId, iat: Math.floor(t / 1000) }, this.key, 'ES256'), at: t };
    }
    return this.jwt.token;
  }

  private connection(): http2.ClientHttp2Session {
    if (!this.session || this.session.closed || this.session.destroyed) {
      this.session = http2.connect(this.host());
      this.session.on('error', () => {
        this.session = null;
      });
      this.session.on('goaway', () => {
        this.session = null;
      });
      this.session.unref();
    }
    return this.session;
  }

  send(token: string, msg: PushMessage): Promise<SendOutcome> {
    const body = JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' }, ...(msg.data ?? {}) });
    const headers: http2.OutgoingHttpHeaders = {
      ':method': 'POST',
      ':path': `/3/device/${encodeURIComponent(token)}`,
      authorization: `bearer ${this.bearer()}`,
      'apns-topic': this.s.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(this.now() / 1000) + (msg.ttlSec ?? 3600)),
      'content-type': 'application/json',
    };
    if (msg.collapseId) headers['apns-collapse-id'] = msg.collapseId.slice(0, 64);
    return new Promise((resolve) => {
      let req: http2.ClientHttp2Stream;
      try {
        req = this.connection().request(headers);
      } catch {
        resolve('failed');
        return;
      }
      let status = 0;
      let data = '';
      req.setTimeout(10_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
      req.on('response', (h) => {
        status = Number(h[':status']);
      });
      req.setEncoding('utf8');
      req.on('data', (c: string) => (data += c));
      req.on('error', () => resolve('failed'));
      req.on('close', () => {
        if (status === 200) return resolve('sent');
        let reason = '';
        try {
          reason = (JSON.parse(data) as { reason?: string }).reason ?? '';
        } catch {
          /* no body */
        }
        // 410: the app is gone from that phone. 400 BadDeviceToken / DeviceTokenNotForTopic: never valid here.
        if (status === 410 || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic' || reason === 'Unregistered') return resolve('gone');
        resolve('failed');
      });
      req.end(body);
    });
  }

  close(): void {
    this.session?.close();
    this.session = null;
  }
}

// ------------------------------------------------------------------------------------------- Google

export interface FcmSettings {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  /** Override the endpoints (tests). */
  sendUrl?: string;
  tokenUrl?: string;
}

/** Reads FCM_SERVICE_ACCOUNT: either the service-account JSON itself, or a path to the JSON file. */
export function readServiceAccount(value: string): FcmSettings {
  const text = value.trim().startsWith('{') ? value : readFileSync(value, 'utf8');
  const j = JSON.parse(text) as { project_id?: string; client_email?: string; private_key?: string };
  if (!j.project_id || !j.client_email || !j.private_key) throw new Error('FCM_SERVICE_ACCOUNT is missing project_id, client_email or private_key');
  return { projectId: j.project_id, clientEmail: j.client_email, privateKey: j.private_key };
}

export class FcmSender implements PushSender {
  private readonly key: KeyObject;
  private access: { token: string; until: number } | null = null;

  constructor(
    private readonly s: FcmSettings,
    private readonly now: () => number = Date.now,
  ) {
    this.key = createPrivateKey(pem(s.privateKey));
  }

  private async accessToken(): Promise<string> {
    const t = this.now();
    if (this.access && t < this.access.until) return this.access.token;
    const tokenUrl = this.s.tokenUrl ?? 'https://oauth2.googleapis.com/token';
    const iat = Math.floor(t / 1000);
    const assertion = signJwt(
      { alg: 'RS256', typ: 'JWT' },
      { iss: this.s.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUrl, iat, exp: iat + 3600 },
      this.key,
      'RS256',
    );
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`FCM sign-in failed (${res.status})`);
    const j = (await res.json()) as { access_token: string; expires_in?: number };
    this.access = { token: j.access_token, until: t + Math.max(60, (j.expires_in ?? 3600) - 300) * 1000 };
    return j.access_token;
  }

  async send(token: string, msg: PushMessage): Promise<SendOutcome> {
    try {
      const url = this.s.sendUrl ?? `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.s.projectId)}/messages:send`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: msg.title, body: msg.body },
            data: msg.data ?? {},
            android: { priority: 'high', ttl: `${msg.ttlSec ?? 3600}s`, ...(msg.collapseId ? { collapse_key: msg.collapseId } : {}) },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return 'sent';
      const j = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> } };
      const code = j.error?.details?.find((d) => d.errorCode)?.errorCode ?? j.error?.status ?? '';
      // UNREGISTERED / 404: the app is gone from that phone. INVALID_ARGUMENT is only about the token when Google says so
      // (it is also used for a bad message, and a good token must not be thrown away for that).
      const aboutToken = /registration token/i.test(j.error?.message ?? '');
      if (res.status === 404 || code === 'UNREGISTERED' || (code === 'INVALID_ARGUMENT' && aboutToken)) return 'gone';
      return 'failed';
    } catch {
      return 'failed';
    }
  }

  close(): void {
    /* nothing to close */
  }
}
