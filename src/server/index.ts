import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { paths } from '../core/paths';
import type { HookEvent, ServerInfo } from '../core/protocol';
import type { WindowSettings } from '../core/window';
import { handleApi, sendJson, type ApiContext } from './api';
import { hostAllowed, newToken, originAllowed, requestToken, tokenMatches } from './auth';
import { findRecentTranscripts } from './discover';
import { createSessionHub, type SessionHub } from './hub';
import { loadWindowSettings } from './load-settings';
import { createSseHub } from './sse';
import { CSP, defaultWebRoot, serveStatic } from './static';

export interface ServerOptions {
  /** 0 or undefined picks a free port. */
  port?: number;
  token?: string;
  webRoot?: string;
  settings?: WindowSettings;
  /** Follow transcripts changed in the last `discoverMinutes`. 0 turns discovery off. */
  discoverMinutes?: number;
  projectsDir?: string;
  tickMs?: number;
  now?: () => number;
}

export interface PackLightServer {
  info: ServerInfo;
  url: string;
  hub: SessionHub;
  /** Feeds an event as if a hook had posted it, for the demo. */
  ingest: (event: HookEvent) => Promise<void>;
  /** Forgets a session and tells every open page. */
  removeSession: (sessionId: string) => void;
  close: () => Promise<void>;
}

const DEFAULT_DISCOVER_MINUTES = 60;
const DEFAULT_TICK_MS = 250;
/** Browser URL with the token in the hash, so it never travels in a request. */
export function appUrl(info: Pick<ServerInfo, 'port' | 'token'>): string {
  return `http://127.0.0.1:${info.port}/#token=${info.token}`;
}

function secureHeaders(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
}

function boundPort(address: AddressInfo | string | null): number {
  if (address === null || typeof address === 'string') throw new Error('Server has no TCP port.');
  return address.port;
}

function needsToken(pathname: string): boolean {
  return pathname === '/events' || pathname.startsWith('/api/') || pathname === '/api';
}

export async function startServer(options: ServerOptions = {}): Promise<PackLightServer> {
  const now = options.now ?? Date.now;
  const token = options.token ?? newToken();
  const webRoot = options.webRoot ?? defaultWebRoot();
  const sse = createSseHub();
  const hub = createSessionHub({
    settings: options.settings ?? loadWindowSettings(),
    emit: (state, cues) => {
      sse.session(state, cues);
    },
    now,
  });
  const api: ApiContext = { hub, version: process.env.PACK_LIGHT_VERSION ?? 'dev', now };
  let port = 0;

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    secureHeaders(res);
    if (!hostAllowed(req, port) || !originAllowed(req, port)) {
      sendJson(res, 403, { error: 'Forbidden host.' });
      return;
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (!needsToken(url.pathname)) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed.' });
        return;
      }
      await serveStatic(webRoot, url.pathname, res);
      return;
    }
    if (!tokenMatches(token, requestToken(req, url))) {
      sendJson(res, 401, { error: 'Missing or wrong token.' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      sse.add(res, hub.list());
      return;
    }
    if (!(await handleApi(api, req, res, url))) sendJson(res, 404, { error: 'Not found.' });
  }

  const server = createServer((req, res) => {
    route(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong.' });
      else res.end();
    });
  });
  server.keepAliveTimeout = 5000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = boundPort(server.address());

  let ticking = false;
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void hub.tick().finally(() => {
      ticking = false;
    });
  }, options.tickMs ?? DEFAULT_TICK_MS);
  timer.unref();

  const minutes = options.discoverMinutes ?? DEFAULT_DISCOVER_MINUTES;
  if (minutes > 0) {
    const found = findRecentTranscripts(
      options.projectsDir ?? paths.projects(),
      now() - minutes * 60_000,
    );
    for (const transcript of found) void hub.track(transcript.sessionId, transcript.path);
  }

  const info: ServerInfo = { port, token, pid: process.pid, startedAt: now() };
  return {
    info,
    url: appUrl(info),
    hub,
    ingest: event => hub.ingest(event),
    removeSession(sessionId) {
      if (hub.remove(sessionId)) sse.removed(sessionId);
    },
    close: () =>
      new Promise<void>(resolve => {
        clearInterval(timer);
        sse.close();
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
