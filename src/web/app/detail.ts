import { LIMITS } from '../../core/types';
import type { Item, Pin, SessionState } from '../../core/types';
import { formatTokens } from '../../core/format';
import { pinFor, pinItem, repackItems, selectItem, unpinItem } from './actions';
import type { AppContext } from './context';
import { button, byId, h, keepFocus, replace } from './dom';
import type { Child } from './dom';
import { KIND_LABEL, STATUS_LABEL, itemName, itemPath } from './format';
import { kindIcon } from './icon';
import { duplicateCount, findItem, pinnedIds } from './inventory-model';
import { initialRange, renderSnippetEditor } from './snippet';
import type { SnippetDraft } from './snippet';
import { currentSession } from './store';

interface Draft {
  note: string;
  snippet: SnippetDraft;
}

export interface DetailProps {
  session: SessionState;
  item: Item;
  pin: Pin | undefined;
  pinned: boolean;
  draft: Draft;
  ctx: AppContext;
  rerender: () => void;
}

export function mountDetail(ctx: AppContext): void {
  const root = byId('detail', HTMLElement);
  const body = byId('detail-body', HTMLElement);
  const drafts = new Map<string, Draft>();
  const render = (): void => {
    const state = ctx.store.get();
    const session = currentSession(state);
    const item = findItem(session, state.itemId);
    root.classList.toggle('is-open', item !== undefined);
    document.body.classList.toggle('sheet-open', item !== undefined);
    keepFocus(body, () => {
      if (!session || !item) {
        replace(
          body,
          h('p', { class: 'quiet' }, 'Pick an item to see what it weighs and pin it for camp.'),
        );
        return;
      }
      const pin = pinFor(session, item.id);
      let draft = drafts.get(item.id);
      if (!draft) {
        draft = {
          note: pin?.note ?? item.note ?? '',
          snippet: { ...initialRange(item.range), loading: false },
        };
        drafts.set(item.id, draft);
      }
      const pinned = pinnedIds(session).has(item.id);
      const props = { session, item, pin, pinned, draft, ctx, rerender: render };
      replace(body, ...detailView(props, state.bare));
    });
  };
  ctx.store.subscribe((state, previous) => {
    const changed =
      state.itemId !== previous.itemId ||
      state.sessions !== previous.sessions ||
      state.sessionId !== previous.sessionId ||
      state.bare !== previous.bare;
    if (changed) render();
  });
  render();
}

function detailView(props: DetailProps, bare: boolean): Child[] {
  const { item, ctx } = props;
  const path = itemPath(item, bare);
  return [
    h(
      'div',
      { class: 'detail-head' },
      kindIcon(item.kind, 3, 'detail-icon'),
      h(
        'div',
        { class: 'detail-title' },
        h('h3', {}, itemName(item, bare)),
        path !== undefined && h('p', { class: 'mono path' }, path),
      ),
      button(
        {
          class: 'icon-button detail-close',
          'aria-label': 'Close detail',
          'data-focus': 'detail:close',
        },
        () => {
          selectItem(ctx, undefined);
        },
        '×',
      ),
    ),
    facts(props),
    ...flags(props),
    actions(props),
    ...(bare
      ? [h('p', { class: 'quiet' }, 'Notes and excerpts are hidden in bare mode.')]
      : [noteEditor(props), renderSnippetEditor(props)]),
  ];
}

function facts({ session, item, pinned }: DetailProps): HTMLElement {
  const copies = duplicateCount(session, item);
  const rows: [string, string][] = [
    ['Size', `${formatTokens(item.tokensEst)} tokens`],
    ['Weight', item.weight],
    ['Turn', String(item.turn)],
    ['Kind', KIND_LABEL[item.kind]],
    ['Status', STATUS_LABEL[pinned ? 'pinned' : item.status]],
  ];
  if (copies > 1) rows.push(['Carried', `${copies} times`]);
  return h(
    'dl',
    { class: 'facts' },
    ...rows.flatMap(([term, value]) => [
      h('dt', {}, term),
      h('dd', { class: term === 'Weight' ? `w-text-${item.weight}` : undefined }, value),
    ]),
  );
}

function flags({ item, pinned }: DetailProps): Child[] {
  const mentioned = pinned ? item.mentionedInSummary : undefined;
  return [
    mentioned === true && h('p', { class: 'flag flag-good' }, 'Mentioned in Field Notes'),
    mentioned === false &&
      h(
        'p',
        { class: 'flag flag-warn' },
        'Not mentioned in Field Notes. The pin brings it back anyway.',
      ),
    item.failed === true &&
      h('p', { class: 'flag flag-bad' }, 'This call failed. Its error message still takes space.'),
    item.stale === true &&
      h('p', { class: 'flag' }, 'Not touched in a while. Safe to leave at camp.'),
  ];
}

function actions({ item, pinned, ctx }: DetailProps): HTMLElement {
  const row = (...children: Child[]): HTMLElement => h('div', { class: 'button-row' }, ...children);
  if (item.status === 'sewn_in') {
    return row(h('p', { class: 'quiet' }, 'Sewn in. It comes back after camp on its own.'));
  }
  if (item.status === 'dropped') {
    return row(
      button(
        { class: 'btn btn-primary', 'data-focus': 'detail:repack' },
        () => void repackItems(ctx, [item.id]),
        'Repack',
      ),
      h('span', { class: 'quiet' }, 'Left at the last camp.'),
    );
  }
  return row(
    button(
      {
        class: pinned ? 'btn' : 'btn btn-primary',
        'aria-pressed': String(pinned),
        'data-focus': 'detail:pin',
        'aria-keyshortcuts': 'P',
      },
      () => void (pinned ? unpinItem(ctx, item.id) : pinItem(ctx, item)),
      pinned ? 'Unpin' : '★ Pin',
    ),
    h('span', { class: 'quiet' }, pinned ? 'Survives camp.' : 'Press P to pin.'),
  );
}

function noteEditor({ item, pin, pinned, draft, ctx }: DetailProps): HTMLElement {
  const saved = pin?.note ?? '';
  const counter = h('span', { class: 'counter', 'aria-live': 'polite' });
  const area = h('textarea', {
    id: 'note-input',
    class: 'input',
    rows: 3,
    maxlength: LIMITS.noteChars,
    placeholder: 'Why this matters, in a line or two',
    'data-focus': 'detail:note',
  });
  area.value = draft.note;
  const save = button(
    { class: 'btn', 'data-focus': 'detail:save-note' },
    () => void pinItem(ctx, item, { note: area.value.trim() }),
    pinned ? 'Save note' : 'Pin with note',
  );
  const sync = (): void => {
    draft.note = area.value;
    counter.textContent = `${area.value.length} / ${LIMITS.noteChars}`;
    save.disabled = pinned && area.value.trim() === saved.trim();
  };
  area.addEventListener('input', sync);
  sync();
  return h(
    'div',
    { class: 'field' },
    h('div', { class: 'field-head' }, h('label', { for: 'note-input' }, 'Note'), counter),
    area,
    h('div', { class: 'button-row' }, save),
  );
}
