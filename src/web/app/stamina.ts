import { compactNumber, percent } from '../../core/format';
import type { SessionState } from '../../core/types';
import { live } from './context';
import type { AppContext } from './context';
import { byId, h, replace } from './dom';
import type { Child } from './dom';
import { SOURCE_LABEL } from './format';
import { currentSession } from './store';

const SEGMENTS = 20;

/** Matches the scene's trail signs, so the bar warns at the same points the hiker does. */
export function fillLevel(fill: number): 'fresh' | 'ahead' | 'soon' | 'now' {
  if (fill >= 0.9) return 'now';
  if (fill >= 0.75) return 'soon';
  if (fill >= 0.6) return 'ahead';
  return 'fresh';
}

const LEVEL_TEXT = { fresh: 'Fresh legs', ahead: 'Camp ahead', soon: 'Camp soon', now: 'Camp now' };

export function mountStamina(ctx: AppContext): void {
  const root = byId('stamina', HTMLElement);
  live(ctx, state => {
    const session = currentSession(state);
    root.hidden = !session;
    if (session) replace(root, ...content(session));
  });
}

function content(session: SessionState): Child[] {
  const level = fillLevel(session.fill);
  const lit = Math.round(Math.min(1, Math.max(0, session.fill)) * SEGMENTS);
  const segments = Array.from({ length: SEGMENTS }, (_, index) =>
    h('span', { class: index < lit ? 'seg on' : 'seg' }),
  );
  const bar = h(
    'div',
    {
      class: `bar bar-${level}`,
      role: 'meter',
      'aria-label': 'Stamina used before camp',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': Math.round(session.fill * 100),
      'aria-valuetext': `${percent(session.fill)} of the way to camp`,
    },
    ...segments,
  );
  return [
    h('span', { class: 'stamina-label' }, 'Stamina'),
    bar,
    h('strong', { class: `stamina-pct level-${level}` }, percent(session.fill)),
    h('span', { class: 'stamina-level' }, LEVEL_TEXT[level]),
    h(
      'span',
      { class: 'stamina-tokens', title: 'Context used / context window' },
      `≈${compactNumber(session.contextTokens)} / ${compactNumber(session.windowTokens)}`,
    ),
    h(
      'span',
      { class: 'stamina-window', title: 'Share of the raw context window' },
      `window ${percent(session.windowFill)}`,
    ),
    session.model !== undefined && h('span', { class: 'stamina-model' }, session.model),
    h(
      'span',
      {
        class: `badge source-${session.contextSource}`,
        title: 'Where the context size comes from',
      },
      SOURCE_LABEL[session.contextSource],
    ),
  ];
}
