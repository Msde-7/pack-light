import { describe, expect, it } from 'vitest';
import { STEP_SECONDS, advanceClock, blendFactor, lerp } from './timestep';

describe('advanceClock', () => {
  it('runs one update per 1/60 s and carries the rest', () => {
    const clock = { carry: 0 };
    expect(advanceClock(clock, STEP_SECONDS * 2.5)).toBe(2);
    expect(clock.carry).toBeCloseTo(STEP_SECONDS / 2);
    expect(advanceClock(clock, STEP_SECONDS / 2)).toBe(1);
    expect(clock.carry).toBeCloseTo(0);
  });

  it('waits when less than a step has passed', () => {
    const clock = { carry: 0 };
    expect(advanceClock(clock, 0.01)).toBe(0);
    expect(clock.carry).toBeCloseTo(0.01);
  });

  it('caps catch-up after a long stall and drops the backlog', () => {
    const clock = { carry: 0 };
    expect(advanceClock(clock, 10)).toBe(15);
    expect(clock.carry).toBe(0);
  });

  it('ignores negative or broken time', () => {
    const clock = { carry: 0 };
    expect(advanceClock(clock, -1)).toBe(0);
    expect(advanceClock(clock, Number.NaN)).toBe(0);
  });
});

describe('blendFactor', () => {
  it('is the share of a step already carried', () => {
    expect(blendFactor({ carry: STEP_SECONDS / 4 })).toBeCloseTo(0.25);
    expect(blendFactor({ carry: 0 })).toBe(0);
  });

  it('moves a blended position evenly on a 144 Hz display', () => {
    const clock = { carry: 0 };
    let previous = 0;
    let current = 0;
    const drawn: number[] = [];
    for (let frame = 0; frame < 48; frame++) {
      const steps = advanceClock(clock, 1 / 144);
      for (let i = 0; i < steps; i++) {
        previous = current;
        current += 40 * STEP_SECONDS;
      }
      drawn.push(lerp(previous, current, blendFactor(clock)));
    }
    const deltas = drawn.slice(1).map((x, i) => x - (drawn[i] ?? 0));
    for (const delta of deltas.slice(4)) expect(delta).toBeCloseTo(40 / 144, 6);
  });
});
