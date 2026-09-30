import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../../services.js';

const clientErrorsBody = z
  .object({
    errors: z
      .array(
        z
          .object({
            message: z.string().min(1).max(500),
            stack: z.string().max(4000).optional(),
            count: z.number().int().min(1).max(100_000).default(1),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

const header = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v)?.slice(0, 20) ?? 'unknown';

/**
 * The app sends its own errors here (C# exceptions that did not crash it but probably broke a screen), so problems on
 * real phones show up in the server log and the alert webhook. No sign-in needed and nothing personal is kept: only the
 * error text, where in the code it happened, how often, and the app version and platform.
 */
export function registerClientErrorRoutes(app: FastifyInstance, services: Services): void {
  app.post('/api/client-errors', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = clientErrorsBody.parse(req.body);
    const version = header(req.headers['x-client-version']);
    const platform = header(req.headers['x-client-platform']);
    for (const e of body.errors) {
      req.log.warn({ clientError: true, version, platform, message: e.message, stack: e.stack?.slice(0, 2000), count: e.count }, 'app error');
    }
    services.alerts.send('client-error', `App error on ${platform} ${version}: ${body.errors[0]!.message.slice(0, 200)}`);
    return reply.status(202).send({ received: body.errors.length });
  });
}
