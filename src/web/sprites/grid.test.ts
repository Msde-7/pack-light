import { describe, expect, it } from 'vitest';
import { textGrid } from './font';
import { bayer, blankGrid, opaqueBounds, stamp } from './grid';

describe('grid helpers', () => {
  it('stamps opaque pixels and clips at the edges', () => {
    expect(stamp(blankGrid(4, 2), ['ab', '.c'], 3, 1)).toEqual(['....', '...a']);
    expect(stamp(['xxxx'], ['a.b'], 0, 0)).toEqual(['axbx']);
  });

  it('measures the opaque box', () => {
    expect(opaqueBounds(['....', '.ab.', '..c.'])).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(opaqueBounds(['..'])).toBeUndefined();
  });

  it('reads the 4x4 dither matrix and wraps', () => {
    expect(bayer(0, 0)).toBe(0);
    expect(bayer(1, 0)).toBe(8);
    expect(bayer(5, 4)).toBe(8);
  });
});

describe('font', () => {
  it('renders 3x5 glyphs with a one pixel gap', () => {
    const text = textGrid('x2', 'w');
    expect(text).toHaveLength(5);
    expect(text[0]).toHaveLength(7);
    expect(text[1]).toBe('w.w...w');
  });
});
