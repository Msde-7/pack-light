import { describe, expect, it, vi } from 'vitest';
import { applyMessage, createStore, deriveState, orderSessions, pickSession } from './store';
import { makeSession, makeState } from './testing';

const base = makeState();

describe('createStore', () => {
  it('merges patches and tells listeners the previous state', () => {
    const store = createStore({ a: 1, b: 2 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ a: 5 });
    store.set(s => ({ b: s.a + 1 }));
    expect(store.get()).toEqual({ a: 5, b: 6 });
    expect(listener).toHaveBeenNthCalledWith(1, { a: 5, b: 2 }, { a: 1, b: 2 });
  });

  it('derives before any listener runs', () => {
    const store = createStore({ n: 1, double: 0 }, s => ({ ...s, double: s.n * 2 }));
    const seen: number[] = [];
    store.subscribe(s => seen.push(s.double));
    store.set({ n: 4 });
    expect(seen).toEqual([8]);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore({ n: 1 });
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();
    store.set({ n: 2 });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('applyMessage', () => {
  const one = makeSession({ sessionId: 'one' });
  const two = makeSession({ sessionId: 'two' });

  it('replaces everything on a snapshot', () => {
    expect(applyMessage([one], { type: 'snapshot', sessions: [two] })).toEqual([two]);
  });

  it('adds or updates a session', () => {
    const updated = { ...one, turn: 9 };
    expect(applyMessage([one], { type: 'session', session: two })).toEqual([one, two]);
    expect(applyMessage([one, two], { type: 'session', session: updated })).toEqual([updated, two]);
  });

  it('removes a session and ignores cues', () => {
    expect(applyMessage([one, two], { type: 'removed', sessionId: 'one' })).toEqual([two]);
    const sessions = [one];
    expect(applyMessage(sessions, { type: 'cue', sessionId: 'one', cue: { cue: 'cheer' } })).toBe(
      sessions,
    );
  });
});

describe('session selection', () => {
  const done = makeSession({ sessionId: 'done', phase: 'done', updatedAt: 99, startedAt: 9 });
  const old = makeSession({ sessionId: 'old', updatedAt: 1, startedAt: 1 });
  const fresh = makeSession({ sessionId: 'fresh', updatedAt: 5, startedAt: 5 });

  it('keeps a selection that still exists', () => {
    expect(pickSession([done, old, fresh], 'old')).toBe('old');
  });

  it('prefers the most recently active live session', () => {
    expect(pickSession([done, old, fresh], 'gone')).toBe('fresh');
    expect(pickSession([done])).toBe('done');
    expect(pickSession([])).toBeUndefined();
  });

  it('orders tabs live first, newest first', () => {
    expect(orderSessions([done, old, fresh]).map(s => s.sessionId)).toEqual([
      'fresh',
      'old',
      'done',
    ]);
  });

  it('clears item and agent when the session changes under them', () => {
    const state = deriveState({
      ...base,
      sessions: [old],
      sessionId: 'gone',
      itemId: 'x',
      agent: 'a',
    });
    expect(state).toMatchObject({ sessionId: 'old', itemId: undefined, agent: undefined });
    const same = { ...base, sessions: [old], sessionId: 'old', itemId: 'x' };
    expect(deriveState(same)).toBe(same);
  });
});
