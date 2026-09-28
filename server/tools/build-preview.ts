import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BAG_COLORS } from '../src/core/constants.js';
import { LED_BOARD } from '../src/presentation/effects.js';

/** Builds preview/board-preview.html: one self-contained page with the real audio and logo inlined. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const b64 = (path: string, mime: string): string => `data:${mime};base64,${readFileSync(resolve(root, path)).toString('base64')}`;

export function buildPreview(): string {
  const assets = {
    colors: BAG_COLORS,
    led: LED_BOARD,
    sounds: {
      hit: b64('assets/audio/cornhole-hit.wav', 'audio/wav'),
      ding: b64('assets/audio/cornhole-hit-alt-ding.wav', 'audio/wav'),
      buzz: b64('assets/audio/cornhole-hit-alt-buzz.wav', 'audio/wav'),
      thud: b64('assets/audio/bag-thud.wav', 'audio/wav'),
      ground: b64('assets/audio/ground-thud.wav', 'audio/wav'),
    },
    logo: {
      cyan: b64('assets/logo/iplay-mark-cyan.png', 'image/png'),
      white: b64('assets/logo/iplay-mark-white.png', 'image/png'),
      black: b64('assets/logo/iplay-mark-black.png', 'image/png'),
    },
  };
  const template = readFileSync(resolve(root, 'preview/board-preview.template.html'), 'utf8');
  return template.replace('/*ASSETS*/', `window.__ASSETS__ = ${JSON.stringify(assets)};`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(root, 'preview/board-preview.html');
  mkdirSync(dirname(out), { recursive: true });
  const html = buildPreview();
  writeFileSync(out, html);
  console.log(`wrote preview/board-preview.html (${(html.length / 1024).toFixed(0)} KB)`);
}
