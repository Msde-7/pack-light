import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseJson } from '../core/json';
import { queueRepack, removePin, reorderPins, upsertPin } from '../core/keep-list';
import { readPins, readRepack, writePins, writeRepack } from '../core/store';
import type { Item, Pin, SessionState } from '../core/types';
import { readExcerpt } from './excerpt';
import type { SessionHub } from './hub';
import { parseHookEvent, parseIdList, parsePinRequest } from './validate';

const EVENT_BODY_LIMIT = 256 * 1024;
const API_BODY_LIMIT = 64 * 1024;

export interface ApiContext {
  hub: SessionHub;
  version: string;
  now: () => number;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function fail(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { error });
}

const TOO_LARGE = new Error('Request body too large');

function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(TOO_LARGE);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve(text.trim() === '' ? undefined : parseJson(text));
    });
    req.on('error', reject);
  });
}

async function body(req: IncomingMessage, res: ServerResponse, limit: number) {
  try {
    return { ok: true as const, value: await readBody(req, limit) };
  } catch (error) {
    fail(res, error === TOO_LARGE ? 413 : 400, 'Could not read the request body.');
    return { ok: false as const };
  }
}

async function postEvent(ctx: ApiContext, req: IncomingMessage, res: ServerResponse) {
  const raw = await body(req, res, EVENT_BODY_LIMIT);
  if (!raw.ok) return;
  const event = parseHookEvent(raw.value);
  if (!event) {
    fail(res, 400, 'Not a valid event.');
    return;
  }
  // Hooks wait at most 300 ms, so answer first and let a long transcript catch-up run after.
  res.writeHead(204).end();
  void ctx.hub.ingest(event).catch(() => undefined);
}

function findItem(session: SessionState, itemId: string): Item | undefined {
  return session.items.find(item => item.id === itemId);
}

async function putPin(
  ctx: ApiContext,
  session: SessionState,
  itemId: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const raw = await body(req, res, API_BODY_LIMIT);
  if (!raw.ok) return;
  const request = parsePinRequest(raw.value);
  if (!request.ok) {
    fail(res, 400, request.error);
    return;
  }
  const item = findItem(session, itemId);
  if (!item) {
    fail(res, 404, 'No such item in this session.');
    return;
  }
  if (request.value.snippet !== undefined && item.path === undefined) {
    fail(res, 400, 'Snippets are only kept for file items.');
    return;
  }
  const pins = upsertPin(readPins(session.sessionId), item, request.value, ctx.now());
  savePins(ctx, session.sessionId, pins, res);
}

function savePins(ctx: ApiContext, sessionId: string, pins: readonly Pin[], res: ServerResponse) {
  writePins(sessionId, pins);
  ctx.hub.reloadStore(sessionId);
  sendJson(res, 200, { pins });
}

async function putOrder(
  ctx: ApiContext,
  session: SessionState,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const raw = await body(req, res, API_BODY_LIMIT);
  if (!raw.ok) return;
  const itemIds = parseIdList(raw.value);
  if (!itemIds) {
    fail(res, 400, 'Expected itemIds.');
    return;
  }
  savePins(ctx, session.sessionId, reorderPins(readPins(session.sessionId), itemIds), res);
}

async function postRepack(
  ctx: ApiContext,
  session: SessionState,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const raw = await body(req, res, API_BODY_LIMIT);
  if (!raw.ok) return;
  const itemIds = parseIdList(raw.value);
  const items = (itemIds ?? []).flatMap(id => {
    const item = findItem(session, id);
    return item && (item.status === 'dropped' || item.status === 'repack_queued') ? [item] : [];
  });
  if (items.length === 0) {
    fail(res, 400, 'Only dropped items can be repacked.');
    return;
  }
  const entries = queueRepack(readRepack(session.sessionId), items);
  writeRepack(session.sessionId, entries);
  ctx.hub.reloadStore(session.sessionId);
  sendJson(res, 200, { entries });
}

async function getExcerpt(session: SessionState, itemId: string, url: URL, res: ServerResponse) {
  const item = findItem(session, itemId);
  if (!item) {
    fail(res, 404, 'No such item in this session.');
    return;
  }
  const result = await readExcerpt(item, url.searchParams);
  if (result.ok) sendJson(res, 200, result.excerpt);
  else fail(res, result.status, result.error);
}

function segments(pathname: string): string[] | undefined {
  try {
    return pathname
      .split('/')
      .filter(part => part !== '')
      .map(decodeURIComponent);
  } catch {
    return undefined;
  }
}

interface RouteArgs {
  ctx: ApiContext;
  session: SessionState;
  itemId: string;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
}

type RouteHandler = (args: RouteArgs) => Promise<void> | void;

/** Keyed by method and the path after /api/sessions/:id, with `:item` for an item id. */
const SESSION_ROUTES: Record<string, RouteHandler> = {
  'PUT pins/:item': a => putPin(a.ctx, a.session, a.itemId, a.req, a.res),
  'DELETE pins/:item': a => {
    const { sessionId } = a.session;
    savePins(a.ctx, sessionId, removePin(readPins(sessionId), a.itemId), a.res);
  },
  'PUT pins-order': a => putOrder(a.ctx, a.session, a.req, a.res),
  'POST repack': a => postRepack(a.ctx, a.session, a.req, a.res),
  'GET items/:item/excerpt': a => getExcerpt(a.session, a.itemId, a.url, a.res),
};

function routeKey(method: string, rest: readonly string[]): string {
  const [resource, itemId, action] = rest;
  const tail = [resource, itemId === undefined ? undefined : ':item', action];
  return `${method} ${tail.filter(part => part !== undefined).join('/')}`;
}

async function sessionRoute(
  ctx: ApiContext,
  parts: readonly string[],
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const [, , sessionId, ...rest] = parts;
  const handler = SESSION_ROUTES[routeKey(req.method ?? 'GET', rest)];
  if (sessionId === undefined || rest.length > 3 || !handler) return false;
  const session = ctx.hub.get(sessionId);
  if (!session) {
    fail(res, 404, 'No such session.');
    return true;
  }
  await handler({ ctx, session, itemId: rest[1] ?? '', req, res, url });
  return true;
}

/** Handles an authenticated API request. Returns false when no route matched. */
export async function handleApi(
  ctx: ApiContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const parts = segments(url.pathname);
  if (!parts) return false;
  const method = req.method ?? 'GET';
  const path = `/${parts.join('/')}`;
  if (method === 'GET' && path === '/api/health') {
    sendJson(res, 200, { ok: true, version: ctx.version });
    return true;
  }
  if (method === 'POST' && path === '/events') {
    await postEvent(ctx, req, res);
    return true;
  }
  if (method === 'GET' && path === '/api/sessions') {
    sendJson(res, 200, ctx.hub.list());
    return true;
  }
  if (parts[0] === 'api' && parts[1] === 'sessions') return sessionRoute(ctx, parts, req, res, url);
  return false;
}
