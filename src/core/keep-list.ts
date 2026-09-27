import type { PinRequest } from './protocol';
import type { Item, Pin, RepackEntry } from './types';

/** Adds a pin at the bottom of the Keep List, or updates one in place. */
export function upsertPin(
  pins: readonly Pin[],
  item: Item,
  request: PinRequest,
  at: number,
): Pin[] {
  const existing = pins.find(pin => pin.itemId === item.id);
  const pin: Pin = {
    itemId: item.id,
    kind: item.kind,
    label: item.label,
    pinnedAt: existing?.pinnedAt ?? at,
    ...(item.path === undefined ? {} : { path: item.path }),
    ...(item.range === undefined ? {} : { range: item.range }),
    ...(request.note === undefined ? {} : { note: request.note }),
    ...(request.snippet === undefined ? {} : { snippet: request.snippet }),
  };
  return existing ? pins.map(p => (p.itemId === item.id ? pin : p)) : [...pins, pin];
}

export function removePin(pins: readonly Pin[], itemId: string): Pin[] {
  return pins.filter(pin => pin.itemId !== itemId);
}

/** Listed pins go first in the given order, the rest keep their relative order. */
export function reorderPins(pins: readonly Pin[], itemIds: readonly string[]): Pin[] {
  const byId = new Map(pins.map(pin => [pin.itemId, pin]));
  const first = [...new Set(itemIds)].flatMap(id => {
    const pin = byId.get(id);
    return pin ? [pin] : [];
  });
  const placed = new Set(first.map(pin => pin.itemId));
  return [...first, ...pins.filter(pin => !placed.has(pin.itemId))];
}

function repackEntryFor(item: Item): RepackEntry {
  return {
    itemId: item.id,
    kind: item.kind,
    label: item.label,
    ...(item.path === undefined ? {} : { path: item.path }),
    ...(item.note === undefined ? {} : { note: item.note }),
  };
}

/** Adds dropped items to the queue once each. */
export function queueRepack(
  existing: readonly RepackEntry[],
  items: readonly Item[],
): RepackEntry[] {
  const queued = new Set(existing.map(entry => entry.itemId));
  const added = items.filter(item => !queued.has(item.id)).map(repackEntryFor);
  return [...existing, ...added];
}
