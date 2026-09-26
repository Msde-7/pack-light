/**
 * cyrb53, a fast 53-bit string hash. Pure JS so item ids come out the same in Node and the
 * browser, and the same after a rebuild from the transcript.
 */
function cyrb53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function stableItemId(sessionId: string, key: string): string {
  return `i${cyrb53(`${sessionId}\u0000${key}`).toString(36)}`;
}

/** Compares file paths the way the OS would, so Windows drive paths ignore case and slash style. */
export function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(slashed) ? slashed.toLowerCase() : slashed;
}

export function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] ?? path;
}
