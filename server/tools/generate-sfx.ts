import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX_FILES, encodeWav } from './sfx.js';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/audio');
mkdirSync(outDir, { recursive: true });
for (const { file, render } of SFX_FILES) {
  const wav = encodeWav(render());
  writeFileSync(resolve(outDir, file), wav);
  console.log(`wrote assets/audio/${file} (${(wav.length / 1024).toFixed(0)} KB)`);
}
