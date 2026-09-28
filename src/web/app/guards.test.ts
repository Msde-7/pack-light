import { describe, expect, it } from 'vitest';
import { parseMessage } from './api';
import { isExcerpt, isItem, isServerMessage, isSessionState } from './guards';
import { makeItem, makeSession } from './testing';

const session = makeSession({
  items: [makeItem({ id: 'a' }), makeItem({ id: 'b', agentId: 'x', duplicateOf: 'a' })],
  subagents: {
    x: { agentId: 'x', agentType: 'Explore', status: 'active', items: ['b'], hat: 2 },
  },
  compactions: [{ at: 1, trigger: 'auto', before: 900, after: 100, droppedIds: ['a'] }],
  pins: [{ itemId: 'a', kind: 'file_read', label: 'src/a.ts', note: 'why', pinnedAt: 3 }],
  tips: [
    { id: 't', kind: 'carried_twice', text: 'read twice', itemIds: ['a', 'b'], wastedTokens: 5 },
  ],
});

describe('isSessionState', () => {
  it('accepts a full session', () => {
    expect(isSessionState(JSON.parse(JSON.stringify(session)))).toBe(true);
  });

  it('rejects wrong shapes', () => {
    expect(isSessionState({ ...session, phase: 'sprinting' })).toBe(false);
    expect(isSessionState({ ...session, fill: 'high' })).toBe(false);
    expect(isSessionState({ ...session, items: [{ id: 'a' }] })).toBe(false);
    expect(isSessionState({ ...session, subagents: { x: { agentId: 'x' } } })).toBe(false);
    expect(isSessionState(null)).toBe(false);
  });
});

describe('isItem', () => {
  it('checks optional fields when present', () => {
    expect(isItem(makeItem({ id: 'a', stale: true }))).toBe(true);
    expect(isItem({ ...makeItem({ id: 'a' }), stale: 'yes' })).toBe(false);
    expect(isItem({ ...makeItem({ id: 'a' }), tokensEst: Number.NaN })).toBe(false);
  });
});

describe('isServerMessage', () => {
  it('accepts every message type', () => {
    expect(isServerMessage({ type: 'snapshot', sessions: [session] })).toBe(true);
    expect(isServerMessage({ type: 'session', session })).toBe(true);
    expect(isServerMessage({ type: 'removed', sessionId: 's1' })).toBe(true);
    expect(
      isServerMessage({
        type: 'cue',
        sessionId: 's1',
        cue: { cue: 'item_added', itemId: 'a', duplicate: false },
      }),
    ).toBe(true);
  });

  it('rejects unknown types and cues', () => {
    expect(isServerMessage({ type: 'boom' })).toBe(false);
    expect(isServerMessage({ type: 'cue', sessionId: 's1', cue: { cue: 'dance' } })).toBe(false);
  });
});

describe('parseMessage', () => {
  it('reads a full message or a body under a named event', () => {
    const full = JSON.stringify({ type: 'removed', sessionId: 's1' });
    expect(parseMessage('message', full)).toEqual({ type: 'removed', sessionId: 's1' });
    expect(parseMessage('removed', JSON.stringify({ sessionId: 's2' }))).toEqual({
      type: 'removed',
      sessionId: 's2',
    });
  });

  it('ignores junk', () => {
    expect(parseMessage('session', '{nope')).toBeUndefined();
    expect(parseMessage('session', JSON.stringify({ session: {} }))).toBeUndefined();
    expect(parseMessage('session', 42)).toBeUndefined();
  });
});

describe('isExcerpt', () => {
  it('needs every field', () => {
    expect(isExcerpt({ path: 'a', start: 1, end: 2, totalLines: 9, text: 'x' })).toBe(true);
    expect(isExcerpt({ path: 'a', start: 1, end: 2, text: 'x' })).toBe(false);
  });
});
