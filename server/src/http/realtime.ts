import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { z } from 'zod';
import { DomainError } from '../core/errors.js';
import type { Services } from '../services.js';
import { TOKEN_PATTERN } from '../accounts/sessions.js';
import { assertClientVersion, parseClientVersion } from './version.js';

const HELLO_DEADLINE_MS = 5_000;
const HEARTBEAT_MS = 25_000;

/** WebSocket close codes the app can act on. */
export const CLOSE = {
  badHello: 4400,
  unauthorized: 4401,
  banned: 4403,
  notFound: 4404,
  helloTimeout: 4408,
  updateRequired: 4426,
  /** Standard code for "the server is restarting": reconnect and resume. */
  serverRestart: 1012,
} as const;

const helloSchema = z
  .object({
    type: z.literal('hello'),
    bearer: z.string().max(200).optional(),
    since: z.number().int().min(0).optional(),
    clientVersion: z.string().max(40).optional(),
  })
  .strict();

const send = (socket: WebSocket, message: unknown): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

/**
 * Realtime channel: `GET /api/matches/:id/ws`.
 *
 * 1. Client connects and sends `{"type":"hello","bearer":"<session token>","since":<lastSeq>,"clientVersion":"1.2.3"}`
 *    within 5 s. The bearer is optional: without it the socket is a read-only spectator.
 * 2. Server replies `{"type":"welcome","view":...,"missed":[...],"resync":false}` then streams
 *    `{"type":"event","event":{seq,at,type,data}}` for everything that happens. `resync: true` means
 *    the server restarted and lost some events: throw away what you have and use `view`.
 * 3. Server pings every 25 s; a client that stops answering is dropped. A player whose last socket
 *    closes starts the 30 s reconnect clock (see docs/api-contract.md).
 * 4. When the server restarts it closes every socket with code 1012. Reconnect and send your last `seq`.
 */
export function registerRealtime(app: FastifyInstance, services: Services): { closeAll: () => void } {
  const { registry, sessions } = services;
  // How many sockets each player currently has open, so a second tab closing does not count as a disconnect.
  const open = new Map<string, number>();
  const sockets = new Set<WebSocket>();

  app.get<{ Params: { id: string } }>('/api/matches/:id/ws', { websocket: true }, (socket, req) => {
    const session = registry.get(req.params.id);
    if (!session) {
      send(socket, { type: 'error', code: 'match_not_found' });
      socket.close(CLOSE.notFound, 'match not found');
      return;
    }
    sockets.add(socket);

    let playerKey: string | null = null;
    let playerId: string | null = null;
    let unsubscribe: (() => void) | null = null;
    let alive = true;
    let ready = false;

    const helloTimer = setTimeout(() => {
      if (!ready) socket.close(CLOSE.helloTimeout, 'hello timeout');
    }, HELLO_DEADLINE_MS);

    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);

    socket.on('pong', () => {
      alive = true;
    });

    const onHello = async (data: z.infer<typeof helloSchema>): Promise<void> => {
      try {
        assertClientVersion(services, parseClientVersion(data.clientVersion));
      } catch (e) {
        if (e instanceof DomainError) send(socket, { type: 'error', code: e.code, ...e.details });
        socket.close(CLOSE.updateRequired, 'update required');
        return;
      }

      if (data.bearer) {
        try {
          if (!TOKEN_PATTERN.test(data.bearer)) throw new DomainError('unauthorized', 'bad credentials', 401);
          const account = await sessions.verify(data.bearer);
          playerId = account.id;
        } catch (e) {
          const banned = e instanceof DomainError && e.code === 'account_banned';
          send(socket, { type: 'error', code: banned ? 'account_banned' : 'unauthorized' });
          socket.close(banned ? CLOSE.banned : CLOSE.unauthorized, banned ? 'banned' : 'bad credentials');
          return;
        }
        // Only people sitting in this match count as connected players; anyone else is a spectator.
        if (session.seatOf(playerId)) {
          playerKey = `${session.id}:${playerId}`;
          open.set(playerKey, (open.get(playerKey) ?? 0) + 1);
          session.setConnected(playerId, true);
        }
      }
      if (socket.readyState !== socket.OPEN) {
        // The socket closed while we were checking credentials.
        if (playerKey && playerId) release(playerKey, playerId);
        return;
      }

      const since = data.since ?? 0;
      const resync = since > session.seqNumber;
      send(socket, { type: 'welcome', view: session.view(playerId ?? undefined), missed: resync ? [] : session.eventsSince(since), resync });
      unsubscribe = session.subscribe((event) => send(socket, { type: 'event', event }));
    };

    const release = (key: string, id: string): void => {
      const left = (open.get(key) ?? 1) - 1;
      if (left <= 0) {
        open.delete(key);
        session.setConnected(id, false);
      } else {
        open.set(key, left);
      }
    };

    socket.on('message', (raw: RawData) => {
      alive = true;
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: 'error', code: 'bad_json' });
        return;
      }
      if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'ping') {
        send(socket, { type: 'pong' });
        return;
      }
      if (ready) return; // only `hello` and `ping` are accepted; actions go through the REST API
      const parsed = helloSchema.safeParse(message);
      if (!parsed.success) {
        send(socket, { type: 'error', code: 'bad_hello' });
        socket.close(CLOSE.badHello, 'bad hello');
        return;
      }
      ready = true;
      clearTimeout(helloTimer);
      void onHello(parsed.data).catch(() => socket.close(CLOSE.unauthorized, 'error'));
    });

    socket.on('close', () => {
      sockets.delete(socket);
      clearTimeout(helloTimer);
      clearInterval(heartbeat);
      unsubscribe?.();
      if (playerKey && playerId) release(playerKey, playerId);
      playerKey = null;
    });

    socket.on('error', () => socket.terminate());
  });

  return {
    closeAll: () => {
      for (const socket of sockets) {
        try {
          socket.close(CLOSE.serverRestart, 'server restarting');
        } catch {
          // already closing
        }
      }
    },
  };
}
