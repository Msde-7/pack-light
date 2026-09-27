import { describe, expect, it } from 'vitest';
import type { ItemKind } from '../../core/types';
import { ANIMATIONS } from './animations';
import { PACK_MOUNT } from './art/hiker';
import { packOffset } from './art/pack';
import type { Grid } from './grid';
import { ITEM_ICON } from './icons';
import { HAT_COLORS, PALETTE, hatPalette } from './palette';
import { SPRITES, SPRITE_GROUPS, spriteRows, stackBadgeName } from './sprites';
import type { OutlineRule } from './sprites';

/**
 * Opaque pixels that touch the transparent area connected to the grid border, the pixels a
 * viewer reads as the silhouette. Enclosed holes do not count. With `wrap`, the grid is a
 * tile, so its borders continue into the next tile and are not edges.
 */
function silhouettePixels(grid: Grid, wrap = false): { r: number; c: number; key: string }[] {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const outside = grid.map(() => new Array<boolean>(width).fill(false));
  const queue: [number, number][] = [];
  const visit = (r: number, c: number): void => {
    const row = outside[r];
    if (!row || c < 0 || c >= width || row[c] || grid[r]?.charAt(c) !== '.') return;
    row[c] = true;
    queue.push([r, c]);
  };
  for (let c = 0; c < width; c++) {
    visit(0, c);
    visit(height - 1, c);
  }
  for (let r = 0; r < height && !wrap; r++) {
    visit(r, 0);
    visit(r, width - 1);
  }
  for (let next = queue.pop(); next; next = queue.pop()) {
    const [r, c] = next;
    visit(r - 1, c);
    visit(r + 1, c);
    visit(r, c - 1);
    visit(r, c + 1);
  }
  const isOutside = (r: number, c: number): boolean =>
    r < 0 || r >= height || c < 0 || c >= width ? !wrap : outside[r]?.[c] === true;
  return grid.flatMap((row, r) =>
    row.split('').flatMap((key, c) => {
      if (key === '.') return [];
      const edge = [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ].some(([nr = 0, nc = 0]) => isOutside(nr, nc));
      return edge ? [{ r, c, key }] : [];
    }),
  );
}

const entries = SPRITE_GROUPS.flatMap(group =>
  Object.entries(group.sprites).map(([name, rows]) => ({ name, rows, group })),
);

const EDGE_KEYS: Record<Exclude<OutlineRule, 'none'>, string> = {
  full: 'k',
  tile: 'kD',
  fire: 'kr',
};

function badEdges(rows: Grid, rule: OutlineRule): string[] {
  if (rule === 'none') return [];
  const allowed = EDGE_KEYS[rule];
  return silhouettePixels(rows, rule === 'tile')
    .filter(pixel => !allowed.includes(pixel.key))
    .map(pixel => `(${pixel.c},${pixel.r})=${pixel.key}`);
}

describe('sprites', () => {
  it('registers every sprite exactly once', () => {
    const names = entries.map(entry => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(SPRITES)).toHaveLength(names.length);
  });

  it.each(entries)('$name has equal rows of the documented size', ({ rows, group }) => {
    expect(rows).toHaveLength(group.height);
    for (const row of rows) expect(row).toHaveLength(group.width);
  });

  it.each(entries)('$name uses only palette keys or "."', ({ rows }) => {
    const keys = new Set(rows.join('').replaceAll('.', ''));
    for (const key of keys) expect(PALETTE, `key ${key}`).toHaveProperty(key);
  });

  it.each(entries)('$name has a closed outline', ({ rows, group }) => {
    expect(badEdges(rows, group.outline)).toEqual([]);
  });

  it('has an icon for every item kind', () => {
    for (const kind of Object.keys(ITEM_ICON) as ItemKind[]) {
      expect(SPRITES).toHaveProperty(ITEM_ICON[kind]);
    }
  });

  it('has every animation frame', () => {
    for (const animation of Object.values(ANIMATIONS)) {
      for (const frame of animation.frames) expect(SPRITES).toHaveProperty(frame);
    }
  });

  it('mounts the pack on every hiker frame', () => {
    for (const frame of Object.keys(PACK_MOUNT)) {
      expect(SPRITES).toHaveProperty(frame);
      expect(packOffset(frame)).toBeDefined();
    }
    expect(packOffset('no_such_frame')).toBeUndefined();
  });

  it('lines the pack layer up with the back', () => {
    expect(packOffset('hiker_walk_1')).toEqual({ x: -4, y: -4 });
  });

  it('bounces the pack a beat behind the body', () => {
    const packY = [1, 2, 3, 4, 5, 6].map(i => packOffset(`hiker_walk_${i}`)?.y);
    expect(packY).toEqual([-4, -3, -3, -4, -3, -3]);
  });
});

describe('stack badges', () => {
  it('names badges by count', () => {
    expect(stackBadgeName(3)).toBe('stack_badge_3');
    expect(stackBadgeName(2.7)).toBe('stack_badge_2');
  });

  it('generates a badge for any count, 4 px wider per digit', () => {
    const two = spriteRows('stack_badge_2');
    const twelve = spriteRows('stack_badge_12');
    expect(two).toHaveLength(9);
    expect(twelve).toHaveLength(9);
    expect((twelve?.[0]?.length ?? 0) - (two?.[0]?.length ?? 0)).toBe(4);
    expect(badEdges(twelve ?? [], 'full')).toEqual([]);
  });

  it('returns undefined for unknown names', () => {
    expect(spriteRows('stack_badge_x')).toBeUndefined();
    expect(spriteRows('nope')).toBeUndefined();
  });
});

describe('hat palette', () => {
  it('offers six hat colors and wraps any index', () => {
    expect(HAT_COLORS).toHaveLength(6);
    expect(hatPalette(0)).toEqual({ a: HAT_COLORS[0]?.[0], 3: HAT_COLORS[0]?.[1] });
    expect(hatPalette(7)).toEqual({ a: HAT_COLORS[1]?.[0], 3: HAT_COLORS[1]?.[1] });
    expect(hatPalette(-1).a).toBe(HAT_COLORS[5]?.[0]);
  });
});

describe('silhouette check', () => {
  it('ignores enclosed holes', () => {
    expect(silhouettePixels(['kkk', 'k.k', 'kkk']).every(pixel => pixel.key === 'k')).toBe(true);
    expect(silhouettePixels(['.w.']).map(pixel => pixel.key)).toEqual(['w']);
  });

  it('treats the borders as open when the grid tiles', () => {
    const keys = silhouettePixels(['....', 'kkkk', 'GGGG'], true).map(pixel => pixel.key);
    expect(keys).toEqual(['k', 'k', 'k', 'k']);
  });
});
