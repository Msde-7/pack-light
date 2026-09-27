import type { Grid } from '../grid';
import { PACK_MOUNT } from './hiker';

export type PackSize = 'pack_s' | 'pack_m' | 'pack_l' | 'pack_xl';

const PACK_WIDTH = 10;
const PACK_HEIGHT = 16;

/**
 * Pack layers, 10x16, drawn behind the hiker. Each is bottom-right aligned so pixel (9, 15)
 * lands on the frame's PACK_MOUNT. Larger packs grow up and back, and from `pack_l` on the
 * tips of carried items poke out of the top.
 */
// prettier-ignore
export const PACK_SPRITES: Record<PackSize, Grid> = {
  pack_s: [
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '......kkk.',
    '.....kbbbk',
    '.....kbybk',
    '.....kBBbk',
    '.....kBBbk',
    '......kkk.',
  ],
  pack_m: [
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '.....kkkk.',
    '....kbbbbk',
    '....kbbybk',
    '....kBBBbk',
    '....kBkkbk',
    '....kBBBbk',
    '....kBBBbk',
    '.....kkkk.',
  ],
  pack_l: [
    '..........',
    '..........',
    '..........',
    '....kk....',
    '...kwwkkk.',
    '...kwkkgk.',
    '..kkkkkkkk',
    '..kuuuuuUk',
    '..kkkkkkkk',
    '...kbbbbbk',
    '...kbbybbk',
    '...kBBBBbk',
    '...kBkkkbk',
    '...kBBBBbk',
    '...kBBBBbk',
    '....kkkkk.',
  ],
  pack_xl: [
    '..........',
    '..kk..kk..',
    '.kwwkkggk.',
    '.kwwkkgkk.',
    'kkkkkkkkkk',
    'kbbbbbbbbk',
    'kbbbbybbbk',
    'kBBBBBBBbk',
    'kBBkkkkBbk',
    'kBBkBBkBbk',
    'kBBkkkkBbk',
    'kBBBBBBBbk',
    'kBBBBBBBbk',
    'kkkkkkkkkk',
    'kuuuuuuuUk',
    'kkkkkkkkkk',
  ],
};

/** Offset of the pack layer's top-left from the hiker frame's top-left, in pixels. */
export function packOffset(frame: string): { x: number; y: number } | undefined {
  const mount = PACK_MOUNT[frame];
  if (!mount) return undefined;
  return { x: mount[0] - (PACK_WIDTH - 1), y: mount[1] - (PACK_HEIGHT - 1) };
}
