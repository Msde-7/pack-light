import { describe, expect, it } from 'vitest';
import { plural } from './format';

describe('plural', () => {
  it('adds an s past one', () => {
    expect(plural(1, 'slot')).toBe('1 slot');
    expect(plural(3, 'slot')).toBe('3 slots');
  });
});
