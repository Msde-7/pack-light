/** Scene layout in pixels of the 320x180 canvas. */
export const SCENE_WIDTH = 320;
export const SCENE_HEIGHT = 180;
export const GRASS_Y = 120;
/** Where props and signs stand, on the grass behind the trail. */
export const VERGE_BASE = 129;
export const FEET_Y = 150;
/** The grass verge in front of the trail, then meadow to the bottom edge. */
export const FRONT_GRASS_Y = 148;
export const MEADOW_Y = FRONT_GRASS_Y + 16;

/** Hills are pre-rendered as strips this wide and repeat, so every wave period divides it. */
export const HILL_PERIOD = 640;

export interface Prop {
  sprite: string;
  /** Left edge in trail coordinates, which scroll past at walking speed. */
  x: number;
  height: number;
}

const SLOT = 56;
const PROP_KINDS: readonly { sprite: string; height: number }[] = [
  { sprite: 'tree_pine', height: 32 },
  { sprite: 'tree_round', height: 32 },
  { sprite: 'bush', height: 16 },
  { sprite: 'tree_pine', height: 32 },
  { sprite: 'rock', height: 16 },
  { sprite: 'bush', height: 16 },
  { sprite: 'flowers', height: 16 },
  { sprite: 'tree_pine', height: 32 },
  { sprite: 'stump', height: 16 },
  { sprite: 'bush', height: 16 },
];

/** Small integer hash, so the same stretch of trail always grows the same props. */
export function hashSlot(slot: number): number {
  let h = Math.imul(slot ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function propAt(slot: number): Prop | undefined {
  const h = hashSlot(slot);
  if (h % 7 === 0) return undefined;
  const kind = PROP_KINDS[(h >>> 3) % PROP_KINDS.length];
  if (!kind) return undefined;
  return { sprite: kind.sprite, x: slot * SLOT + ((h >>> 8) % (SLOT - 16)), height: kind.height };
}

/** Props that overlap the view when the trail has scrolled `distance` pixels. */
export function propsInView(distance: number, width = SCENE_WIDTH): Prop[] {
  const first = Math.floor(distance / SLOT) - 1;
  const last = Math.ceil((distance + width) / SLOT);
  const props: Prop[] = [];
  for (let slot = first; slot <= last; slot++) {
    const prop = propAt(slot);
    if (prop && prop.x + 16 > distance && prop.x < distance + width) props.push(prop);
  }
  return props;
}

interface Peak {
  x: number;
  height: number;
}

/** A snowy range far behind the hills, as peaks along one HILL_PERIOD. */
const MOUNTAIN_BASE = 96;
export const SNOW_LINE = 62;
const MOUNTAIN_PEAKS: readonly Peak[] = [
  { x: 30, height: 38 },
  { x: 105, height: 50 },
  { x: 160, height: 34 },
  { x: 245, height: 46 },
  { x: 330, height: 30 },
  { x: 400, height: 54 },
  { x: 470, height: 36 },
  { x: 560, height: 44 },
  { x: 620, height: 32 },
];

/** Top of the mountain range at column x, the highest of the peaks' slopes there. Repeats. */
export function mountainTop(x: number, peaks: readonly Peak[] = MOUNTAIN_PEAKS): number {
  const column = ((x % HILL_PERIOD) + HILL_PERIOD) % HILL_PERIOD;
  const height = peaks.reduce((best, peak) => {
    const away = Math.min(Math.abs(column - peak.x), HILL_PERIOD - Math.abs(column - peak.x));
    return Math.max(best, peak.height - away);
  }, 0);
  return MOUNTAIN_BASE - height;
}

export interface HillLayer {
  base: number;
  waves: readonly { amplitude: number; period: number; phase: number }[];
}

export const FAR_HILLS: HillLayer = {
  base: 92,
  waves: [
    { amplitude: 14, period: 320, phase: 0.6 },
    { amplitude: 7, period: 160, phase: 2.1 },
    { amplitude: 3, period: 64, phase: 4 },
  ],
};

export const NEAR_HILLS: HillLayer = {
  base: 112,
  waves: [
    { amplitude: 9, period: 640, phase: 1.3 },
    { amplitude: 6, period: 128, phase: 0.2 },
    { amplitude: 2, period: 40, phase: 5 },
  ],
};

/** Top edge of a hill layer at column x. Repeats every HILL_PERIOD pixels. */
export function hillTop(layer: HillLayer, x: number): number {
  const wave = layer.waves.reduce(
    (sum, w) => sum + w.amplitude * Math.sin((2 * Math.PI * x) / w.period + w.phase),
    0,
  );
  return Math.round(layer.base - wave);
}

/** Screen x of something at trail position `x` when the trail has scrolled `distance`. */
export function screenX(x: number, distance: number): number {
  return Math.floor(x - distance);
}
