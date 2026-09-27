import { describe, expect, it } from 'vitest';
import { analyze } from './insights';
import type { Item, SessionState } from './types';

function item(id: string, over: Partial<Item> = {}): Item {
  return {
    id,
    sessionId: 's',
    kind: 'file_read',
    label: id,
    tokensEst: 100,
    weight: 'pebble',
    turn: 1,
    addedAt: 0,
    epoch: 0,
    status: 'carried',
    ...over,
  };
}

function state(items: Item[], over: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 's',
    cwd: '',
    transcriptPath: '',
    title: 's',
    windowTokens: 200_000,
    compactAtTokens: 167_000,
    contextTokens: 0,
    contextSource: 'transcript',
    fill: 0,
    windowFill: 0,
    phase: 'idle',
    turn: 1,
    epoch: 0,
    startedAt: 0,
    updatedAt: 0,
    items,
    subagents: {},
    compactions: [],
    pins: [],
    tips: [],
    ...over,
  };
}

const kinds = (s: SessionState) => analyze(s).tips.map(t => t.kind);

describe('trail tips', () => {
  it('names anvils and loud commands with ≈ token counts', () => {
    const tips = analyze(
      state([
        item('big', { tokensEst: 30_000 }),
        item('npm test', { kind: 'bash_output', tokensEst: 6000 }),
      ]),
    ).tips;
    expect(tips.map(t => t.kind)).toEqual(['anvil', 'loud_command']);
    expect(tips[0]?.text).toBe('big weighs ≈30K, over 10% of the window');
    expect(tips[1]?.text).toContain('npm test printed ≈6K');
  });

  it('ignores dropped items and subagent satchels', () => {
    expect(
      kinds(
        state([
          item('gone', { tokensEst: 90_000, status: 'dropped' }),
          item('theirs', { tokensEst: 90_000, agentId: 'a1' }),
        ]),
      ),
    ).toEqual([]);
  });

  it('suggests a subagent when research piles up in the main pack', () => {
    const research = Array.from({ length: 8 }, (_, i) => item(`q${i}`, { kind: 'search' }));
    expect(kinds(state(research))).toEqual(['heavy_research']);
  });

  it('marks old files that never came up again as stale', () => {
    const insights = analyze(
      state(
        [
          item('old.ts', { path: 'C:\\x\\old.ts', turn: 1 }),
          item('used.ts', { path: 'C:\\x\\used.ts', turn: 1 }),
          item('grep: used.ts', { kind: 'search', turn: 10 }),
          item('fresh.ts', { path: 'C:\\x\\fresh.ts', turn: 20 }),
        ],
        { turn: 30 },
      ),
    );
    expect([...insights.staleIds]).toEqual(['old.ts']);
    expect(insights.tips[0]?.text).toBe('old.ts was picked up 29 turns ago and not touched since');
  });

  it('warns about camp with nothing pinned, and keeps ids stable per epoch', () => {
    const near = state([item('a')], { fill: 0.8, epoch: 2 });
    const [tip] = analyze(near).tips;
    expect(tip?.id).toBe('camp_soon:pack:2');
    expect(tip?.text).toBe('The pack is 80% of the way to camp and nothing is pinned yet');
    expect(
      kinds({ ...near, pins: [{ itemId: 'a', kind: 'file_read', label: 'a', pinnedAt: 0 }] }),
    ).toEqual([]);
  });

  it('writes prose without em dashes, colons or semicolons', () => {
    const tips = analyze(
      state(
        [
          item('x', { tokensEst: 30_000, kind: 'bash_output' }),
          ...Array.from({ length: 8 }, (_, i) => item(`w${i}`, { kind: 'web' })),
          item('old', { path: 'old', turn: 0 }),
        ],
        { fill: 0.9, turn: 40 },
      ),
    ).tips;
    expect(tips.length).toBeGreaterThan(3);
    for (const tip of tips) expect(tip.text).not.toMatch(/[—;:]/);
  });
});
