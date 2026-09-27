import type { ServerResponse } from 'node:http';
import type { SceneCue, ServerMessage } from '../core/protocol';
import type { SessionState } from '../core/types';

const THROTTLE_MS = 100;
const HEARTBEAT_MS = 15_000;

export interface SseHub {
  /** Registers a client and sends it the snapshot first. */
  add: (res: ServerResponse, snapshot: SessionState[]) => void;
  /** Queues a session update. The first goes out at once, later ones at most every 100 ms. */
  session: (state: SessionState, cues: readonly SceneCue[]) => void;
  removed: (sessionId: string) => void;
  close: () => void;
  readonly clients: number;
}

interface Pending {
  state: SessionState;
  cues: SceneCue[];
  timer?: NodeJS.Timeout;
}

function formatMessage(message: ServerMessage): string {
  return `event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`;
}

export function createSseHub(): SseHub {
  const clients = new Set<ServerResponse>();
  const pending = new Map<string, Pending>();
  const lastSent = new Map<string, number>();

  function write(text: string): void {
    for (const res of clients) res.write(text);
  }

  function flush(sessionId: string): void {
    const queued = pending.get(sessionId);
    if (!queued) return;
    pending.delete(sessionId);
    lastSent.set(sessionId, Date.now());
    write(formatMessage({ type: 'session', session: queued.state }));
    for (const cue of queued.cues) write(formatMessage({ type: 'cue', sessionId, cue }));
  }

  const heartbeat = setInterval(() => {
    write(': heartbeat\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    get clients() {
      return clients.size;
    },
    add(res, snapshot) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      res.write(formatMessage({ type: 'snapshot', sessions: snapshot }));
      clients.add(res);
      res.on('close', () => clients.delete(res));
    },
    session(state, cues) {
      const { sessionId } = state;
      const queued = pending.get(sessionId);
      if (queued) {
        queued.state = state;
        queued.cues.push(...cues);
        return;
      }
      const entry: Pending = { state, cues: [...cues] };
      pending.set(sessionId, entry);
      const wait = THROTTLE_MS - (Date.now() - (lastSent.get(sessionId) ?? 0));
      if (wait <= 0) {
        flush(sessionId);
        return;
      }
      entry.timer = setTimeout(() => {
        flush(sessionId);
      }, wait);
    },
    removed(sessionId) {
      const queued = pending.get(sessionId);
      if (queued?.timer) clearTimeout(queued.timer);
      pending.delete(sessionId);
      lastSent.delete(sessionId);
      write(formatMessage({ type: 'removed', sessionId }));
    },
    close() {
      clearInterval(heartbeat);
      for (const queued of pending.values()) {
        if (queued.timer) clearTimeout(queued.timer);
      }
      pending.clear();
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
