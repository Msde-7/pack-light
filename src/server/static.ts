import { readFile, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** The web bundle sits next to the bundled dist/cli.js, so resolve it from this module's URL. */
export function defaultWebRoot(): string {
  return fileURLToPath(new URL('./web/', import.meta.url));
}

/** Maps a URL path into the web root, or undefined if it tries to leave it. */
function resolveStatic(root: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined;
  const segments = decoded.split('/').filter(part => part !== '');
  if (segments.some(part => part.startsWith('.'))) return undefined;
  const relative = segments.length === 0 ? 'index.html' : segments.join('/');
  const base = resolve(root);
  const full = resolve(base, relative);
  return full.startsWith(base + sep) ? full : undefined;
}

export async function serveStatic(root: string, urlPath: string, res: ServerResponse) {
  const file = resolveStatic(root, urlPath);
  const type = file === undefined ? undefined : TYPES[extname(file).toLowerCase()];
  if (file === undefined || type === undefined) {
    notFound(res);
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) {
      notFound(res);
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': type.startsWith('text/html') ? 'no-store' : 'no-cache',
    });
    res.end(body);
  } catch {
    notFound(res);
  }
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}
