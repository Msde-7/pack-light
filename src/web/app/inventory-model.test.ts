import { describe, expect, it } from 'vitest';
import {
  buildStacks,
  duplicateCount,
  heaviest,
  itemsForAgent,
  lostItems,
  moveId,
  moveTo,
  packedItems,
  pinnedIds,
  sortStacks,
} from './inventory-model';
import { makeItem, makeSession } from './testing';

const readA = makeItem({ id: 'a', tokensEst: 500, addedAt: 1 });
const readA2 = makeItem({ id: 'a2', duplicateOf: 'a', tokensEst: 500, addedAt: 5 });
const readA3 = makeItem({ id: 'a3', duplicateOf: 'a', tokensEst: 500, addedAt: 6 });
const bash = makeItem({
  id: 'b',
  kind: 'bash_output',
  tokensEst: 9000,
  weight: 'anvil',
  addedAt: 2,
});
const prompt = makeItem({ id: 'c', kind: 'user_prompt', tokensEst: 50, addedAt: 9 });

describe('buildStacks', () => {
  it('groups duplicates under the item they repeat', () => {
    const stacks = buildStacks([readA2, readA, bash, readA3], new Set());
    const stackA = stacks.find(s => s.head.id === 'a');
    expect(stacks).toHaveLength(2);
    expect(stackA?.members.map(m => m.id)).toEqual(['a', 'a2', 'a3']);
    expect(stackA?.totalTokens).toBe(1500);
    expect(stackA?.lastAddedAt).toBe(6);
  });

  it('uses the earliest copy as head when the original is filtered out', () => {
    const [stack] = buildStacks([readA3, readA2], new Set());
    expect(stack?.head.id).toBe('a2');
  });

  it('marks a stack pinned when any member is pinned', () => {
    const [stack] = buildStacks([readA, readA2], new Set(['a2']));
    expect(stack?.pinned).toBe(true);
  });
});

describe('sortStacks', () => {
  const stacks = buildStacks([readA, readA2, readA3, bash, prompt], new Set(['c']));

  it('puts pins first, then the heaviest', () => {
    expect(sortStacks(stacks, 'weight').map(s => s.head.id)).toEqual(['c', 'b', 'a']);
  });

  it('orders by most recent addition', () => {
    const unpinned = buildStacks([readA, readA2, readA3, bash, prompt], new Set());
    expect(sortStacks(unpinned, 'recent').map(s => s.head.id)).toEqual(['c', 'a', 'b']);
  });

  it('orders by kind', () => {
    const unpinned = buildStacks([bash, readA, prompt], new Set());
    expect(sortStacks(unpinned, 'kind').map(s => s.head.kind)).toEqual([
      'user_prompt',
      'file_read',
      'bash_output',
    ]);
  });
});

describe('filters', () => {
  const companionItem = makeItem({ id: 'x', agentId: 'agent-1' });
  const dropped = makeItem({ id: 'd', status: 'dropped' });
  const queued = makeItem({ id: 'q', status: 'repack_queued' });

  it('splits main agent items from companion items', () => {
    expect(itemsForAgent([readA, companionItem], undefined)).toEqual([readA]);
    expect(itemsForAgent([readA, companionItem], 'agent-1')).toEqual([companionItem]);
  });

  it('keeps dropped and queued items out of the pack and in Lost and Found', () => {
    expect(packedItems([readA, dropped, queued])).toEqual([readA]);
    expect(lostItems([readA, dropped, queued])).toEqual([dropped, queued]);
  });
});

describe('pinnedIds', () => {
  it('merges the Keep List with item status', () => {
    const session = makeSession({
      items: [makeItem({ id: 'p', status: 'pinned' })],
      pins: [{ itemId: 'k', kind: 'file_read', label: 'k', pinnedAt: 1 }],
    });
    expect([...pinnedIds(session)].sort()).toEqual(['k', 'p']);
  });
});

describe('duplicateCount', () => {
  it('counts every copy from any member', () => {
    const session = makeSession({ items: [readA, readA2, readA3, bash] });
    expect(duplicateCount(session, readA)).toBe(3);
    expect(duplicateCount(session, readA3)).toBe(3);
    expect(duplicateCount(session, bash)).toBe(1);
  });
});

describe('heaviest', () => {
  it('returns the top stacks by total size', () => {
    const stacks = buildStacks([readA, readA2, readA3, bash, prompt], new Set());
    expect(heaviest(stacks, 2).map(s => s.head.id)).toEqual(['b', 'a']);
  });
});

describe('moveId and moveTo', () => {
  it('moves within bounds', () => {
    expect(moveId(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'z', 1)).toEqual(['a', 'b', 'c']);
  });

  it('drops an id at a target index', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTo(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
  });
});
