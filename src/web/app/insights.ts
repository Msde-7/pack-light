import { formatTokens } from '../../core/format';
import type { SessionState, TrailTip } from '../../core/types';
import { selectItem } from './actions';
import { live } from './context';
import type { AppContext } from './context';
import { button, byId, h, renderRows } from './dom';
import { BARE_TIP_TEXT, itemName } from './format';
import { kindIcon } from './icon';
import { heaviest } from './inventory-model';
import type { Stack } from './inventory-model';
import { visibleStacks } from './inventory';
import { currentSession } from './store';
import type { AppState } from './store';

/** The trail notes panel, with the heaviest items and the trail tips. */
export function mountInsights(ctx: AppContext): void {
  const panel = byId('insights', HTMLElement);
  const heavy = byId('heaviest', HTMLElement);
  const heavyList = byId('heaviest-list', HTMLOListElement);
  const tips = byId('tips', HTMLElement);
  const tipList = byId('tips-list', HTMLUListElement);
  live(ctx, state => {
    const session = currentSession(state);
    const top = session ? heaviest(visibleStacks(session, state)) : [];
    panel.hidden = !session;
    heavy.hidden = top.length === 0;
    tips.hidden = !session;
    renderRows(heavyList, top, stack => heavyRow(stack, state.bare, ctx));
    renderRows(
      tipList,
      session ? visibleTips(session, state) : [],
      tip => tipRow(tip, state.bare, ctx),
      'No tips right now. The pack looks tidy.',
    );
  });
}

function heavyRow({ head, members, totalTokens }: Stack, bare: boolean, ctx: AppContext): Node {
  return h(
    'li',
    {},
    button(
      { class: 'row-button', 'data-focus': `heavy:${head.id}` },
      () => {
        selectItem(ctx, head.id);
      },
      kindIcon(head.kind, 1, 'row-icon'),
      h('span', { class: 'row-label' }, itemName(head, bare)),
      members.length > 1 && h('span', { class: 'row-meta' }, `x${members.length}`),
      h('span', { class: `row-size w-text-${head.weight}` }, formatTokens(totalTokens)),
    ),
  );
}

/** Tips for the selected agent that the user has not dismissed. */
export function visibleTips(session: SessionState, state: AppState): TrailTip[] {
  const dismissed = new Set(state.dismissedTips);
  const agentItems = new Set(
    session.items.filter(item => item.agentId === state.agent).map(item => item.id),
  );
  return session.tips.filter(
    tip =>
      !dismissed.has(tip.id) &&
      (tip.itemIds.length === 0 || tip.itemIds.some(id => agentItems.has(id))),
  );
}

function tipRow(tip: TrailTip, bare: boolean, ctx: AppContext): Node {
  const body = [
    h('span', { class: 'tip-text' }, bare ? BARE_TIP_TEXT[tip.kind] : tip.text),
    tip.wastedTokens !== undefined &&
      h('span', { class: 'tip-waste' }, `${formatTokens(tip.wastedTokens)} extra`),
  ];
  const [first] = tip.itemIds;
  const open =
    first === undefined
      ? h('div', { class: `tip tip-${tip.kind}` }, ...body)
      : button(
          { class: `tip tip-${tip.kind}`, 'data-focus': `tip:${tip.id}` },
          () => {
            selectItem(ctx, first, tip.itemIds);
          },
          ...body,
        );
  return h(
    'li',
    { class: 'tip-row' },
    open,
    button(
      { class: 'icon-button tip-dismiss', 'aria-label': 'Dismiss tip', title: 'Dismiss' },
      () => {
        ctx.store.set(s => ({ dismissedTips: [...s.dismissedTips, tip.id] }));
      },
      '×',
    ),
  );
}
