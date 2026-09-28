import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardSpec } from '../tools/export-board.js';

const root = resolve(import.meta.dirname, '../..');

describe('assets/board/led-board.json', () => {
  it('matches the server config (run `npm run board` if this fails)', () => {
    expect(readFileSync(resolve(root, 'assets/board/led-board.json'), 'utf8')).toBe(boardSpec());
  });

  it('points at logo and sound files that exist', () => {
    const spec = JSON.parse(boardSpec());
    for (const file of [...Object.values(spec.logo.files), ...spec.sounds.map((s: { file: string }) => s.file)]) {
      expect(() => readFileSync(resolve(root, file as string)), file as string).not.toThrow();
    }
  });
});
