import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../core/errors.js';
import type { Services } from '../../services.js';
import type { Auth } from '../context.js';

export function registerVoiceRoutes(app: FastifyInstance, services: Services, auth: Auth): void {
  // Tokens for one player and one match, good for five minutes. Ask again when they run out.
  app.post<{ Params: { id: string } }>('/api/matches/:id/voice', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const account = await auth.require(req);
    if (!services.voice.enabled) throw new DomainError('voice_unavailable', 'Voice chat is not switched on for this server', 501);
    services.accounts.requireEligibleForSocial(account);
    const session = services.registry.get(req.params.id);
    if (!session) throw new DomainError('match_not_found', 'No such match', 404);
    return services.voice.grant(session, account);
  });
}
