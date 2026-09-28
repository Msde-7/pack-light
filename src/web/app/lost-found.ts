import { formatTokens } from '../../core/format';
import type { Item } from '../../core/types';
import { repackItems, selectItem } from './actions';
import { live } from './context';
import type { AppContext } from './context';
import { button, byId, h, renderRows } from './dom';
import { itemName } from './format';
import { kindIcon } from './icon';
import { itemsForAgent, lostItems } from './inventory-model';
import { currentSession } from './store';
import type { AppState } from './store';

const PENDING_TEXT: Partial<Record<Item['status'], string>> = {
  repack_queued: 'rides along next prompt',
  repacked: 'back in the pack',
};

export function mountLostFound(ctx: AppContext): void {
  const count = byId('lost-count', HTMLElement);
  const list = byId('lost-list', HTMLUListElement);
  const all = byId('lost-all', HTMLButtonElement);
  const repack = byId('repack', HTMLButtonElement);
  let droppedIds: string[] = [];
  all.addEventListener('click', () => {
    const everything = droppedIds.every(id => ctx.store.get().lostSelection.includes(id));
    ctx.store.set({ lostSelection: everything ? [] : droppedIds });
  });
  repack.addEventListener('click', () => void repackItems(ctx, ctx.store.get().lostSelection));

  live(ctx, state => {
    const session = currentSession(state);
    const items = session ? lostItems(itemsForAgent(session.items, state.agent)) : [];
    droppedIds = items.filter(item => item.status === 'dropped').map(item => item.id);
    const selected = state.lostSelection.filter(id => droppedIds.includes(id));
    count.textContent = droppedIds.length > 0 ? String(droppedIds.length) : '';
    repack.disabled = selected.length === 0;
    repack.textContent = selected.length > 0 ? `Repack ${selected.length}` : 'Repack selected';
    all.hidden = droppedIds.length < 2;
    all.textContent = selected.length === droppedIds.length ? 'Clear' : 'Select all';
    renderRows(
      list,
      items,
      item => lostRow(item, selected.includes(item.id), state, ctx),
      'Nothing left behind. Unpinned items stay at camp after a compaction.',
    );
  });
}

function lostRow(item: Item, checked: boolean, state: AppState, ctx: AppContext): HTMLLIElement {
  const id = `lost-${item.id}`;
  const pending = PENDING_TEXT[item.status];
  const box = h('input', {
    id,
    type: 'checkbox',
    class: 'check',
    disabled: pending !== undefined,
    'data-focus': `lost:${item.id}`,
  });
  box.checked = checked || item.status === 'repack_queued';
  box.addEventListener('change', () => {
    ctx.store.set(s => ({
      lostSelection: box.checked
        ? [...s.lostSelection, item.id]
        : s.lostSelection.filter(other => other !== item.id),
    }));
  });
  return h(
    'li',
    { class: `lost-row status-${item.status}` },
    box,
    h(
      'label',
      { for: id, class: 'lost-label' },
      kindIcon(item.kind, 1, 'row-icon'),
      h(
        'span',
        { class: 'lost-text' },
        h('span', { class: 'row-label' }, itemName(item, state.bare)),
        pending !== undefined && h('span', { class: 'badge badge-good' }, pending),
      ),
      h('span', { class: 'row-size' }, formatTokens(item.tokensEst)),
    ),
    button(
      { class: 'icon-button', 'aria-label': 'Show detail', title: 'Show detail' },
      () => {
        selectItem(ctx, item.id);
      },
      '›',
    ),
  );
}
