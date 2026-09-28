import { createRng, type Rng } from '../src/core/rng.js';

/**
 * Original sound effects, synthesised from scratch (no samples, no third-party audio).
 * The "cornhole hit" is a game-show style ring-in: a short buzzer punch into a bright two-note
 * bell. It is NOT a copy of any TV show's audio.
 */

export const SAMPLE_RATE = 44100;

const TAU = Math.PI * 2;
const seconds = (s: number): number => Math.round(s * SAMPLE_RATE);

/** Bell-like tone: a fundamental plus inharmonic partials, each decaying at its own rate. */
function addBell(out: Float32Array, startSec: number, freq: number, gain: number, decaySec: number, detuneCents = 0): void {
  const partials: Array<[ratio: number, amp: number]> = [
    [1, 1],
    [2.0, 0.5],
    [2.76, 0.36],
    [5.4, 0.18],
    [8.93, 0.08],
  ];
  const f = freq * 2 ** (detuneCents / 1200);
  const start = seconds(startSec);
  for (const [i, [ratio, amp]] of partials.entries()) {
    const tau = decaySec / (1 + 0.55 * i);
    const w = TAU * f * ratio;
    for (let n = 0; start + n < out.length; n++) {
      const t = n / SAMPLE_RATE;
      const env = Math.min(1, t / 0.001) * Math.exp(-t / tau);
      if (env < 1e-4 && t > 0.05) break;
      out[start + n] = (out[start + n] ?? 0) + gain * amp * env * Math.sin(w * t);
    }
  }
}

/** Buzzer punch: band-limited sawtooth with a small upward glide and a fast decay. */
function addBuzz(out: Float32Array, startSec: number, durSec: number, gain: number): void {
  const start = seconds(startSec);
  const len = seconds(durSec);
  let phase = 0;
  for (let n = 0; n < len && start + n < out.length; n++) {
    const t = n / SAMPLE_RATE;
    const f = 196 * (1 + 0.28 * Math.min(1, t / 0.06));
    phase += (TAU * f) / SAMPLE_RATE;
    let s = 0;
    for (let h = 1; h <= 14; h++) s += Math.sin(h * phase) / h;
    const env = Math.min(1, t / 0.003) * Math.exp(-t / (durSec * 0.5)) * Math.min(1, (durSec - t) / 0.015);
    out[start + n] = (out[start + n] ?? 0) + gain * s * env * 0.6;
  }
}

/** Small Schroeder-style room so the bell has some air. Mixed in at `wet`. */
function addRoom(input: Float32Array, wet: number): Float32Array {
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((s) => seconds(s));
  const out = new Float32Array(input.length);
  for (const delay of combs) {
    const buf = new Float32Array(input.length);
    for (let n = 0; n < input.length; n++) {
      buf[n] = (input[n] ?? 0) + (n >= delay ? (buf[n - delay] ?? 0) * 0.55 : 0);
      out[n] = (out[n] ?? 0) + (buf[n] ?? 0) * 0.25;
    }
  }
  const mixed = new Float32Array(input.length);
  for (let n = 0; n < input.length; n++) mixed[n] = (input[n] ?? 0) * (1 - wet) + (out[n] ?? 0) * wet;
  return mixed;
}

function finish(samples: Float32Array, peak = 0.89, fadeOutSec = 0.06): Float32Array {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  const scale = max > 0 ? peak / max : 1;
  const fade = seconds(fadeOutSec);
  for (let n = 0; n < samples.length; n++) {
    let v = (samples[n] ?? 0) * scale;
    const fromEnd = samples.length - 1 - n;
    if (fromEnd < fade) v *= fromEnd / fade;
    samples[n] = v;
  }
  return samples;
}

const E6 = 1318.51;
const B6 = 1975.53;

/** Main sound: buzzer punch, then a bright ascending two-note bell. ~1.9 s. */
export function renderCornholeHit(): Float32Array {
  const out = new Float32Array(seconds(1.9));
  addBuzz(out, 0, 0.14, 0.55);
  addBell(out, 0.1, E6, 0.7, 0.5);
  addBell(out, 0.1, E6, 0.35, 0.5, 4);
  addBell(out, 0.3, B6, 0.85, 0.75);
  addBell(out, 0.3, B6, 0.4, 0.75, -4);
  return finish(addRoom(out, 0.2));
}

