import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { TOKEN_HEADER } from '../core/protocol';

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Hashing first gives equal lengths, so timingSafeEqual never leaks the token length. */
export function tokenMatches(expected: string, given: string | undefined): boolean {
  if (given === undefined || given === '') return false;
  return timingSafeEqual(digest(expected), digest(given));
}

export function requestToken(req: IncomingMessage, url: URL): string | undefined {
  const header = req.headers[TOKEN_HEADER];
  if (typeof header === 'string') return header;
  return url.searchParams.get('token') ?? undefined;
}

/** Only our own origin may talk to us. Blocks DNS rebinding through a foreign Host header. */
export function hostAllowed(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** Browsers send Origin on cross-site requests. When present it must be our own. */
export function originAllowed(req: IncomingMessage, port: number): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}
