import type { ServerMessage } from '../../core/protocol';
import type { SessionState } from '../../core/types';
import type { AgentFilter } from './inventory-model';
import type { Prefs } from './prefs';

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'no_token' | 'denied';

export interface AppState extends Prefs {
  connection: Connection;
  sessions: SessionState[];
  sessionId?: string;
  agent: AgentFilter;
  itemId?: string;
  /** Items lit up by clicking a trail tip. */
  highlightIds: string[];
  lostSelection: string[];
}

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: (state: T, previous: T) => void): () => void;
}

/**
 * `derive` fixes up dependent fields before listeners run, so no listener ever sees a state
 * that another listener is about to correct.
 */
export function createStore<T extends object>(
  initial: T,
  derive: (state: T) => T = s => s,
): Store<T> {
  let state = derive(initial);
  const listeners = new Set<(state: T, previous: T) => void>();
  return {
    get: () => state,
    set(patch) {
      const previous = state;
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = derive({ ...state, ...next });
      for (const listener of listeners) listener(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Applies one server message to the session list. Cues do not change state. */
export function applyMessage(sessions: SessionState[], message: ServerMessage): SessionState[] {
  switch (message.type) {
    case 'snapshot':
      return message.sessions;
    case 'session': {
      const found = sessions.some(s => s.sessionId === message.session.sessionId);
      if (!found) return [...sessions, message.session];
      return sessions.map(s => (s.sessionId === message.session.sessionId ? message.session : s));
    }
    case 'removed':
      return sessions.filter(s => s.sessionId !== message.sessionId);
    case 'cue':
      return sessions;
  }
}

/** Keeps the current selection when it still exists, else picks the liveliest session. */
export function pickSession(
  sessions: readonly SessionState[],
  current?: string,
): string | undefined {
  if (current !== undefined && sessions.some(s => s.sessionId === current)) return current;
  const live = sessions.filter(s => s.phase !== 'done');
  const pool = live.length > 0 ? live : sessions;
  return [...pool].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.sessionId;
}

/** Tabs show live sessions first, then the most recently started. */
export function orderSessions(sessions: readonly SessionState[]): SessionState[] {
  return [...sessions].sort(
    (a, b) => Number(a.phase === 'done') - Number(b.phase === 'done') || b.startedAt - a.startedAt,
  );
}

/** Keeps the session selection valid as sessions come and go. */
export function deriveState(state: AppState): AppState {
  const sessionId = pickSession(state.sessions, state.sessionId);
  return sessionId === state.sessionId
    ? state
    : { ...state, sessionId, itemId: undefined, agent: undefined };
}

export function currentSession(state: AppState): SessionState | undefined {
  return state.sessions.find(s => s.sessionId === state.sessionId);
}
