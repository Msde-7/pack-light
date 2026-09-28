import { describe, expect, it } from 'vitest';
import type { Item } from '../../core/types';
import {
  approach,
  arcPoint,
  flightAt,
  stackCount,
  steppedProgress,
  syncRoster,
  walkCompanion,
  walkingOrder,
} from './actors';
import type { Flight } from './actors';

const flight: Flight = {
  sprite: 'mini_scroll_file',
  from: { x: 320, y: 100 },
  start: 1,
  duration: 0.6,
  lift: 20,
};

describe('flightAt', () => {
  const pack = { x: 120, y: 130 };

  it('is hidden before it starts and after it lands', () => {
    expect(flightAt(flight, 0.9, pack)).toBeUndefined();
    expect(flightAt(flight, 1.6, pack)).toBeUndefined();
  });

  it('reaches the pack on its last pose', () => {
    expect(flightAt(flight, 1.59, pack)).toEqual(pack);
  });

  it('moves in six discrete poses', () => {
    const points = Array.from({ length: 60 }, (_, i) => flightAt(flight, 1 + i * 0.01, pack));
    expect(new Set(points.map(point => JSON.stringify(point))).size).toBe(6);
  });
});

function item(id: string, duplicateOf?: string): Item {
  return {
    id,
    sessionId: 's',
    kind: 'file_read',
    label: id,
    tokensEst: 10,
    weight: 'pebble',
    turn: 1,
    addedAt: 0,
    epoch: 0,
    status: 'carried',
    duplicateOf,
  };
}

describe('stackCount', () => {
  it('counts the original and its duplicates', () => {
    const items = [item('a'), item('b', 'a'), item('c', 'a'), item('d')];
    expect(stackCount(items, items[2]!)).toBe(3);
    expect(stackCount(items, items[3]!)).toBe(1);
  });
});

describe('syncRoster', () => {
  const slot = (index: number): number => 100 - index * 20;
  const party = [
    { agentId: 'a', hat: 0 },
    { agentId: 'b', hat: 1 },
  ];

  it('adds new companions at their slot, or at the edge when they just joined', () => {
    expect(syncRoster([], party, 0, slot, new Set(['b']), -14)).toEqual([
      { agentId: 'a', hat: 0, x: 100, walked: 0 },
      { agentId: 'b', hat: 1, x: -14, walked: 0 },
    ]);
  });

  it('starts a fade for companions that left and keeps the rest', () => {
    const start = syncRoster([], party, 0, slot, new Set(), 0);
    const next = syncRoster(start, [{ agentId: 'b', hat: 1 }], 5, slot, new Set(), 0);
    expect(next.find(actor => actor.agentId === 'a')?.leftAt).toBe(5);
    expect(walkingOrder(next)).toEqual(new Map([['b', 0]]));
  });

  it('shows at most four companions', () => {
    const active = ['a', 'b', 'c', 'd', 'e'].map((agentId, hat) => ({ agentId, hat }));
    expect(syncRoster([], active, 0, slot, new Set(), 0)).toHaveLength(4);
  });
});

describe('approach', () => {
  it('steps toward the target without overshooting', () => {
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(9, 10, 3)).toBe(10);
    expect(approach(10, 0, 4)).toBe(6);
  });
});

describe('walkCompanion', () => {
  const actor = { agentId: 'a', hat: 0, x: 50, walked: 10 };

  it('counts the trail passing under a companion that keeps its place', () => {
    const moved = walkCompanion(actor, 50, 2, 0.6);
    expect(moved.x).toBe(50);
    expect(moved.walked).toBeCloseTo(10.6);
  });

  it('adds its own steps toward the slot', () => {
    expect(walkCompanion(actor, 60, 2, 0.5)).toMatchObject({ x: 52, walked: 12.5 });
    expect(walkCompanion(actor, 40, 2, 0)).toMatchObject({ x: 48, walked: 12 });
  });
});

describe('arcPoint', () => {
  const from = { x: 300, y: 100 };
  const to = { x: 100, y: 120 };

  it('starts and ends on the given points', () => {
    expect(arcPoint(from, to, 0, 30)).toEqual(from);
    expect(arcPoint(from, to, 1, 30)).toEqual(to);
  });

  it('rises by the lift at the midpoint', () => {
    expect(arcPoint(from, to, 0.5, 30)).toEqual({ x: 200, y: 80 });
  });

  it('clamps progress', () => {
    expect(arcPoint(from, to, 2, 30)).toEqual(to);
  });
});

describe('steppedProgress', () => {
  it('holds each of six poses and lands exactly', () => {
    expect(steppedProgress(-0.1, 6)).toBe(0);
    expect(steppedProgress(0, 6)).toBeCloseTo(1 / 6);
    expect(steppedProgress(0.16, 6)).toBeCloseTo(1 / 6);
    expect(steppedProgress(0.5, 6)).toBeCloseTo(4 / 6);
    expect(steppedProgress(0.99, 6)).toBe(1);
    expect(steppedProgress(1, 6)).toBe(1);
  });

  it('takes only six distinct values', () => {
    const values = new Set(Array.from({ length: 100 }, (_, i) => steppedProgress(i / 100, 6)));
    expect(values.size).toBe(6);
  });
});
