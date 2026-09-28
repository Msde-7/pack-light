import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  packForFill,
  poseForFill,
  signCrossed,
  signForFill,
  signStillDue,
  walkSpeed,
} from './motion';

describe('walkSpeed', () => {
  it('walks at full pace with an empty pack', () => {
    expect(walkSpeed(0)).toBe(BASE_SPEED);
  });

  it('follows v0 * (1 - 0.8 * fill^1.5)', () => {
    expect(walkSpeed(0.5, 100)).toBeCloseTo(100 * (1 - 0.8 * 0.5 ** 1.5));
  });

  it('never drops below a quarter pace', () => {
    expect(walkSpeed(1, 100)).toBe(25);
    expect(walkSpeed(5, 100)).toBe(25);
  });

  it('slows down as the pack fills', () => {
    const speeds = [0, 0.2, 0.4, 0.6, 0.8].map(fill => walkSpeed(fill));
    expect([...speeds].sort((a, b) => b - a)).toEqual(speeds);
  });

  it('treats a broken fill as empty', () => {
    expect(walkSpeed(Number.NaN)).toBe(BASE_SPEED);
  });
});

describe('poses and packs', () => {
  it('gets tired at 0.75 and exhausted at 0.9', () => {
    expect(poseForFill(0.74)).toBe('walk');
    expect(poseForFill(0.75)).toBe('tired');
    expect(poseForFill(0.89)).toBe('tired');
    expect(poseForFill(0.9)).toBe('exhausted');
  });

  it('grows the pack at each quarter', () => {
    expect(packForFill(0.1)).toBe('pack_s');
    expect(packForFill(0.25)).toBe('pack_m');
    expect(packForFill(0.5)).toBe('pack_l');
    expect(packForFill(0.75)).toBe('pack_xl');
  });
});

describe('trail signs', () => {
  it('names the sign for the highest threshold reached', () => {
    expect(signForFill(0.59)).toBeUndefined();
    expect(signForFill(0.6)).toBe('trail_sign_60');
    expect(signForFill(0.8)).toBe('trail_sign_75');
    expect(signForFill(0.95)).toBe('trail_sign_90');
  });

  it('posts a sign only when fill rises past a threshold', () => {
    expect(signCrossed(0.5, 0.62)).toBe('trail_sign_60');
    expect(signCrossed(0.62, 0.7)).toBeUndefined();
    expect(signCrossed(0.95, 0.3)).toBeUndefined();
  });

  it('posts only the highest sign when several are passed at once', () => {
    expect(signCrossed(0.1, 0.92)).toBe('trail_sign_90');
  });
});

describe('signStillDue', () => {
  it('keeps a sign only while fill stays at or above its threshold', () => {
    expect(signStillDue('trail_sign_75', 0.8)).toBe(true);
    expect(signStillDue('trail_sign_75', 0.75)).toBe(true);
    expect(signStillDue('trail_sign_75', 0.3)).toBe(false);
  });
});
