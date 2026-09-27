import { formatTokens, percent } from './format';
import { baseName, normalizePath } from './ids';
import type { Item, SessionState, TrailTip } from './types';

export interface Insights {
  tips: TrailTip[];
  staleIds: Set<string>;
}

const ANVIL_SHARE = 0.1;
const LOUD_COMMAND_TOKENS = 5000;
const HEAVY_RESEARCH_COUNT = 8;
const STALE_TURNS = 20;
const CAMP_SOON_FILL = 0.75;
const MAX_STALE_TIPS = 3;

export function inPack(item: Item): boolean {
  return item.agentId === undefined && item.status !== 'dropped' && item.status !== 'repack_queued';
}

function tipId(kind: TrailTip['kind'], key: string, epoch: number): string {
  return `${kind}:${key}:${epoch}`;
}

function carriedTwice(items: readonly Item[], epoch: number): TrailTip[] {
  const copies = new Map<string, Item[]>();
  for (const item of items) {
    if (item.duplicateOf === undefined || item.epoch !== epoch) continue;
    const list = copies.get(item.duplicateOf) ?? [];
    list.push(item);
    copies.set(item.duplicateOf, list);
  }
  const byId = new Map(items.map(item => [item.id, item]));
  return [...copies].flatMap(([firstId, dupes]) => {
    const first = byId.get(firstId);
    if (!first) return [];
    const wasted = dupes.reduce((sum, d) => sum + d.tokensEst, 0);
    return [
      {
        id: tipId('carried_twice', firstId, epoch),
        kind: 'carried_twice' as const,
        text: `${first.label} was read ${dupes.length + 1} times in this leg, ${formatTokens(wasted)} carried twice`,
        itemIds: [firstId, ...dupes.map(d => d.id)],
        wastedTokens: wasted,
      },
    ];
  });
}

function anvils(items: readonly Item[], windowTokens: number, epoch: number): TrailTip[] {
  const limit = windowTokens * ANVIL_SHARE;
  return items
    .filter(item => item.tokensEst > limit)
    .map(item => ({
      id: tipId('anvil', item.id, epoch),
      kind: 'anvil' as const,
      text: `${item.label} weighs ${formatTokens(item.tokensEst)}, over 10% of the window`,
      itemIds: [item.id],
    }));
}

function loudCommands(items: readonly Item[], epoch: number): TrailTip[] {
  return items
    .filter(item => item.kind === 'bash_output' && item.tokensEst > LOUD_COMMAND_TOKENS)
    .map(item => ({
      id: tipId('loud_command', item.id, epoch),
      kind: 'loud_command' as const,
      text: `${item.label} printed ${formatTokens(item.tokensEst)}. Trimming with head or tail, or handing it to a subagent, keeps the pack lighter`,
      itemIds: [item.id],
    }));
}

function heavyResearch(items: readonly Item[], epoch: number): TrailTip[] {
  const research = items.filter(
    item => item.epoch === epoch && (item.kind === 'web' || item.kind === 'search'),
  );
  if (research.length < HEAVY_RESEARCH_COUNT) return [];
  const total = research.reduce((sum, item) => sum + item.tokensEst, 0);
  return [
    {
      id: tipId('heavy_research', 'main', epoch),
      kind: 'heavy_research',
      text: `${research.length} searches and web lookups sit in the main pack, ${formatTokens(total)}. A subagent could carry that research`,
      itemIds: research.map(item => item.id),
    },
  ];
}

/** Old items whose file never shows up again in a later tool call. */
function findStale(items: readonly Item[], currentTurn: number): Item[] {
  const lastTouch = new Map<string, number>();
  for (const item of items) {
    if (item.path === undefined) continue;
    const key = normalizePath(item.path);
    lastTouch.set(key, Math.max(lastTouch.get(key) ?? 0, item.turn));
  }
  const pathless = items.filter(item => item.path === undefined);
  const laterLabels = (turn: number, name: string): boolean =>
    pathless.some(other => other.turn > turn && other.label.includes(name));
  return items.filter(item => {
    if (item.path === undefined || item.status !== 'carried') return false;
    if (currentTurn - item.turn <= STALE_TURNS) return false;
    if ((lastTouch.get(normalizePath(item.path)) ?? 0) > item.turn) return false;
    return !laterLabels(item.turn, baseName(item.path));
  });
}

function staleTips(stale: readonly Item[], currentTurn: number, epoch: number): TrailTip[] {
  return [...stale]
    .sort((a, b) => b.tokensEst - a.tokensEst)
    .slice(0, MAX_STALE_TIPS)
    .map(item => ({
      id: tipId('stale_load', item.id, epoch),
      kind: 'stale_load' as const,
      text: `${item.label} was picked up ${currentTurn - item.turn} turns ago and not touched since`,
      itemIds: [item.id],
    }));
}

function campSoon(state: SessionState, items: readonly Item[]): TrailTip[] {
  if (state.fill < CAMP_SOON_FILL || state.pins.length > 0) return [];
  const heaviest = [...items]
    .filter(item => item.status === 'carried')
    .sort((a, b) => b.tokensEst - a.tokensEst)
    .slice(0, 3);
  return [
    {
      id: tipId('camp_soon', 'pack', state.epoch),
      kind: 'camp_soon',
      text: `The pack is ${percent(state.fill)} of the way to camp and nothing is pinned yet`,
      itemIds: heaviest.map(item => item.id),
    },
  ];
}

/** Trail tips. Facts only, and ids stay stable per kind, item and epoch. */
export function analyze(state: SessionState): Insights {
  const items = state.items.filter(inPack);
  const stale = findStale(items, state.turn);
  const tips = [
    ...campSoon(state, items),
    ...anvils(items, state.windowTokens, state.epoch),
    ...loudCommands(items, state.epoch),
    ...carriedTwice(items, state.epoch),
    ...heavyResearch(items, state.epoch),
    ...staleTips(stale, state.turn, state.epoch),
  ];
  return { tips, staleIds: new Set(stale.map(item => item.id)) };
}
