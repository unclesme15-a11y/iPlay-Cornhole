import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { z } from 'zod';
import type { MatchRegistry } from '../store/registry.js';
import { parseBearer } from './auth.js';

const HELLO_DEADLINE_MS = 5_000;
const HEARTBEAT_MS = 25_000;

const helloSchema = z
  .object({ type: z.literal('hello'), bearer: z.string().max(200).optional(), since: z.number().int().min(0).optional() })
  .strict();

const send = (socket: WebSocket, message: unknown): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

/**
 * Realtime channel: `GET /api/matches/:id/ws`.
 *
 * 1. Client connects and sends `{"type":"hello","bearer":"<playerId>.<token>","since":<lastSeq>}`
 *    within 5 s. The bearer is optional: without it the socket is a read-only spectator.
 * 2. Server replies `{"type":"welcome","view":...,"missed":[...]}` then streams
 *    `{"type":"event","event":{seq,at,type,data}}` for everything that happens.
 * 3. Server pings every 25 s; a client that stops answering is dropped. A player whose last socket
 *    closes starts the 30 s reconnect clock (see docs/api-contract.md).
 */
export function registerRealtime(app: FastifyInstance, registry: MatchRegistry): void {
  // How many sockets each player currently has open, so a second tab closing does not count as a disconnect.
  const open = new Map<string, number>();

  app.get<{ Params: { id: string } }>('/api/matches/:id/ws', { websocket: true }, (socket, req) => {
    const session = registry.get(req.params.id);
    if (!session) {
      send(socket, { type: 'error', code: 'match_not_found' });
      socket.close(4404, 'match not found');
      return;
    }

    let playerKey: string | null = null;
    let playerId: string | null = null;
    let unsubscribe: (() => void) | null = null;
    let alive = true;
    let ready = false;

    const helloTimer = setTimeout(() => {
      if (!ready) socket.close(4408, 'hello timeout');
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
        socket.close(4400, 'bad hello');
        return;
      }
      ready = true;
      clearTimeout(helloTimer);

      const creds = parseBearer(parsed.data.bearer ? `Bearer ${parsed.data.bearer}` : undefined);
      if (creds && session.authenticate(creds.playerId, creds.token)) {
        playerId = creds.playerId;
        playerKey = `${session.id}:${creds.playerId}`;
        open.set(playerKey, (open.get(playerKey) ?? 0) + 1);
        session.setConnected(playerId, true);
      } else if (parsed.data.bearer) {
        send(socket, { type: 'error', code: 'unauthorized' });
        socket.close(4401, 'bad credentials');
        return;
      }

      const since = parsed.data.since ?? 0;
      send(socket, { type: 'welcome', view: session.view(playerId ?? undefined), missed: session.eventsSince(since) });
      unsubscribe = session.subscribe((event) => send(socket, { type: 'event', event }));
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(heartbeat);
      unsubscribe?.();
      if (playerKey && playerId) {
        const left = (open.get(playerKey) ?? 1) - 1;
        if (left <= 0) {
          open.delete(playerKey);
          session.setConnected(playerId, false);
        } else {
          open.set(playerKey, left);
        }
      }
    });

    socket.on('error', () => socket.terminate());
  });
}
