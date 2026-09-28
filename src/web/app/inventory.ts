import { formatTokens } from '../../core/format';
import type { SessionState } from '../../core/types';
import { selectItem, togglePin } from './actions';
import { live } from './context';
import type { AppContext } from './context';
import { byId, h, keepFocus, replace, withCode } from './dom';
import { plural, stackLines } from './format';
import { kindIcon, spriteCanvas } from './icon';
import {
  buildStacks,
  findItem,
  itemsForAgent,
  packedItems,
  pinnedIds,
  sortStacks,
} from './inventory-model';
import type { Stack } from './inventory-model';
import { isSort } from './prefs';
import { currentSession } from './store';
import type { AppState } from './store';
import { createTooltip } from './tooltip';
import type { Tooltip } from './tooltip';

export function mountInventory(ctx: AppContext): void {
  const summary = byId('inventory-summary', HTMLElement);
  const sort = byId('sort', HTMLSelectElement);
  const slots = byId('slots', HTMLElement);
  const tooltip = createTooltip(byId('tooltip', HTMLElement));
  sort.value = ctx.store.get().sort;
  sort.addEventListener('change', () => {
    if (isSort(sort.value)) ctx.store.set({ sort: sort.value });
  });
  slots.addEventListener('keydown', event => {
    onGridKey(event, slots, ctx);
  });
  live(ctx, state => {
    const session = currentSession(state);
    const stacks = session ? visibleStacks(session, state) : [];
    const total = stacks.reduce((sum, stack) => sum + stack.totalTokens, 0);
    summary.textContent = session ? `${plural(stacks.length, 'slot')}, ${formatTokens(total)}` : '';
    tooltip.hold(() => {
      keepFocus(slots, () => {
        if (stacks.length > 0) replace(slots, ...slotButtons(stacks, state, ctx, tooltip));
        else replace(slots, empty(emptyText(state, session !== undefined)));
      });
    });
  });
}

export function visibleStacks(session: SessionState, state: AppState): Stack[] {
  const items = packedItems(itemsForAgent(session.items, state.agent));
  return sortStacks(buildStacks(items, pinnedIds(session)), state.sort);
}

function slotButtons(
  stacks: Stack[],
  state: AppState,
  ctx: AppContext,
  tooltip: Tooltip,
): HTMLButtonElement[] {
  const selected = stacks.find(stack => stack.members.some(m => m.id === state.itemId));
  const tabbable = selected ?? stacks[0];
  return stacks.map(stack => {
    const lines = stackLines(stack, state.bare);
    const highlighted = stack.members.some(m => state.highlightIds.includes(m.id));
    const button = slot(stack, lines, stack === selected, highlighted, stack === tabbable);
    const show = (): void => {
      tooltip.show(button, lines);
    };
    button.addEventListener('click', () => {
      tooltip.hide();
      selectItem(ctx, stack.head.id);
    });
    button.addEventListener('mouseenter', () => {
      if (matchMedia('(hover: hover)').matches) show();
    });
    button.addEventListener('focus', () => {
      if (button.matches(':focus-visible')) show();
    });
    button.addEventListener('mouseleave', tooltip.hide);
    button.addEventListener('blur', tooltip.hide);
    return button;
  });
}

function slot(
  stack: Stack,
  lines: string[],
  selected: boolean,
  highlighted: boolean,
  tabbable: boolean,
): HTMLButtonElement {
  const { head } = stack;
  const count = stack.members.length;
  const classes = [
    'slot',
    `w-${head.weight}`,
    stack.pinned && 'is-pinned',
    selected && 'is-selected',
    highlighted && 'is-highlight',
    head.stale === true && 'is-stale',
    head.failed === true && 'is-failed',
    head.status === 'sewn_in' && 'is-sewn',
    head.status === 'repacked' && 'is-repacked',
  ].filter(Boolean);
  return h(
    'button',
    {
      type: 'button',
      class: classes.join(' '),
      'data-id': head.id,
      'data-focus': `slot:${head.id}`,
      'aria-pressed': String(selected),
      'aria-label': lines.join('. '),
      tabindex: tabbable ? 0 : -1,
    },
    kindIcon(head.kind, 3, 'slot-icon'),
    stack.pinned && spriteCanvas('star_pin', 1, 'slot-star'),
    count > 1 && h('span', { class: 'slot-stack', 'aria-hidden': 'true' }, `x${count}`),
    head.failed === true && h('span', { class: 'slot-fail', 'aria-hidden': 'true' }, '!'),
    h('span', { class: 'slot-size', 'aria-hidden': 'true' }, formatTokens(stack.totalTokens)),
  );
}

const GRID_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

function onGridKey(event: KeyboardEvent, grid: HTMLElement, ctx: AppContext): void {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.classList.contains('slot')) return;
  if (event.key === 'p' || event.key === 'P') {
    const item = findItem(currentSession(ctx.store.get()), target.dataset.id);
    event.preventDefault();
    event.stopPropagation();
    if (item) void togglePin(ctx, item);
    return;
  }
  if (!GRID_KEYS.has(event.key)) return;
  event.preventDefault();
  const slots = [...grid.querySelectorAll<HTMLButtonElement>('.slot')];
  const next = slots[nextIndex(event.key, slots.indexOf(target), slots.length, columns(slots))];
  if (!next) return;
  for (const slot of slots) slot.tabIndex = slot === next ? 0 : -1;
  next.focus();
}

export function nextIndex(key: string, index: number, count: number, cols: number): number {
  const moves: Record<string, number> = {
    ArrowLeft: index - 1,
    ArrowRight: index + 1,
    ArrowUp: index - cols,
    ArrowDown: index + cols,
    Home: 0,
    End: count - 1,
  };
  const to = moves[key] ?? index;
  return to < 0 || to >= count ? index : to;
}

function columns(slots: HTMLElement[]): number {
  const top = slots[0]?.offsetTop;
  const sameRow = slots.findIndex(slot => slot.offsetTop !== top);
  return sameRow === -1 ? slots.length : sameRow;
}

function emptyText(state: AppState, hasSession: boolean): string {
  if (hasSession) {
    return 'The pack is empty. Items show up here as Claude reads files and runs tools.';
  }
  if (state.connection === 'no_token') {
    return 'Open the link that `packlight start` printed. It carries the key to this page.';
  }
  if (state.connection === 'denied') {
    return 'This page has an old key. Open the fresh link from `packlight start`.';
  }
  return 'No sessions yet. Run `packlight install`, then start a Claude Code session.';
}

function empty(text: string): HTMLElement {
  return h(
    'div',
    { class: 'empty' },
    spriteCanvas('backpack', 3, 'empty-icon'),
    h('p', {}, ...withCode(text)),
  );
}
