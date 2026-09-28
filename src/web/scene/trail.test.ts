import { describe, expect, it } from 'vitest';
import {
  FAR_HILLS,
  HILL_PERIOD,
  NEAR_HILLS,
  hillTop,
  mountainTop,
  propAt,
  propsInView,
  screenX,
} from './trail';

describe('props', () => {
  it('grows the same props on the same stretch of trail', () => {
    expect(propsInView(1234)).toEqual(propsInView(1234));
    expect(propAt(7)).toEqual(propAt(7));
  });

  it('returns only props overlapping the view', () => {
    for (const prop of propsInView(5000, 320)) {
      expect(prop.x + 16).toBeGreaterThan(5000);
      expect(prop.x).toBeLessThan(5320);
    }
    expect(propsInView(5000).length).toBeGreaterThan(2);
  });

  it('keeps props apart so they never stack', () => {
    const props = propsInView(0, 5000);
    props.slice(1).forEach((prop, i) => {
      expect(prop.x - (props[i]?.x ?? 0)).toBeGreaterThanOrEqual(16);
    });
  });
});

describe('hills and mountains', () => {
  it('repeat every period so the strips tile', () => {
    for (const x of [0, 17, 333]) {
      expect(hillTop(FAR_HILLS, x)).toBe(hillTop(FAR_HILLS, x + HILL_PERIOD));
      expect(hillTop(NEAR_HILLS, x)).toBe(hillTop(NEAR_HILLS, x + HILL_PERIOD));
      expect(mountainTop(x)).toBe(mountainTop(x + HILL_PERIOD));
    }
  });

  it('slopes one pixel per column away from a peak', () => {
    const peak = [{ x: 10, height: 30 }];
    expect(mountainTop(11, peak)).toBe(mountainTop(10, peak) + 1);
    expect(mountainTop(9, peak)).toBe(mountainTop(10, peak) + 1);
  });
});

describe('scrolling', () => {
  it('maps trail positions to whole screen pixels', () => {
    expect(screenX(100.7, 50.2)).toBe(50);
  });
});
