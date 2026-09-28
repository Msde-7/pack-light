import type { PackSize } from '../sprites/art/pack';

export type Pose = 'walk' | 'tired' | 'exhausted';

/** Walking speed at fill 0, in scene pixels per second. */
export const BASE_SPEED = 40;

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** A full pack slows the hiker to a quarter of their fresh pace, never to a stop. */
export function walkSpeed(fill: number, v0 = BASE_SPEED): number {
  return v0 * Math.max(0.25, 1 - 0.8 * clamp01(fill) ** 1.5);
}

export function poseForFill(fill: number): Pose {
  const f = clamp01(fill);
  if (f >= 0.9) return 'exhausted';
  if (f >= 0.75) return 'tired';
  return 'walk';
}

export function packForFill(fill: number): PackSize {
  const f = clamp01(fill);
  if (f < 0.25) return 'pack_s';
  if (f < 0.5) return 'pack_m';
  if (f < 0.75) return 'pack_l';
  return 'pack_xl';
}

const TRAIL_SIGNS = [
  { at: 0.6, sprite: 'trail_sign_60' },
  { at: 0.75, sprite: 'trail_sign_75' },
  { at: 0.9, sprite: 'trail_sign_90' },
] as const;

export type TrailSign = (typeof TRAIL_SIGNS)[number]['sprite'];

/** The sign for the highest threshold at or below this fill, if any. */
export function signForFill(fill: number): TrailSign | undefined {
  const f = clamp01(fill);
  return TRAIL_SIGNS.filter(sign => f >= sign.at).at(-1)?.sprite;
}

/** A sign only makes sense while the fill is still at or above its threshold, so camp clears them. */
export function signStillDue(sign: TrailSign, fill: number): boolean {
  return TRAIL_SIGNS.some(entry => entry.sprite === sign && clamp01(fill) >= entry.at);
}

/** The sign to put on the trail when fill rises past a threshold. Only the highest one crossed. */
export function signCrossed(previous: number, next: number): TrailSign | undefined {
  const from = clamp01(previous);
  const to = clamp01(next);
  return TRAIL_SIGNS.filter(sign => from < sign.at && to >= sign.at).at(-1)?.sprite;
}
