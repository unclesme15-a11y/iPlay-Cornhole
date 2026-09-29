import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isBanned, publicAccount, type Account } from '../../accounts/service.js';
import { DomainError } from '../../core/errors.js';
import type { Services } from '../../services.js';
import type { Auth } from '../context.js';
import { CLIENT_PLATFORM_HEADER, CLIENT_VERSION_HEADER, parseClientVersion } from '../version.js';

const name = z.string().min(1).max(100);
const guestBody = z.object({ displayName: name.optional() }).strict();
const appleBody = z.object({ identityToken: z.string().min(20).max(8192), nonce: z.string().min(8).max(256).optional(), displayName: name.optional() }).strict();
const googleBody = z.object({ idToken: z.string().min(20).max(8192), nonce: z.string().min(8).max(256).optional(), displayName: name.optional() }).strict();

const header = (req: FastifyRequest, key: string): string | undefined => {
  const v = req.headers[key];
  return Array.isArray(v) ? v[0] : v;
};

export function registerAuthRoutes(app: FastifyInstance, services: Services, auth: Auth): void {
  const startSession = async (req: FastifyRequest, account: Account) => {
    if (isBanned(account, services.scheduler.now())) {
      throw new DomainError('account_banned', 'This account is banned', 403, {
        reason: account.banReason,
        bannedUntil: account.bannedUntil ? account.bannedUntil.toISOString() : null,
      });
    }
    return services.sessions.issue(account.id, {
      platform: header(req, CLIENT_PLATFORM_HEADER),
      clientVersion: parseClientVersion(header(req, CLIENT_VERSION_HEADER)) ?? undefined,
    });
  };

  // Guests can play straight away with no sign-in. They can attach Apple or Google later and keep everything.
  app.post('/api/auth/guest', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!services.config.ALLOW_GUESTS) throw new DomainError('guests_disabled', 'Please sign in with Apple or Google', 403);
    const body = guestBody.parse(req.body ?? {});
    const account = await services.accounts.createGuest(body.displayName);
    const session = await startSession(req, account);
    return reply.status(201).send({
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      account: publicAccount(account),
      created: true,
      linked: false,
      switched: false,
    });
  });

  const signInRoute = (path: string, provider: 'apple' | 'google') => {
    app.post(path, { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const raw = req.body ?? {};
      const parsed = provider === 'apple' ? appleBody.parse(raw) : googleBody.parse(raw);
      const token = 'identityToken' in parsed ? parsed.identityToken : parsed.idToken;
      const identity = await services.providers.verify(provider, token, parsed.nonce);
      // If the app is already signed in as a guest, attach this identity to that guest.
      const current = await auth.optional(req);
      const result = await services.accounts.signInWithIdentity(identity, {
        ...(current ? { linkTo: current.id } : {}),
        ...(parsed.displayName !== undefined ? { displayName: parsed.displayName } : {}),
      });
      services.sessions.forget(result.account.id);
      const session = await startSession(req, result.account);
      return reply.status(result.created ? 201 : 200).send({
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        account: publicAccount(result.account),
        created: result.created,
        linked: result.linked,
        switched: result.switched,
      });
    });
  };
  signInRoute('/api/auth/apple', 'apple');
  signInRoute('/api/auth/google', 'google');

  app.post('/api/auth/logout', async (req) => {
    await auth.require(req);
    const token = auth.token(req);
    if (token) await services.sessions.revoke(token);
    return { loggedOut: true };
  });
}
