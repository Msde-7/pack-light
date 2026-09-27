import { blankGrid, gridWidth, stamp } from './grid';
import type { Grid } from './grid';

/** A 5 pixel tall bitmap font. '#' is ink. Only the glyphs the art needs. */
// prettier-ignore
const GLYPHS: Record<string, Grid> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  x: ['...', '#.#', '.#.', '#.#', '...'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '!': ['#', '#', '#', '.', '#'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  ' ': ['...', '...', '...', '...', '...'],
};

const GLYPH_HEIGHT = 5;
const BADGE_HEIGHT = GLYPH_HEIGHT + 4;

/**
 * Renders text in the 5 pixel tall font with one pixel between glyphs. Most glyphs are 3 wide,
 * M, N and W are wider so they never read as H. Unknown characters are blank.
 */
export function textGrid(text: string, ink: string): string[] {
  const glyphs = text
    .split('')
    .map(char => (GLYPHS[char] ?? GLYPHS[' '] ?? []).map(row => row.replaceAll('#', ink)));
  const width = Math.max(
    0,
    glyphs.reduce((sum, glyph) => sum + gridWidth(glyph) + 1, -1),
  );
  let x = 0;
  return glyphs.reduce<string[]>(
    (grid, glyph) => {
      const next = stamp(grid, glyph, x, 0);
      x += gridWidth(glyph) + 1;
      return next;
    },
    blankGrid(width, GLYPH_HEIGHT),
  );
}

/**
 * The "x2", "x3" badge for stacked duplicates. A rounded red tag with paper-white text,
 * BADGE_HEIGHT tall and 4 pixels wider than its text.
 */
export function stackBadgeGrid(count: number): string[] {
  const text = textGrid(`x${Math.max(0, Math.trunc(count))}`, 'w');
  const width = gridWidth(text) + 4;
  const edge = `.${'k'.repeat(width - 2)}.`;
  const fill = `k${'r'.repeat(width - 2)}k`;
  const body = [edge, ...Array.from({ length: BADGE_HEIGHT - 2 }, () => fill), edge];
  return stamp(body, text, 2, 2);
}
