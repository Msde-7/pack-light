import { expect, it } from 'vitest';
import { queueRepack, removePin, reorderPins, upsertPin } from './keep-list';
import type { Item } from './types';

const item = (id: string): Item => ({
  id,
  sessionId: 's',
  kind: 'file_read',
  label: id,
  path: `/${id}`,
  tokensEst: 1,
  weight: 'pebble',
  turn: 1,
  addedAt: 0,
  epoch: 0,
  status: 'dropped',
});

it('adds pins at the bottom and updates them in place', () => {
  let pins = upsertPin([], item('a'), { note: 'first' }, 1);
  pins = upsertPin(pins, item('b'), {}, 2);
  pins = upsertPin(pins, item('a'), { note: 'second' }, 3);
  expect(pins.map(p => [p.itemId, p.note, p.pinnedAt])).toEqual([
    ['a', 'second', 1],
    ['b', undefined, 2],
  ]);
  expect(removePin(pins, 'a').map(p => p.itemId)).toEqual(['b']);
});

it('reorders listed pins first and keeps the rest', () => {
  const pins = ['a', 'b', 'c'].map((id, i) => upsertPin([], item(id), {}, i)[0]!);
  expect(reorderPins(pins, ['c', 'x', 'c']).map(p => p.itemId)).toEqual(['c', 'a', 'b']);
});

it('queues each item once', () => {
  const once = queueRepack([], [item('a')]);
  expect(queueRepack(once, [item('a'), item('b')]).map(e => e.itemId)).toEqual(['a', 'b']);
});
