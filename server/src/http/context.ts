import type { FastifyRequest } from 'fastify';
import type { Account } from '../accounts/service.js';
import { DomainError } from '../core/errors.js';
import type { Services } from '../services.js';

const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

export function bearerToken(header: string | undefined): string | null {
  const match = header ? BEARER.exec(header) : null;
  return match ? match[1]! : null;
}

const cache = new WeakMap<FastifyRequest, Account>();

export interface Auth {
  /** The signed-in account, or a 401 (or 403 if banned). */
  require(req: FastifyRequest): Promise<Account>;
  /** The signed-in account if the request has valid credentials, otherwise undefined. A ban still throws. */
  optional(req: FastifyRequest): Promise<Account | undefined>;
  token(req: FastifyRequest): string | null;
}

export function makeAuth(services: Services): Auth {
  const token = (req: FastifyRequest): string | null => bearerToken(req.headers.authorization);
  return {
    token,
    async require(req) {
      const cached = cache.get(req);
      if (cached) return cached;
      const t = token(req);
      if (!t) throw new DomainError('unauthorized', 'Missing or invalid credentials', 401);
      const account = await services.sessions.verify(t);
      cache.set(req, account);
      return account;
    },
    async optional(req) {
      const t = token(req);
      if (!t) return undefined;
      try {
        return await this.require(req);
      } catch (e) {
        if (e instanceof DomainError && e.status === 401) return undefined;
        throw e;
      }
    },
  };
}
