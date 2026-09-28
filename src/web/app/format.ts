import { formatTokens } from '../../core/format';
import type {
  ContextSource,
  Item,
  ItemKind,
  ItemStatus,
  SessionPhase,
  TipKind,
} from '../../core/types';
import type { Stack } from './inventory-model';

export const KIND_LABEL: Record<ItemKind, string> = {
  file_read: 'File',
  search: 'Search',
  bash_output: 'Command',
  web: 'Web page',
  mcp: 'MCP tool',
  subagent_report: 'Companion report',
  edit: 'Edit',
  user_prompt: 'Prompt',
  instructions: 'Instructions',
  other: 'Other',
};

export const STATUS_LABEL: Record<ItemStatus, string> = {
  carried: 'Carried',
  pinned: 'Pinned',
  dropped: 'Left at camp',
  sewn_in: 'Sewn in',
  repack_queued: 'Repack queued',
  repacked: 'Repacked',
};

export const PHASE_LABEL: Record<SessionPhase, string> = {
  walking: 'Walking',
  waiting_for_user: 'Waiting for you',
  idle: 'Resting',
  camping: 'Camping',
  done: 'Done',
};

export const SOURCE_LABEL: Record<ContextSource, string> = {
  statusline: 'status line',
  transcript: 'transcript',
  estimate: 'estimate',
};

/** Tip text for bare mode, where the server text may name paths or commands. */
export const BARE_TIP_TEXT: Record<TipKind, string> = {
  carried_twice: 'The same file is carried more than once.',
  anvil: 'One item weighs over a tenth of the window.',
  loud_command: 'A command printed a lot of output.',
  heavy_research: 'Lots of research in the main pack. A companion could carry it.',
  stale_load: 'An old item has not been touched in a while.',
  camp_soon: 'Camp is close and nothing is pinned yet.',
};

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Bare mode shows only the kind, since labels carry paths and commands. */
export function itemName(item: Item, bare: boolean): string {
  return bare ? KIND_LABEL[item.kind] : item.label;
}

export function itemPath(item: Item, bare: boolean): string | undefined {
  if (bare || item.path === undefined) return undefined;
  return item.range === undefined ? item.path : `${item.path} (lines ${item.range})`;
}

export function stackLines(stack: Stack, bare: boolean): string[] {
  const { head } = stack;
  const count = stack.members.length;
  const path = itemPath(head, bare);
  return [
    itemName(head, bare),
    ...(path !== undefined && path !== head.label ? [path] : []),
    `${formatTokens(stack.totalTokens)} tokens, turn ${head.turn}`,
    `${KIND_LABEL[head.kind]}, ${head.weight}`,
    ...(count > 1 ? [`Carried ${count} times`] : []),
    ...(stack.pinned ? ['Pinned'] : head.status === 'sewn_in' ? [STATUS_LABEL.sewn_in] : []),
    ...(head.failed === true ? ['This call failed, but its error still takes space'] : []),
    ...(head.stale === true ? ['Not touched in a while'] : []),
  ];
}
