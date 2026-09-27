// Pack Light sprites (original artwork, CC0). Each sprite is a Grid of palette keys.
import { COMPANION_SPRITES } from './art/companions';
import { DUST_SPRITES, HIKER_EXTRAS, HIKER_SPRITES } from './art/hiker';
import {
  CAMPFIRE_ICON,
  ITEM_SPRITES,
  LETTER_MINI,
  MINI_ICON_SPRITES,
  MINI_PIN_GLOW,
  PIN_GLOW,
  STALE_OVERLAY,
} from './art/items';
import { PACK_SPRITES } from './art/pack';
import {
  CAMPFIRE_SPRITES,
  PROP_SPRITES,
  SIGN_SPRITES,
  TERRAIN_SPRITES,
  TREE_SPRITES,
} from './art/scenery';
import { stackBadgeGrid } from './font';
import type { Grid } from './grid';
import { PALETTE } from './palette';
import type { PaletteOverride } from './palette';

export { PALETTE };

/**
 * How a sprite's silhouette is checked. `full` needs a dark outline all round. `tile` is
 * seamless terrain, so its borders are open. `fire` may edge flames in fire red.
 * `none` is for see-through overlays that sit on top of another sprite.
 */
export type OutlineRule = 'full' | 'tile' | 'fire' | 'none';

export interface SpriteGroup {
  category: string;
  width: number;
  height: number;
  outline: OutlineRule;
  sprites: Readonly<Record<string, Grid>>;
}

/** Every sprite with its documented size and outline rule. */
// prettier-ignore
export const SPRITE_GROUPS: readonly SpriteGroup[] = [
  { category: 'item icon', width: 16, height: 16, outline: 'full', sprites: ITEM_SPRITES },
  { category: 'item icon', width: 16, height: 16, outline: 'fire', sprites: { campfire_compact: CAMPFIRE_ICON } },
  { category: 'mini icon', width: 8, height: 8, outline: 'full', sprites: MINI_ICON_SPRITES },
  { category: 'overlay', width: 16, height: 16, outline: 'none', sprites: { pin_glow: PIN_GLOW, stale_overlay: STALE_OVERLAY } },
  { category: 'overlay', width: 10, height: 10, outline: 'none', sprites: { mini_pin_glow: MINI_PIN_GLOW } },
  { category: 'overlay', width: 11, height: 9, outline: 'full', sprites: { stack_badge: stackBadgeGrid(2) } },
  { category: 'letter', width: 8, height: 6, outline: 'full', sprites: { letter_mini: LETTER_MINI } },
  { category: 'hiker', width: 16, height: 20, outline: 'full', sprites: HIKER_SPRITES },
  { category: 'sweat', width: 3, height: 4, outline: 'full', sprites: { sweat_drop: HIKER_EXTRAS.sweat_drop } },
  { category: 'dust', width: 6, height: 3, outline: 'none', sprites: DUST_SPRITES },
  { category: 'bubble', width: 9, height: 11, outline: 'full', sprites: { bubble_alert: HIKER_EXTRAS.bubble_alert } },
  { category: 'bubble', width: 12, height: 13, outline: 'full', sprites: { bubble_zzz: HIKER_EXTRAS.bubble_zzz } },
  { category: 'pack', width: 10, height: 16, outline: 'full', sprites: PACK_SPRITES },
  { category: 'companion', width: 12, height: 16, outline: 'full', sprites: COMPANION_SPRITES },
  { category: 'tile', width: 16, height: 16, outline: 'full', sprites: PROP_SPRITES },
  { category: 'terrain', width: 16, height: 16, outline: 'tile', sprites: TERRAIN_SPRITES },
  { category: 'tree', width: 16, height: 32, outline: 'full', sprites: TREE_SPRITES },
  { category: 'trail sign', width: 24, height: 24, outline: 'full', sprites: SIGN_SPRITES },
  { category: 'campfire', width: 16, height: 16, outline: 'fire', sprites: CAMPFIRE_SPRITES },
];

export const SPRITES: Readonly<Record<string, Grid>> = Object.fromEntries(
  SPRITE_GROUPS.flatMap(group => Object.entries(group.sprites)),
);

const STACK_BADGE = /^stack_badge_(\d{1,3})$/;
const badges = new Map<string, Grid>();

/** Name of the stack badge sprite for a count, such as `stack_badge_3` for "x3". */
export function stackBadgeName(count: number): string {
  return `stack_badge_${Math.max(0, Math.min(999, Math.trunc(count)))}`;
}

/** Rows of a registered sprite, or of a generated one such as `stack_badge_12`. */
export function spriteRows(name: string): Grid | undefined {
  const fixed = SPRITES[name] ?? badges.get(name);
  if (fixed) return fixed;
  const badge = STACK_BADGE.exec(name);
  if (!badge) return undefined;
  const grid = stackBadgeGrid(Number(badge[1]));
  badges.set(name, grid);
  return grid;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  return ctx;
}

export function makeCanvas(
  width: number,
  height: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return [canvas, context2d(canvas)];
}

/** A grid painted at 1x on its own canvas. */
export function gridCanvas(rows: Grid, override: PaletteOverride = {}): HTMLCanvasElement {
  const palette = { ...PALETTE, ...override };
  const [canvas, ctx] = makeCanvas(rows[0]?.length ?? 0, rows.length);
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const color = palette[row.charAt(c)];
      if (color === undefined) continue;
      ctx.fillStyle = color;
      ctx.fillRect(c, r, 1, 1);
    }
  });
  return canvas;
}

const canvases = new Map<string, HTMLCanvasElement>();

/**
 * A named sprite pre-rendered once per palette override, so a frame costs one drawImage per
 * sprite instead of one fillRect per pixel. Undefined for unknown names.
 */
export function spriteCanvas(
  name: string,
  override: PaletteOverride = {},
): HTMLCanvasElement | undefined {
  const swaps = Object.entries(override).sort(([a], [b]) => a.localeCompare(b));
  const key = [name, ...swaps.map(([from, to]) => `${from}=${to}`)].join('|');
  const hit = canvases.get(key);
  if (hit) return hit;
  const rows = spriteRows(name);
  if (!rows) return undefined;
  const canvas = gridCanvas(rows, override);
  canvases.set(key, canvas);
  return canvas;
}

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  scale = 1,
  paletteOverride: PaletteOverride = {},
): void {
  const image = spriteCanvas(name, paletteOverride);
  if (!image) throw new Error(`Unknown sprite: ${name}`);
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, Math.round(x), Math.round(y), image.width * scale, image.height * scale);
  ctx.imageSmoothingEnabled = smoothing;
}
