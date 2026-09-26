import { expect, it } from 'vitest';
import { compactNumber, formatTokens, percent } from './format';

it('formats counts compactly with the estimate prefix', () => {
  expect(compactNumber(950)).toBe('950');
  expect(compactNumber(9140)).toBe('9.1K');
  expect(compactNumber(2000)).toBe('2K');
  expect(compactNumber(142_300)).toBe('142K');
  expect(compactNumber(999_700)).toBe('1M');
  expect(compactNumber(1_250_000)).toBe('1.3M');
  expect(formatTokens(142_000)).toBe('≈142K');
  expect(percent(0.714)).toBe('71%');
  expect(percent(3)).toBe('100%');
});

it('handles zero, negatives and rounding at the unit edges', () => {
  expect(compactNumber(0)).toBe('0');
  expect(compactNumber(-5)).toBe('0');
  expect(compactNumber(999)).toBe('999');
  expect(compactNumber(9960)).toBe('10K');
  expect(compactNumber(999_499)).toBe('999K');
  expect(compactNumber(999_500)).toBe('1M');
  expect(percent(1.4)).toBe('100%');
  expect(percent(-1)).toBe('0%');
});
