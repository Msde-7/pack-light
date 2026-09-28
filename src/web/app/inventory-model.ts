import type { Item, ItemKind, SessionState, WeightClass } from '../../core/types';

export type SortMode = 'weight' | 'recent' | 'kind';

/** One inventory slot. Duplicate reads collapse into the item they duplicate. */
export interface Stack {
  head: Item;
  members: Item[];
  totalTokens: number;
  pinned: boolean;
  lastAddedAt: number;
}

/** `undefined` is the main agent, whose items carry no agentId. */
export type AgentFilter = string | undefined;

export const WEIGHT_ORDER: Record<WeightClass, number> = { pebble: 0, book: 1, brick: 2, anvil: 3 };

const PACKED_STATUSES = new Set<Item['status']>(['carried', 'pinned', 'sewn_in', 'repacked']);
const LOST_STATUSES = new Set<Item['status']>(['dropped', 'repack_queued', 'repacked']);

const KIND_ORDER: ItemKind[] = [
  'instructions',
  'user_prompt',
  'file_read',
  'edit',
  'search',
  'bash_output',
  'web',
  'mcp',
  'subagent_report',
  'other',
];

export function pinnedIds(session: SessionState): Set<string> {
  const ids = new Set(session.pins.map(pin => pin.itemId));
  for (const item of session.items) if (item.status === 'pinned') ids.add(item.id);
  return ids;
}

export function itemsForAgent(items: readonly Item[], agent: AgentFilter): Item[] {
  return items.filter(item => item.agentId === agent);
}

export function packedItems(items: readonly Item[]): Item[] {
  return items.filter(item => PACKED_STATUSES.has(item.status));
}

/** Dropped and queued items, plus ones repacked since the last camp so the user sees them go home. */
export function lostItems(items: readonly Item[]): Item[] {
  return items.filter(item => LOST_STATUSES.has(item.status));
}

export function buildStacks(items: readonly Item[], pinned: ReadonlySet<string>): Stack[] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = item.duplicateOf ?? item.id;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()].map(([key, members]) => toStack(key, members, pinned));
}

function toStack(key: string, members: Item[], pinned: ReadonlySet<string>): Stack {
  const ordered = [...members].sort((a, b) => a.addedAt - b.addedAt);
  const head = ordered.find(item => item.id === key) ?? ordered[0];
  if (!head) throw new Error('empty stack');
  return {
    head,
    members: ordered,
    totalTokens: ordered.reduce((sum, item) => sum + item.tokensEst, 0),
    pinned: ordered.some(item => pinned.has(item.id)),
    lastAddedAt: Math.max(...ordered.map(item => item.addedAt)),
  };
}

const COMPARE: Record<SortMode, (a: Stack, b: Stack) => number> = {
  weight: (a, b) => b.totalTokens - a.totalTokens,
  recent: (a, b) => b.lastAddedAt - a.lastAddedAt,
  kind: (a, b) =>
    KIND_ORDER.indexOf(a.head.kind) - KIND_ORDER.indexOf(b.head.kind) ||
    WEIGHT_ORDER[b.head.weight] - WEIGHT_ORDER[a.head.weight] ||
    b.totalTokens - a.totalTokens,
};

/** Pinned stacks always come first, then the chosen order, then id for a stable result. */
export function sortStacks(stacks: readonly Stack[], mode: SortMode): Stack[] {
  return [...stacks].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      COMPARE[mode](a, b) ||
      a.head.id.localeCompare(b.head.id),
  );
}

export function heaviest(stacks: readonly Stack[], count = 5): Stack[] {
  return [...stacks].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, count);
}

export function findItem(
  session: SessionState | undefined,
  id: string | undefined,
): Item | undefined {
  if (!session || id === undefined) return undefined;
  return session.items.find(item => item.id === id);
}

export function duplicateCount(session: SessionState, item: Item): number {
  const key = item.duplicateOf ?? item.id;
  return session.items.filter(other => (other.duplicateOf ?? other.id) === key).length;
}

/** Moves one id by `delta` places, clamped to the list bounds. */
export function moveId(ids: readonly string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const to = Math.min(ids.length - 1, Math.max(0, from + delta));
  return moveTo(ids, id, to);
}

export function moveTo(ids: readonly string[], id: string, to: number): string[] {
  const rest = ids.filter(other => other !== id);
  if (rest.length === ids.length) return [...ids];
  rest.splice(Math.min(Math.max(0, to), rest.length), 0, id);
  return rest;
}
