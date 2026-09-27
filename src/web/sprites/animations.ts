export interface Animation {
  frames: readonly string[];
  /** Frames per second when played on the clock, or at a fresh walking pace for a gait. */
  fps: number;
}

/** A walk cycle played by distance, so the feet keep pace with the ground whatever the speed. */
export interface Gait extends Animation {
  /** Scene pixels walked in one full cycle, two steps. */
  stride: number;
  /** Frames where a foot lands. */
  footfalls: readonly number[];
}

const frames = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}_${i + 1}`);

export const ANIMATIONS = {
  walk: { frames: frames('hiker_walk', 6), fps: 15, stride: 16, footfalls: [0, 3] },
  tired: { frames: frames('hiker_tired', 4), fps: 6, stride: 12, footfalls: [0, 2] },
  exhausted: { frames: frames('hiker_exhausted', 2), fps: 2.5 },
  camp: { frames: frames('hiker_camp', 2), fps: 2 },
  buddy: { frames: frames('buddy_walk', 6), fps: 20, stride: 12, footfalls: [0, 3] },
  campfire: { frames: frames('campfire', 3), fps: 6 },
} satisfies Record<string, Animation | Gait>;

/** Frame of an animation at a time in seconds. */
export function animationFrame(animation: Animation, seconds: number): string {
  const index = Math.floor(Math.max(0, seconds) * animation.fps) % animation.frames.length;
  return animation.frames[index] ?? '';
}

/** Index of a gait's frame after walking `walked` scene pixels. */
export function gaitIndex(gait: Gait, walked: number): number {
  const count = gait.frames.length;
  const index = Math.floor((walked / gait.stride) * count) % count;
  return index < 0 ? index + count : index;
}

export function gaitFrame(gait: Gait, walked: number): string {
  return gait.frames[gaitIndex(gait, walked)] ?? '';
}