/** Alternate 1: just the two-note bell, no buzzer. ~1.7 s. */
export function renderCornholeDing(): Float32Array {
  const out = new Float32Array(seconds(1.7));
  addBell(out, 0, E6, 0.7, 0.5);
  addBell(out, 0, E6, 0.35, 0.5, 4);
  addBell(out, 0.19, B6, 0.85, 0.75);
  addBell(out, 0.19, B6, 0.4, 0.75, -4);
  return finish(addRoom(out, 0.2));
}

/** Alternate 2: longer buzzer with one bell on top. ~1.5 s. */
export function renderCornholeBuzz(): Float32Array {
  const out = new Float32Array(seconds(1.5));
  addBuzz(out, 0, 0.3, 0.8);
  addBell(out, 0.22, B6, 0.8, 0.7);
  addBell(out, 0.22, B6, 0.35, 0.7, 4);
  return finish(addRoom(out, 0.18));
}

function lowpassNoise(rng: Rng, len: number, cutoffHz: number): Float32Array {
  const a = 1 - Math.exp((-TAU * cutoffHz) / SAMPLE_RATE);
  const out = new Float32Array(len);
  let y = 0;
  for (let n = 0; n < len; n++) {
    y += a * ((rng() * 2 - 1) - y);
    out[n] = y;
  }
  return out;
}

function thud(seed: number, opts: { durSec: number; f0: number; f1: number; noiseHz: number; noiseTau: number; bodyTau: number; rustle: number }): Float32Array {
  const rng = createRng(seed);
  const len = seconds(opts.durSec);
  const out = new Float32Array(len);
  const noise = lowpassNoise(rng, len, opts.noiseHz);
  const rustle = lowpassNoise(rng, len, 900);
  let phase = 0;
  for (let n = 0; n < len; n++) {
    const t = n / SAMPLE_RATE;
    const f = opts.f1 + (opts.f0 - opts.f1) * Math.exp(-t / 0.03);
    phase += (TAU * f) / SAMPLE_RATE;
    const body = Math.sin(phase) * Math.exp(-t / opts.bodyTau);
    const hit = (noise[n] ?? 0) * 6 * Math.exp(-t / opts.noiseTau);
    const grass = (rustle[n] ?? 0) * opts.rustle * Math.exp(-t / 0.12) * Math.min(1, t / 0.01);
    out[n] = (body * 0.8 + hit + grass) * Math.min(1, t / 0.003); // 3 ms fade-in: no click
  }
  return finish(out, 0.8, 0.05);
}

/** A bag landing on the wooden board. */
export const renderBagThud = (): Float32Array =>
  thud(101, { durSec: 0.35, f0: 130, f1: 60, noiseHz: 1100, noiseTau: 0.05, bodyTau: 0.09, rustle: 0 });

/** A bag hitting the grass: duller, with a little rustle. */
export const renderGroundThud = (): Float32Array =>
  thud(202, { durSec: 0.45, f0: 90, f1: 45, noiseHz: 450, noiseTau: 0.08, bodyTau: 0.11, rustle: 0.9 });

/** Encode mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

export const SFX_FILES: ReadonlyArray<{ file: string; render: () => Float32Array }> = [
  { file: 'cornhole-hit.wav', render: renderCornholeHit },
  { file: 'cornhole-hit-alt-ding.wav', render: renderCornholeDing },
  { file: 'cornhole-hit-alt-buzz.wav', render: renderCornholeBuzz },
  { file: 'bag-thud.wav', render: renderBagThud },
  { file: 'ground-thud.wav', render: renderGroundThud },
];

/** Signal strength at one frequency (Goertzel). Used by the tests to check the notes are right. */
export function goertzel(samples: Float32Array, startSec: number, endSec: number, freq: number): number {
  const s0 = seconds(startSec);
  const s1 = Math.min(samples.length, seconds(endSec));
  const w = (TAU * freq) / SAMPLE_RATE;
  const coeff = 2 * Math.cos(w);
  let a = 0;
  let b = 0;
  for (let n = s0; n < s1; n++) {
    const c = (samples[n] ?? 0) + coeff * a - b;
    b = a;
    a = c;
  }
  return Math.sqrt(a * a + b * b - coeff * a * b) / (s1 - s0);
}
