import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/**
 * Pulls the glowing "i>" mark out of the iPlay app icon (assets/logo/iplay-mark-source.jpg) and
 * writes transparent PNGs for the bag print: cyan (original glow colour), white (for dark bags)
 * and black (for light bags). The brushed-metal tile is grey, the mark is saturated cyan, so
 * "how much more cyan than grey is this pixel" becomes the alpha channel.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/logo');
const OUT_SIZE = 1024;

export interface Mark {
  width: number;
  height: number;
  /** Alpha 0..255 per pixel, row-major. */
  alpha: Uint8Array;
}

/** How much more cyan than grey a pixel is. Brushed metal is ~0-10, the dimmest part of the mark ~65. */
const cyanness = (r: number, g: number, b: number): number => Math.min(g, b) - r;

/** Edge of the glyph: the dimmest interior is ~65, the halo around it fades below this. */
const THRESHOLD = 60;

export function extractMark(jpgBytes: Buffer): Mark {
  const img = jpeg.decode(jpgBytes, { useTArray: true, formatAsRGBA: true });
  const { width, height, data } = img;
  const n = width * height;
  const cyan = new Float32Array(n);
  for (let i = 0; i < n; i++) cyan[i] = cyanness(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!);

  // Keep only the solid glyph shapes (the dot, the stem, the triangle). The tile also has a thin
  // glowing rim: a long skinny ring, so it fills very little of its own bounding box and is dropped.
  const label = new Int32Array(n);
  const keep = new Uint8Array(n);
  let next = 0;
  const queue = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (label[start] !== 0 || cyan[start]! < THRESHOLD) continue;
    next++;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = next;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    while (head < tail) {
      const p = queue[head++]!;
      const x = p % width;
      const y = (p - x) / width;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (q >= 0 && label[q] === 0 && cyan[q]! >= THRESHOLD) {
          label[q] = next;
          queue[tail++] = q;
        }
      }
    }
    const area = tail;
    const fill = area / ((maxX - minX + 1) * (maxY - minY + 1));
    if (area >= 4000 && fill >= 0.25) for (let k = 0; k < tail; k++) keep[queue[k]!] = 1;
  }

  fillHoles(keep, width, height);
  // Smooth just the edge (two box blurs) so the print is crisp but not jagged.
  const soft = blur(blur(keep, width, height, 2), width, height, 2);
  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) alpha[i] = Math.round(soft[i]! * 255);
  return { width, height, alpha };
}

/** Any unset pixel not reachable from the image border is inside a shape: set it. */
function fillHoles(mask: Uint8Array, width: number, height: number): void {
  const outside = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  const push = (p: number): void => {
    if (!mask[p] && !outside[p]) {
      outside[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (head < tail) {
    const p = queue[head++]!;
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < mask.length - width) push(p + width);
  }
  for (let i = 0; i < mask.length; i++) if (!outside[i]) mask[i] = 1;
}

function blur(src: Uint8Array | Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += src[y * width + Math.min(width - 1, Math.max(0, x + k))]!;
      tmp[y * width + x] = sum / span;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += tmp[Math.min(height - 1, Math.max(0, y + k)) * width + x]!;
      out[y * width + x] = sum / span;
    }
  }
  return out;
}

/** Bounding box of the mark, ignoring the faint outer glow. */
export function bounds(mark: Mark, minAlpha = 128): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = mark.width;
  let y0 = mark.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < mark.height; y++) {
    for (let x = 0; x < mark.width; x++) {
      if (mark.alpha[y * mark.width + x]! >= minAlpha) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return { x0, y0, x1, y1 };
}

/** Square, centred crop around the mark with a margin, resampled to OUT_SIZE (box filter). */
export function render(mark: Mark, rgb: [number, number, number], size = OUT_SIZE, margin = 0.08): PNG {
  const b = bounds(mark);
  const w = b.x1 - b.x0 + 1;
  const h = b.y1 - b.y0 + 1;
  const side = Math.round(Math.max(w, h) * (1 + margin * 2));
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const sx0 = Math.round(cx - side / 2);
  const sy0 = Math.round(cy - side / 2);
  const png = new PNG({ width: size, height: size });
  const scale = side / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let count = 0;
      const ya = Math.floor(sy0 + y * scale);
      const yb = Math.max(ya + 1, Math.floor(sy0 + (y + 1) * scale));
      const xa = Math.floor(sx0 + x * scale);
      const xb = Math.max(xa + 1, Math.floor(sx0 + (x + 1) * scale));
      for (let yy = ya; yy < yb; yy++) {
        for (let xx = xa; xx < xb; xx++) {
          if (xx >= 0 && yy >= 0 && xx < mark.width && yy < mark.height) sum += mark.alpha[yy * mark.width + xx]!;
          count++;
        }
      }
      const o = (y * size + x) * 4;
      png.data[o] = rgb[0];
      png.data[o + 1] = rgb[1];
      png.data[o + 2] = rgb[2];
      png.data[o + 3] = Math.round(sum / Math.max(1, count));
    }
  }
  return png;
}

export const VARIANTS: ReadonlyArray<{ file: string; rgb: [number, number, number] }> = [
  { file: 'iplay-mark-cyan.png', rgb: [0, 229, 255] },
  { file: 'iplay-mark-white.png', rgb: [255, 255, 255] },
  { file: 'iplay-mark-black.png', rgb: [17, 17, 17] },
];

export function buildAll(): Array<{ file: string; png: Buffer }> {
  const mark = extractMark(readFileSync(resolve(root, 'iplay-mark-source.jpg')));
  return VARIANTS.map(({ file, rgb }) => ({ file, png: PNG.sync.write(render(mark, rgb)) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(root, { recursive: true });
  for (const { file, png } of buildAll()) {
    writeFileSync(resolve(root, file), png);
    console.log(`wrote assets/logo/${file} (${(png.length / 1024).toFixed(0)} KB)`);
  }
}
