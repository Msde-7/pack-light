import { bayer } from '../sprites/grid';
import type { Grid } from '../sprites/grid';
import { PALETTE } from '../sprites/palette';
import { gridCanvas, makeCanvas } from '../sprites/sprites';
import {
  FAR_HILLS,
  HILL_PERIOD,
  NEAR_HILLS,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  SNOW_LINE,
  hashSlot,
  hillTop,
  mountainTop,
} from './trail';
import type { HillLayer } from './trail';

export interface Backdrop {
  sky: HTMLCanvasElement;
  mountains: HTMLCanvasElement;
  far: HTMLCanvasElement;
  near: HTMLCanvasElement;
  clouds: HTMLCanvasElement[];
}

const color = (key: string): string => PALETTE[key] ?? '#000';

// Backdrop art, not sprites, so it has no outline. It sits behind everything and stays soft.
// prettier-ignore
const SUN: Grid = [
  '...yyyy...',
  '.yyyyyyyy.',
  '.yywwyyyy.',
  'yywwyyyyyy',
  'yyyyyyyyyy',
  'yyyyyyyyyy',
  'yyyyyyyyyy',
  '.yyyyyyyy.',
  '.yyyyyyyy.',
  '...yyyy...',
];

// prettier-ignore
const CLOUDS: readonly Grid[] = [
  [
    '.........wwww...........',
    '....www.wwwwww..........',
    '..wwwwwwwwwwwwww.wwww...',
    '.wwwwwwwwwwwwwwwwwwwwww.',
    'wwwwwwwwwwwwwwwwwwwwwwww',
    'cwwwwwwwwwwwwwwwwwwwwwwc',
    '.ccccccccccccccccccccc..',
  ],
  [
    '.....www......',
    '..wwwwwww.ww..',
    '.wwwwwwwwwwwww',
    'wwwwwwwwwwwwww',
    '.cccccccccccc.',
  ],
];

/** Bands of sky from deep blue overhead to pale at the horizon, joined by short dithers. */
const SKY_BANDS = [
  { key: 'u', from: 0 },
  { key: 'e', from: 30 },
  { key: 'c', from: 58 },
] as const;
const DITHER_ROWS = 6;

function paintSky(): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(SCENE_WIDTH, SCENE_HEIGHT);
  for (const [i, band] of SKY_BANDS.entries()) {
    const next = SKY_BANDS[i + 1]?.from ?? SCENE_HEIGHT;
    ctx.fillStyle = color(band.key);
    ctx.fillRect(0, band.from, SCENE_WIDTH, next - band.from);
    if (i === 0) continue;
    for (let row = 0; row < DITHER_ROWS; row++) {
      const y = band.from - DITHER_ROWS + row;
      for (let x = 0; x < SCENE_WIDTH; x++) {
        if (bayer(x, y) / 16 < (row + 1) / (DITHER_ROWS + 1)) ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  ctx.drawImage(gridCanvas(SUN), 250, 14);
  return canvas;
}

interface HillLook {
  body: string;
  /** A lit grass rim, dithered on its top row. */
  rim?: string;
  /** Small pines along the ridge. `spacing` is the width of the slot each pine may take. */
  pines: { key: string; seed: number; spacing: number };
}

function paintHills(layer: HillLayer, look: HillLook): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(HILL_PERIOD, SCENE_HEIGHT);
  for (let x = 0; x < HILL_PERIOD; x++) {
    const top = hillTop(layer, x);
    ctx.fillStyle = color(look.body);
    ctx.fillRect(x, top, 1, SCENE_HEIGHT - top);
    if (!look.rim) continue;
    ctx.fillStyle = color(look.rim);
    ctx.fillRect(x, top + 1, 1, 1);
    if ((x & 1) === 0) ctx.fillRect(x, top, 1, 1);
  }
  paintRidgePines(ctx, layer, look.pines);
  return canvas;
}

/** Pines spaced by a hash so they look scattered, each a stack of rows widening downhill. */
function paintRidgePines(
  ctx: CanvasRenderingContext2D,
  layer: HillLayer,
  { key, seed, spacing }: HillLook['pines'],
): void {
  ctx.fillStyle = color(key);
  for (let slot = 0; slot < HILL_PERIOD / spacing; slot++) {
    const h = hashSlot(slot + seed);
    if (h % 3 === 0) continue;
    const x = slot * spacing + (h % (spacing - 4));
    const height = 4 + ((h >>> 4) % 5);
    const base = hillTop(layer, x + 2) + 3;
    for (let row = 0; row < height; row++) {
      const half = Math.floor((row + 1) / 2);
      ctx.fillRect(x + 2 - half, base - height + row, half * 2 + 1, 1);
    }
  }
}

// A ragged snow line reads as drifts rather than a ruler cut.
const SNOW_EDGE = [0, 1, 2, 2, 1, 0, -1, 0, 1, 1, 0, -1];

/** A hazy range lit from the left. Rising slopes catch the light, falling ones sit in shade. */
function paintMountains(): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(HILL_PERIOD, SCENE_HEIGHT);
  for (let x = 0; x < HILL_PERIOD; x++) {
    const top = mountainTop(x);
    const lit =
      mountainTop(x + 1) < top || (mountainTop(x + 1) === top && mountainTop(x - 1) > top);
    const snowLine = SNOW_LINE + (SNOW_EDGE[x % SNOW_EDGE.length] ?? 0);
    for (let y = top; y < SCENE_HEIGHT; y++) {
      const snowy = y < snowLine;
      ctx.fillStyle = color(snowy ? (lit ? 'w' : 'c') : lit ? 'f' : 'v');
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

export function createBackdrop(): Backdrop {
  return {
    sky: paintSky(),
    mountains: paintMountains(),
    far: paintHills(FAR_HILLS, { body: 'm', pines: { key: 'j', seed: 57, spacing: 12 } }),
    near: paintHills(NEAR_HILLS, {
      body: 'n',
      rim: 'G',
      pines: { key: 'D', seed: 101, spacing: 16 },
    }),
    clouds: CLOUDS.map(cloud => gridCanvas(cloud)),
  };
}
