import { TOKEN_HEADER } from '../../core/protocol';
import type { ExcerptResponse, PinRequest, ServerMessage } from '../../core/protocol';
import type { SessionState } from '../../core/types';
import { isExcerpt, isServerMessage, isSessionList } from './guards';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`Request failed with ${status}`);
  }
}

export interface Api {
  sessions(): Promise<SessionState[]>;
  pin(sessionId: string, itemId: string, body: PinRequest): Promise<void>;
  unpin(sessionId: string, itemId: string): Promise<void>;
  orderPins(sessionId: string, itemIds: string[]): Promise<void>;
  repack(sessionId: string, itemIds: string[]): Promise<void>;
  excerpt(sessionId: string, itemId: string, start: number, end: number): Promise<ExcerptResponse>;
}

export function createApi(token: string): Api {
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const headers: Record<string, string> = { [TOKEN_HEADER]: token };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new ApiError(response.status);
    const text = await response.text();
    return text === '' ? undefined : (JSON.parse(text) as unknown);
  };
  const sessionPath = (id: string): string => `/api/sessions/${encodeURIComponent(id)}`;
  const pinPath = (id: string, itemId: string): string =>
    `${sessionPath(id)}/pins/${encodeURIComponent(itemId)}`;

  return {
    async sessions() {
      const value = await call('GET', '/api/sessions');
      if (!isSessionList(value)) throw new Error('Unexpected sessions payload');
      return value;
    },
    async pin(sessionId, itemId, body) {
      await call('PUT', pinPath(sessionId, itemId), body);
    },
    async unpin(sessionId, itemId) {
      await call('DELETE', pinPath(sessionId, itemId));
    },
    async orderPins(sessionId, itemIds) {
      await call('PUT', `${sessionPath(sessionId)}/pins-order`, { itemIds });
    },
    async repack(sessionId, itemIds) {
      await call('POST', `${sessionPath(sessionId)}/repack`, { itemIds });
    },
    async excerpt(sessionId, itemId, start, end) {
      const query = new URLSearchParams({ start: String(start), end: String(end) });
      const value = await call(
        'GET',
        `${sessionPath(sessionId)}/items/${encodeURIComponent(itemId)}/excerpt?${query.toString()}`,
      );
      if (!isExcerpt(value)) throw new Error('Unexpected excerpt payload');
      return value;
    },
  };
}

export interface StreamHandlers {
  onMessage(message: ServerMessage): void;
  onStatus(status: 'live' | 'reconnecting'): void;
}

const EVENT_NAMES = ['snapshot', 'session', 'removed', 'cue'] as const;
const MAX_BACKOFF_MS = 10_000;

/**
 * Keeps one EventSource open. The browser retries dropped streams itself, but gives up for good
 * on an HTTP error, so a closed stream gets a fresh EventSource with backoff.
 */
export function connectStream(token: string, handlers: StreamHandlers): () => void {
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backoff = 1000;
  let stopped = false;

  const onEvent = (event: MessageEvent<unknown>): void => {
    const message = parseMessage(event.type, event.data);
    if (message) handlers.onMessage(message);
  };

  const open = (): void => {
    source = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
    source.onopen = () => {
      backoff = 1000;
      handlers.onStatus('live');
    };
    source.onerror = () => {
      handlers.onStatus('reconnecting');
      if (source?.readyState !== EventSource.CLOSED || stopped) return;
      timer = setTimeout(open, backoff);
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
    };
    source.onmessage = onEvent;
    for (const name of EVENT_NAMES) source.addEventListener(name, onEvent);
  };

  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
  };
}

/** Accepts the full message as data, or a body without `type` under a named event. */
export function parseMessage(eventName: string, data: unknown): ServerMessage | undefined {
  if (typeof data !== 'string') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (isServerMessage(value)) return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const typed: unknown = { type: eventName, ...value };
  return isServerMessage(typed) ? typed : undefined;
}
