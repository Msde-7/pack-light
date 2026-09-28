export const STEP_SECONDS = 1 / 60;

/** A quarter second of catch-up after a stall, so a hidden tab does not fast-forward. */
const MAX_STEPS = 15;

export interface Clock {
  /** Unspent time, always below one step. */
  carry: number;
}

/** Adds real elapsed time and returns how many fixed updates to run now. */
export function advanceClock(clock: Clock, elapsedSeconds: number, step = STEP_SECONDS): number {
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const total = clock.carry + elapsed;
  // The epsilon keeps float drift from swallowing a step that is due.
  const steps = Math.floor(total / step + 1e-9);
  if (steps > MAX_STEPS) {
    clock.carry = 0;
    return MAX_STEPS;
  }
  clock.carry = Math.max(0, total - steps * step);
  return steps;
}

/**
 * How far the next update has already come, 0 to 1. Drawing that far between the last two
 * updates keeps motion even on any refresh rate, however the updates fall between frames.
 */
export function blendFactor(clock: Clock, step = STEP_SECONDS): number {
  return Math.min(1, Math.max(0, clock.carry / step));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
