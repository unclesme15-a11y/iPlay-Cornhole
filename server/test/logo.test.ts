import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { VARIANTS, buildAll } from '../tools/extract-logo.js';

const dir = resolve(import.meta.dirname, '../../assets/logo');
const built = buildAll();

const alphaAt = (png: PNG, x: number, y: number) => png.data[(y * png.width + x) * 4 + 3]!;

/** Count separate opaque shapes (4-connected) on a coarse grid. */
function shapes(png: PNG, step = 8): number {
  const w = Math.floor(png.width / step);
  const h = Math.floor(png.height / step);
  const on = (x: number, y: number) => alphaAt(png, x * step, y * step) > 128;
  const seen = new Uint8Array(w * h);
  let count = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !on(x, y)) continue;
      count++;
      const stack = [[x, y]] as Array<[number, number]>;
      seen[y * w + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as Array<[number, number]>) {
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && !seen[ny * w + nx] && on(nx, ny)) {
            seen[ny * w + nx] = 1;
            stack.push([nx, ny]);
          }
        }
      }
    }
  return count;
}

describe('iPlay mark for the bags', () => {
  const cyan = PNG.sync.read(built[0]!.png);

  it('is 1024 x 1024 with a transparent background', () => {
    expect(cyan.width).toBe(1024);
    expect(cyan.height).toBe(1024);
    for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023], [512, 0], [0, 512], [1023, 512], [512, 1023]] as const) {
      expect(alphaAt(cyan, x, y)).toBe(0);
    }
  });

  it('is exactly three solid shapes: the dot, the stem of the "i", and the play triangle', () => {
    expect(shapes(cyan)).toBe(3);
  });

  it('has no tile rim or stray marks around the edge of the image', () => {
    for (let i = 0; i < 1024; i += 4) {
      for (const [x, y] of [[i, 2], [i, 1021], [2, i], [1021, i]] as const) expect(alphaAt(cyan, x, y)).toBe(0);
    }
  });

  it('is solid inside the shapes (no holes) and covers a plausible share of the frame', () => {
    let opaque = 0;
    let partial = 0;
    for (let i = 3; i < cyan.data.length; i += 4) {
      if (cyan.data[i]! === 255) opaque++;
      else if (cyan.data[i]! > 0) partial++;
    }
    const total = 1024 * 1024;
    expect(opaque / total).toBeGreaterThan(0.25);
    expect(opaque / total).toBeLessThan(0.6);
    // Edges only: ~8 px of anti-aliasing on a 1024 px image is ~0.7 mm when the mark is printed 3.4 in wide.
    expect(partial / total).toBeLessThan(0.09);
    // centre of the triangle and centre of the stem are fully opaque
    expect(alphaAt(cyan, 690, 520)).toBe(255);
    expect(alphaAt(cyan, 190, 600)).toBe(255);
  });

  it.each(VARIANTS.map((v, i) => [v.file, v.rgb, i] as const))('%s uses one flat colour', (_file, rgb, i) => {
    const png = PNG.sync.read(built[i]!.png);
    for (let p = 0; p < png.data.length; p += 4 * 997) {
      expect([png.data[p], png.data[p + 1], png.data[p + 2]]).toEqual([...rgb]);
    }
  });

  it.each(VARIANTS.map((v, i) => [v.file, i] as const))('assets/logo/%s matches the generator (run `npm run logo` if this fails)', (file, i) => {
    expect(readFileSync(resolve(dir, file)).equals(built[i]!.png)).toBe(true);
  });
});
