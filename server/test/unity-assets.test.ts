import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LED_BOARD, SOUNDS } from '../src/presentation/effects.js';

const root = new URL('../../', import.meta.url);
const read = (p: string): Buffer => readFileSync(new URL(p, root));
const unity = 'unity/CornholeGreybox/Assets/Resources/';

describe('the Unity project carries current copies of the shared assets', () => {
  const pairs: Array<[string, string]> = [
    ['assets/audio/cornhole-hit.wav', 'Audio/cornhole_hit.wav'],
    ['assets/audio/cornhole-hit-alt-ding.wav', 'Audio/cornhole_hit_alt_ding.wav'],
    ['assets/audio/cornhole-hit-alt-buzz.wav', 'Audio/cornhole_hit_alt_buzz.wav'],
    ['assets/audio/bag-thud.wav', 'Audio/bag_thud.wav'],
    ['assets/audio/ground-thud.wav', 'Audio/ground_thud.wav'],
    ['assets/logo/iplay-mark-white.png', 'Branding/iplay-mark-white.png'],
    ['assets/logo/iplay-mark-cyan.png', 'Branding/iplay-mark-cyan.png'],
    ['assets/logo/iplay-mark-black.png', 'Branding/iplay-mark-black.png'],
    ['assets/board/led-board.json', 'Board/led-board.json'],
  ];
  it.each(pairs)('%s matches its copy in Unity', (source, copy) => {
    expect(read(unity + copy).equals(read(source)), `${copy} is out of date: copy it again from ${source}`).toBe(true);
  });

  it('has a sound file for every sound id the server names in its cues', () => {
    for (const s of SOUNDS) {
      const file = `${unity}Audio/${s.id}.wav`;
      expect(() => read(file), `${s.id} has no file in Unity (${file})`).not.toThrow();
    }
    expect(LED_BOARD).toBeDefined();
  });
});
