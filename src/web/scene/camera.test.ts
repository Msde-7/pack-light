import { describe, expect, it } from 'vitest';
import { groundView, layerShift, stripShift } from './camera';

describe('layerShift', () => {
  it('rounds to device pixels, so 4x scrolls in quarter pixel steps', () => {
    expect(layerShift(10.3, 1, 4)).toBe(41);
    expect(layerShift(10.3, 1, 1)).toBe(10);
    expect(layerShift(100, 0.12, 4)).toBe(48);
  });

  it('advances evenly when the camera does', () => {
    const steps = Array.from({ length: 12 }, (_, i) => layerShift(i * 0.5, 1, 4));
    const deltas = steps.slice(1).map((shift, i) => shift - (steps[i] ?? 0));
    expect(new Set(deltas)).toEqual(new Set([2]));
  });
});

describe('stripShift', () => {
  it('wraps into one period of device pixels', () => {
    expect(stripShift(1000, 0.3, 1, 640)).toBe(300);
    expect(stripShift(700, 1, 2, 640)).toBe(120);
    expect(stripShift(-10, 1, 1, 16)).toBe(6);
  });
});

describe('groundView', () => {
  it('splits the shift into whole scene pixels and a device remainder', () => {
    expect(groundView(10.3, 4)).toEqual({ origin: 10, slide: 1 });
    expect(groundView(10.9, 4)).toEqual({ origin: 11, slide: 0 });
    expect(groundView(-0.3, 4)).toEqual({ origin: -1, slide: 3 });
  });

  it('puts a prop exactly where the tiles under it go', () => {
    for (const camera of [0, 3.37, 51.8, 999.99]) {
      const { origin, slide } = groundView(camera, 3);
      expect((200 - origin) * 3 - slide).toBe(200 * 3 - layerShift(camera, 1, 3));
    }
  });
});
