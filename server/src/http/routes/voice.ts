import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DomainError } from '../../core/errors.js';
import type { Services } from '../../services.js';
import type { Auth } from '../context.js';

const tokenBody = z
  .object({
    action: z.enum(['login', 'join', 'join_muted']),
    channelUri: z.string().max(256).optional(),
    fromUserUri: z.string().max(256).optional(),
  })
  .strict();

export function registerVoiceRoutes(app: FastifyInstance, services: Services, auth: Auth): void {
  const load = async (req: Parameters<Auth['require']>[0], id: string) => {
    const account = await auth.require(req);
    if (!services.voice.enabled) throw new DomainError('voice_unavailable', 'Voice chat is not switched on for this server', 501);
    services.accounts.requireEligibleForSocial(account);
    const session = services.registry.get(id);
    if (!session) throw new DomainError('match_not_found', 'No such match', 404);
    return { account, session };
  };

  // Which channels this player may use, who is at the match, and who to mute.
  app.post<{ Params: { id: string } }>('/api/matches/:id/voice', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { account, session } = await load(req, req.params.id);
    return services.voice.grant(session, account);
  });

  // The Vivox SDK calls this (through the app) whenever it needs a token, for the identity it chose.
  // Tokens last five minutes.
  app.post<{ Params: { id: string } }>('/api/matches/:id/voice/token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const { account, session } = await load(req, req.params.id);
    const body = tokenBody.parse(req.body);
    return services.voice.token(session, account, body);
  });
}
