/** Short human count such as 950, 9.1K, 142K or 1M. */
export function compactNumber(value: number): string {
  const n = Math.max(0, Math.round(value));
  if (n < 1000) return String(n);
  if (n < 10_000) return `${trimZero((n / 1000).toFixed(1))}K`;
  if (n < 999_500) return `${Math.round(n / 1000)}K`;
  return `${trimZero((n / 1_000_000).toFixed(1))}M`;
}

function trimZero(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

/** Token counts are estimates, so they always carry the ≈ prefix. */
export function formatTokens(tokens: number): string {
  return `≈${compactNumber(tokens)}`;
}

export function percent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

/** "1 pin", "3 pins". Only for nouns that take a plain s. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
