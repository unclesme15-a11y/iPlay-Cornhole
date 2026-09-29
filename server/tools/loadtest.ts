/**
 * Load test: many real matches at once against a running server.
 *
 *   npm run build && (NODE_ENV=production DATABASE_URL=postgres://... node dist/index.js &)
 *   npx tsx tools/loadtest.ts --url http://127.0.0.1:3000 --matches 300 --seconds 90
 *
 * Every simulated player signs up as a guest, starts a 1v1 against a Regular bot, connects a
 * WebSocket like the phone does, and throws whenever it is their turn (a good but human-ish throw,
 * so real physics and real scoring run). It reports how fast the server answered, and, with
 * --pid, the server process's CPU and memory over the run.
 */
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { gestureToward } from '../src/bots/botPolicy.js';
import { windDrift } from '../src/physics/wind.js';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const BASE = arg('url', 'http://127.0.0.1:3000').replace(/\/+$/, '');
const MATCHES = Number(arg('matches', '100'));
const SECONDS = Number(arg('seconds', '60'));
const PID = arg('pid', '');
const RAMP_PER_SEC = Number(arg('ramp', '50'));

const latencies: number[] = [];
const wsLatencies: number[] = [];
const errors: Record<string, number> = {};
let throws = 0;
let matchesStarted = 0;
let matchesFinished = 0;
let sockets = 0;
const bump = (k: string): void => void (errors[k] = (errors[k] ?? 0) + 1);

async function api(method: string, path: string, token: string | null, body?: unknown, ip?: string): Promise<{ status: number; json: any; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const ms = performance.now() - t0;
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // no body
  }
  return { status: res.status, json, ms };
}

let stop = false;

async function player(i: number): Promise<void> {
  // Each simulated phone has its own address (the server must run with TRUST_PROXY=true), like real players.
  const ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
  const call = (m: string, p: string, t: string | null, b?: unknown) => api(m, p, t, b, ip);
  const g = await call('POST', '/api/auth/guest', null, { confirmAdult: true, displayName: `Load ${i}` });
  if (g.status !== 201) return void bump(`guest_${g.status}`);
  const token = g.json.token as string;
  const me = g.json.account.id as string;
  const created = await call('POST', '/api/matches', token, { config: { mode: '1v1', playTo: 21 }, seats: { B1: { kind: 'bot', level: 'regular' } } });
  if (created.status !== 201) return void bump(`create_${created.status}`);
  const id = created.json.matchId as string;
  latencies.push(created.ms);
  const started = await call('POST', `/api/matches/${id}/start`, token, {});
  if (started.status !== 200) return void bump(`start_${started.status}`);
  matchesStarted++;

  await new Promise<void>((resolve) => {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/matches/${id}/ws`, { headers: { 'x-forwarded-for': ip } });
    sockets++;
    let mySeat: string | null = null;
    const finish = (): void => {
      sockets--;
      resolve();
    };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', bearer: token })));
    ws.on('error', () => bump('ws_error'));
    ws.on('close', finish);
    const timer = setInterval(() => {
      if (stop) ws.close();
    }, 500);
    ws.on('close', () => clearInterval(timer));
    ws.on('message', (raw) => {
      const t0 = performance.now();
      const m = JSON.parse(raw.toString());
      if (m.type === 'welcome') {
        mySeat = m.view.you?.seat ?? null;
      } else if (m.type === 'event') {
        const e = m.event;
        if (e.type === 'match_end') {
          matchesFinished++;
          ws.close();
        }
        if (e.type === 'turn_start' && e.data.seat === mySeat && e.data.controlledBy === 'human') {
          // pick a character/colour never needed: picks time out on their own; just throw like a decent human
          const wind = e.data.wind;
          const d = windDrift(0.85, wind);
          const gesture = gestureToward({ x: -d.x * 0.8 + (Math.random() - 0.5) * 6, y: 39 - d.y * 0.8 + (Math.random() - 0.5) * 8 }, 0.85);
          setTimeout(async () => {
            const r = await call('POST', `/api/matches/${id}/throw`, token, {
              ...gesture,
              release: { angleDeg: (Math.random() - 0.5) * 8, speed: 2 + Math.random() * 2, holdMs: 600 + Math.random() * 1500, curve: 0 },
            });
            latencies.push(r.ms);
            if (r.status === 200) throws++;
            else bump(`throw_${r.status}_${r.json?.error?.code ?? ''}`);
          }, 700 + Math.random() * 1500);
        }
      }
      wsLatencies.push(performance.now() - t0);
    });
  });
  void me;
}

const procStat = (): { cpuSec: number; rssMb: number } | null => {
  if (!PID) return null;
  try {
    const stat = readFileSync(`/proc/${PID}/stat`, 'utf8').split(') ')[1]!.split(' ');
    const ticks = Number(stat[11]) + Number(stat[12]);
    const rss = Number(readFileSync(`/proc/${PID}/statm`, 'utf8').split(' ')[1]) * 4096;
    return { cpuSec: ticks / 100, rssMb: rss / 1048576 };
  } catch {
    return null;
  }
};

const pct = (a: number[], p: number): number => {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

async function main(): Promise<void> {
  const cpu0 = procStat();
  const t0 = Date.now();
  console.log(`Starting ${MATCHES} matches (${RAMP_PER_SEC}/s ramp), running ${SECONDS}s against ${BASE}`);
  const runs: Promise<void>[] = [];
  let peakRss = 0;
  const sampler = setInterval(() => {
    const p = procStat();
    if (p) peakRss = Math.max(peakRss, p.rssMb);
    const el = (Date.now() - t0) / 1000;
    console.log(`t=${el.toFixed(0)}s live sockets=${sockets} throws=${throws} finished=${matchesFinished} errors=${Object.values(errors).reduce((a, b) => a + b, 0)}`);
  }, 10_000);
  for (let i = 0; i < MATCHES; i++) {
    runs.push(player(i).catch(() => bump('player_crash')));
    if ((i + 1) % RAMP_PER_SEC === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, Math.max(0, SECONDS * 1000 - (Date.now() - t0))));
  stop = true;
  await Promise.race([Promise.all(runs), new Promise((r) => setTimeout(r, 10_000))]);
  clearInterval(sampler);
  const secs = (Date.now() - t0) / 1000;
  const cpu1 = procStat();
  const ready = await api('GET', '/ready', null);
  console.log('\n=== result ===');
  console.log(`matches started ${matchesStarted}, finished ${matchesFinished}, throws ${throws} (${(throws / secs).toFixed(1)}/s)`);
  console.log(`API latency ms: p50 ${pct(latencies, 50).toFixed(0)}  p95 ${pct(latencies, 95).toFixed(0)}  p99 ${pct(latencies, 99).toFixed(0)}  max ${Math.max(0, ...latencies).toFixed(0)}`);
  console.log(`errors: ${JSON.stringify(errors)}`);
  console.log(`server /ready: ${JSON.stringify(ready.json)}`);
  if (cpu0 && cpu1) {
    console.log(`server CPU: ${(cpu1.cpuSec - cpu0.cpuSec).toFixed(1)}s over ${secs.toFixed(0)}s = ${(((cpu1.cpuSec - cpu0.cpuSec) / secs) * 100).toFixed(0)}% of one core; memory ${cpu1.rssMb.toFixed(0)} MB (peak ${peakRss.toFixed(0)} MB)`);
  }
  process.exit(0);
}
void main();
