import { buildCompactCommand } from '../../core/inject';
import type { Pin, SessionState } from '../../core/types';
import { reorderPins, selectItem, unpinItem } from './actions';
import { live } from './context';
import type { AppContext } from './context';
import { button, byId, h, renderRows } from './dom';
import { KIND_LABEL } from './format';
import { kindIcon } from './icon';
import { findItem, moveId, moveTo } from './inventory-model';
import { currentSession } from './store';

export function mountKeepList(ctx: AppContext): void {
  const count = byId('keep-count', HTMLElement);
  const copy = byId('copy-compact', HTMLButtonElement);
  const list = byId('keep-list', HTMLOListElement);
  copy.addEventListener('click', () => void copyCompact(ctx));
  live(ctx, state => {
    const session = currentSession(state);
    const pins = session?.pins ?? [];
    const ids = pins.map(pin => pin.itemId);
    count.textContent = pins.length > 0 ? String(pins.length) : '';
    copy.disabled = pins.length === 0;
    renderRows(
      list,
      pins,
      (pin, index) => pinRow(pin, index, ids, session, state.bare, ctx),
      'Nothing pinned yet. Select an item and press `P` to keep it through camp.',
    );
  });
  wireDrag(list, ctx);
}

function pinRow(
  pin: Pin,
  index: number,
  ids: string[],
  session: SessionState | undefined,
  bare: boolean,
  ctx: AppContext,
): HTMLLIElement {
  const name = bare ? KIND_LABEL[pin.kind] : pin.label;
  const mentioned = findItem(session, pin.itemId)?.mentionedInSummary;
  const move = (delta: number, label: string, arrow: string): HTMLButtonElement =>
    button(
      {
        class: 'icon-button',
        disabled: delta < 0 ? index === 0 : index === ids.length - 1,
        'aria-label': label,
        title: label,
        'data-focus': `pin-${delta < 0 ? 'up' : 'down'}:${pin.itemId}`,
      },
      () => void reorderPins(ctx, moveId(ids, pin.itemId, delta)),
      arrow,
    );
  return h(
    'li',
    { class: 'pin-row', draggable: 'true', 'data-id': pin.itemId },
    h('span', { class: 'grip', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'pin-main' },
      button(
        { class: 'pin-open', 'data-focus': `pin:${pin.itemId}` },
        () => {
          selectItem(ctx, pin.itemId);
        },
        h('span', { class: 'pin-rank' }, String(index + 1)),
        kindIcon(pin.kind, 1, 'row-icon'),
        h('span', { class: 'pin-label' }, name),
      ),
      h(
        'div',
        { class: 'pin-extra' },
        !bare &&
          pin.note !== undefined &&
          pin.note !== '' &&
          h('p', { class: 'pin-note' }, pin.note),
        pin.snippet !== undefined && pin.snippet !== '' && h('span', { class: 'badge' }, 'excerpt'),
        mentioned === true && h('span', { class: 'badge badge-good' }, 'in Field Notes'),
        mentioned === false && h('span', { class: 'badge badge-warn' }, 'not mentioned'),
      ),
    ),
    h(
      'div',
      { class: 'pin-tools' },
      move(-1, 'Move up', '▲'),
      move(1, 'Move down', '▼'),
      button(
        { class: 'icon-button', 'aria-label': `Unpin ${name}`, title: 'Unpin' },
        () => void unpinItem(ctx, pin.itemId),
        '×',
      ),
    ),
  );
}

/** Native drag and drop on the list. Rows are rebuilt on render, so listen on the list itself. */
function wireDrag(list: HTMLOListElement, ctx: AppContext): void {
  let dragged: string | undefined;
  const rowOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('.pin-row') : null;

  list.addEventListener('dragstart', event => {
    const row = rowOf(event.target);
    dragged = row?.dataset.id;
    row?.classList.add('is-dragging');
    event.dataTransfer?.setData('text/plain', dragged ?? '');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', event => {
    if (dragged === undefined) return;
    event.preventDefault();
    for (const row of list.querySelectorAll('.drop-target')) row.classList.remove('drop-target');
    rowOf(event.target)?.classList.add('drop-target');
  });
  list.addEventListener('drop', event => {
    event.preventDefault();
    const target = rowOf(event.target)?.dataset.id;
    const session = currentSession(ctx.store.get());
    if (dragged === undefined || target === undefined || !session) return;
    const ids = session.pins.map(pin => pin.itemId);
    if (target !== dragged) void reorderPins(ctx, moveTo(ids, dragged, ids.indexOf(target)));
  });
  list.addEventListener('dragend', () => {
    dragged = undefined;
    for (const row of list.querySelectorAll('.is-dragging, .drop-target')) {
      row.classList.remove('is-dragging', 'drop-target');
    }
  });
}

async function copyCompact(ctx: AppContext): Promise<void> {
  const session = currentSession(ctx.store.get());
  const command = session ? buildCompactCommand(session.pins) : undefined;
  if (command === undefined) {
    ctx.toast('Pin something first.');
    return;
  }
  try {
    await navigator.clipboard.writeText(command);
    ctx.toast('Copied. Paste it into Claude Code when you want to camp.');
  } catch {
    ctx.toast('The browser blocked the clipboard.', 'error');
  }
}
