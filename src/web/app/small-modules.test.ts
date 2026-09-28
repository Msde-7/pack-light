import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../core/types';
import { itemName, itemPath, stackLines } from './format';
import { nextIndex } from './inventory';
import { buildStacks } from './inventory-model';
import { DEFAULT_PREFS, parsePrefs } from './prefs';
import { planLayout, sceneScale } from './layout';
import { clampRange, initialRange, isSnippetable, numberedLines, snippetFits } from './snippet';
import { fillLevel } from './stamina';
import { makeItem, makeSession, makeState } from './testing';
import { visibleTips } from './insights';
import { tokenFromHash } from './token';

describe('tokenFromHash', () => {
  it('reads the token and ignores the rest', () => {
    expect(tokenFromHash('#token=abc123')).toBe('abc123');
    expect(tokenFromHash('#x=1&token=t%2Bk')).toBe('t+k');
    expect(tokenFromHash('#token=')).toBeUndefined();
    expect(tokenFromHash('')).toBeUndefined();
  });
});

describe('parsePrefs', () => {
  it('falls back on missing or broken storage', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{oops')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('"text"')).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid fields and drops invalid ones', () => {
    const raw = JSON.stringify({
      bare: true,
      motion: 'fast',
      sort: 'kind',
      dismissedTips: ['a', 3],
    });
    expect(parsePrefs(raw)).toEqual({
      bare: true,
      motion: 'system',
      sort: 'kind',
      dismissedTips: ['a'],
    });
  });
});

describe('snippet helpers', () => {
  it('starts from the read range when there is one', () => {
    expect(initialRange('40-58')).toEqual({ start: 40, end: 58 });
    expect(initialRange('58-40')).toEqual({ start: 1, end: 30 });
    expect(initialRange(undefined)).toEqual({ start: 1, end: 30 });
  });

  it('clamps ranges to the file', () => {
    expect(clampRange(0, 10)).toEqual({ start: 1, end: 10 });
    expect(clampRange(20, 5)).toEqual({ start: 20, end: 20 });
    expect(clampRange(5, 900, 120)).toEqual({ start: 5, end: 120 });
    expect(clampRange(Number.NaN, Number.NaN)).toEqual({ start: 1, end: 1 });
  });

  it('caps snippets at the limit', () => {
    expect(snippetFits('x'.repeat(LIMITS.snippetChars))).toBe(true);
    expect(snippetFits('x'.repeat(LIMITS.snippetChars + 1))).toBe(false);
  });

  it('numbers preview lines from the excerpt start', () => {
    const lines = numberedLines({
      path: 'a',
      start: 40,
      end: 41,
      totalLines: 90,
      text: 'one\ntwo',
    });
    expect(lines).toEqual([
      { number: 40, text: 'one' },
      { number: 41, text: 'two' },
    ]);
  });

  it('offers snippets only for file reads with a path', () => {
    expect(isSnippetable(makeItem({ id: 'a' }))).toBe(true);
    expect(isSnippetable(makeItem({ id: 'b', kind: 'bash_output' }))).toBe(false);
    expect(isSnippetable(makeItem({ id: 'c', path: undefined }))).toBe(false);
  });
});

describe('describe', () => {
  const item = makeItem({ id: 'a', label: 'a.ts', path: '/repo/a.ts', range: '1-9', stale: true });

  it('hides labels and paths in bare mode', () => {
    expect(itemName(item, true)).toBe('File');
    expect(itemPath(item, true)).toBeUndefined();
    expect(itemPath(item, false)).toBe('/repo/a.ts (lines 1-9)');
  });

  it('builds tooltip rows with the duplicate count', () => {
    const copy = makeItem({ id: 'b', duplicateOf: 'a', tokensEst: 100 });
    const [stack] = buildStacks([item, copy], new Set(['a']));
    const lines = stackLines(stack!, false);
    expect(lines[0]).toBe('a.ts');
    expect(lines).toContain('/repo/a.ts (lines 1-9)');
    expect(lines).toContain('≈200 tokens, turn 1');
    expect(lines).toContain('Carried 2 times');
    expect(lines).toContain('Pinned');
    expect(stackLines(stack!, true).join(' ')).not.toContain('repo');
  });
});

describe('fillLevel', () => {
  it('matches the trail sign thresholds', () => {
    expect(fillLevel(0.2)).toBe('fresh');
    expect(fillLevel(0.6)).toBe('ahead');
    expect(fillLevel(0.75)).toBe('soon');
    expect(fillLevel(0.95)).toBe('now');
  });
});

describe('sceneScale', () => {
  it('picks the largest integer scale that fits', () => {
    expect(sceneScale(1400, 600)).toBe(3);
    expect(sceneScale(1400, 400)).toBe(2);
    expect(sceneScale(300, 100)).toBe(1);
  });
});

describe('planLayout', () => {
  it('gives the scene the biggest integer scale the viewport allows', () => {
    expect(planLayout(1920, 1080)).toMatchObject({ mode: 'wide', scale: 4 });
    expect(planLayout(1440, 900)).toMatchObject({ mode: 'wide', scale: 3 });
    expect(planLayout(1280, 800)).toMatchObject({ mode: 'stack', scale: 3, notesBeside: true });
    expect(planLayout(390, 844)).toMatchObject({ mode: 'narrow', scale: 1 });
  });

  it('keeps the wide sidebar readable', () => {
    for (const width of [1440, 1600, 1920, 2560]) {
      const plan = planLayout(width, 1000);
      expect(plan.side).toBeGreaterThanOrEqual(400);
      expect(plan.side).toBeLessThanOrEqual(520);
    }
  });
});

describe('nextIndex', () => {
  it('moves through a grid and stays in bounds', () => {
    expect(nextIndex('ArrowRight', 0, 10, 4)).toBe(1);
    expect(nextIndex('ArrowDown', 1, 10, 4)).toBe(5);
    expect(nextIndex('ArrowDown', 8, 10, 4)).toBe(8);
    expect(nextIndex('ArrowLeft', 0, 10, 4)).toBe(0);
    expect(nextIndex('End', 3, 10, 4)).toBe(9);
    expect(nextIndex('Home', 3, 10, 4)).toBe(0);
  });
});

describe('visibleTips', () => {
  const session = makeSession({
    items: [makeItem({ id: 'a' }), makeItem({ id: 'z', agentId: 'x' })],
    tips: [
      { id: 'gone', kind: 'anvil', text: 't', itemIds: ['a'] },
      { id: 'main', kind: 'anvil', text: 't', itemIds: ['a'] },
      { id: 'side', kind: 'anvil', text: 't', itemIds: ['z'] },
      { id: 'camp', kind: 'camp_soon', text: 't', itemIds: [] },
    ],
  });

  it('drops dismissed tips and tips about other agents', () => {
    expect(visibleTips(session, makeState({ dismissedTips: ['gone'] })).map(t => t.id)).toEqual([
      'main',
      'camp',
    ]);
  });
});
