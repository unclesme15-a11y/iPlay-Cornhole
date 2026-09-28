import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOUNDS } from '../src/presentation/effects.js';
import {
  SAMPLE_RATE,
  SFX_FILES,
  encodeWav,
  goertzel,
  renderBagThud,
  renderCornholeBuzz,
  renderCornholeDing,
  renderCornholeHit,
  renderGroundThud,
} from '../tools/sfx.js';

const peak = (s: Float32Array) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (s: Float32Array, from: number, to: number) => {
  let sum = 0;
  const a = Math.round(from * SAMPLE_RATE);
  const b = Math.round(to * SAMPLE_RATE);
  for (let i = a; i < b; i++) sum += (s[i] ?? 0) ** 2;
  return Math.sqrt(sum / (b - a));
};
/** Strongest frequency in [lo, hi] Hz during a time window. */
function dominant(s: Float32Array, from: number, to: number, lo: number, hi: number): number {
  let best = lo;
  let bestVal = -1;
  for (let f = lo; f <= hi; f += 2) {
    const v = goertzel(s, from, to, f);
    if (v > bestVal) {
      bestVal = v;
      best = f;
    }
  }
  return best;
}

describe('WAV encoding', () => {
  it('writes a valid 16-bit mono 44.1 kHz PCM file whose header matches its data', () => {
    const wav = encodeWav(renderCornholeHit());
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(44100);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
  });
});

describe.each(SFX_FILES)('$file', ({ render }) => {
  const samples = render();

  it('is deterministic', () => {
    expect(Buffer.from(render().buffer).equals(Buffer.from(samples.buffer))).toBe(true);
  });

  it('is loud enough to hear but never clips', () => {
    const p = peak(samples);
    expect(p).toBeGreaterThan(0.6);
    expect(p).toBeLessThanOrEqual(0.9);
    expect(samples.every(Number.isFinite)).toBe(true);
  });

  it('starts and ends near silence (no clicks)', () => {
    expect(Math.abs(samples[0]!)).toBeLessThan(0.03);
    expect(Math.abs(samples.at(-1)!)).toBeLessThan(0.005);
  });
});

describe('cornhole hit (game-show ring-in)', () => {
  const hit = renderCornholeHit();

  it('lasts between 1.5 and 2.5 seconds', () => {
    expect(hit.length / SAMPLE_RATE).toBeGreaterThan(1.5);
    expect(hit.length / SAMPLE_RATE).toBeLessThan(2.5);
  });

  it('opens with a low buzzer punch, then two bell notes going UP a fifth (E6 then B6)', () => {
    expect(dominant(hit, 0.01, 0.08, 120, 700)).toBeGreaterThan(150); // buzzer fundamental region
    expect(goertzel(hit, 0.01, 0.08, 200)).toBeGreaterThan(goertzel(hit, 0.01, 0.08, 4000)); // buzzy/low, not bell
    const first = dominant(hit, 0.16, 0.29, 1000, 1600);
    const second = dominant(hit, 0.36, 0.6, 1600, 2600);
    expect(Math.abs(first - 1318.5)).toBeLessThan(20);
    expect(Math.abs(second - 1975.5)).toBeLessThan(25);
    expect(second / first).toBeCloseTo(1.5, 1);
  });

  it('is loudest in the first half second and rings out smoothly', () => {
    expect(rms(hit, 0, 0.5)).toBeGreaterThan(rms(hit, 0.5, 1.0));
    expect(rms(hit, 0.5, 1.0)).toBeGreaterThan(rms(hit, 1.4, 1.8));
  });

  it('the alternates are different sounds: bell-only has no buzzer, buzz version has a longer buzzer', () => {
    const ding = renderCornholeDing();
    const buzz = renderCornholeBuzz();
    expect(goertzel(ding, 0.01, 0.08, 200)).toBeLessThan(goertzel(hit, 0.01, 0.08, 200) * 0.2);
    expect(goertzel(buzz, 0.15, 0.28, 200)).toBeGreaterThan(goertzel(hit, 0.15, 0.28, 200));
  });
});

describe('thuds', () => {
  it('are short, low, and the grass one is duller than the board one', () => {
    const board = renderBagThud();
    const grass = renderGroundThud();
    expect(board.length / SAMPLE_RATE).toBeLessThan(0.5);
    expect(grass.length / SAMPLE_RATE).toBeLessThan(0.6);
    // Noise needs a whole band, not one frequency: compare energy above 1 kHz to energy below 300 Hz.
    const band = (s: Float32Array, lo: number, hi: number) => {
      let sum = 0;
      for (let f = lo; f <= hi; f += 50) sum += goertzel(s, 0, 0.1, f) ** 2;
      return sum;
    };
    const bright = (s: Float32Array) => band(s, 1000, 4000) / band(s, 50, 300);
    expect(bright(grass)).toBeLessThan(bright(board));
  });
});

describe('committed audio files', () => {
  const dir = resolve(import.meta.dirname, '../../assets/audio');
  it.each(SFX_FILES)('assets/audio/$file matches the generator (run `npm run sfx` if this fails)', ({ file, render }) => {
    const onDisk = readFileSync(resolve(dir, file));
    expect(onDisk.equals(encodeWav(render()))).toBe(true);
  });

  it('every sound in the catalog has a file', () => {
    for (const sound of SOUNDS) {
      const name = sound.file.split('/').pop()!;
      expect(SFX_FILES.some((f) => f.file === name), name).toBe(true);
    }
  });
});
