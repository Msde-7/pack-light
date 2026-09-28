import type { Companion } from '../../core/types';
import { live } from './context';
import type { AppContext } from './context';
import { byId, h, keepFocus, replace } from './dom';
import { PHASE_LABEL, plural } from './format';
import { itemsForAgent } from './inventory-model';
import { currentSession, orderSessions } from './store';
import type { AppState, Connection } from './store';

const CONNECTION_TEXT: Record<Connection, string> = {
  connecting: 'Connecting',
  live: '',
  reconnecting: 'Reconnecting',
  no_token: 'No token',
  denied: 'Token rejected',
};

export function mountTopbar(ctx: AppContext): void {
  const sessions = byId('session-tabs', HTMLElement);
  const agents = byId('agent-tabs', HTMLElement);
  const connection = byId('connection', HTMLElement);
  live(ctx, state => {
    keepFocus(sessions, () => {
      renderSessions(sessions, state, ctx);
    });
    keepFocus(agents, () => {
      renderAgents(agents, state, ctx);
    });
    const text = CONNECTION_TEXT[state.connection];
    connection.textContent = text;
    connection.hidden = text === '';
    connection.dataset.state = state.connection;
  });
}

function renderSessions(root: HTMLElement, state: AppState, ctx: AppContext): void {
  const sessions = orderSessions(state.sessions);
  const tabs = sessions.map((session, index) => {
    const selected = session.sessionId === state.sessionId;
    const name = state.bare ? `Session ${index + 1}` : session.title;
    return h(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: 'tab',
        'aria-selected': String(selected),
        tabindex: selected ? 0 : -1,
        title: state.bare
          ? PHASE_LABEL[session.phase]
          : `${session.cwd}\n${PHASE_LABEL[session.phase]}`,
        'data-focus': `session:${session.sessionId}`,
        'data-id': session.sessionId,
      },
      h('span', { class: `dot dot-${session.phase}`, 'aria-hidden': 'true' }),
      h('span', { class: 'tab-name' }, name),
      h('span', { class: 'sr-only' }, `, ${PHASE_LABEL[session.phase]}`),
    );
  });
  replace(root, ...tabs);
  wireTabs(root, id => {
    ctx.store.set({
      sessionId: id,
      agent: undefined,
      itemId: undefined,
      highlightIds: [],
      lostSelection: [],
    });
  });
}

function renderAgents(root: HTMLElement, state: AppState, ctx: AppContext): void {
  const session = currentSession(state);
  const companions = session ? Object.values(session.subagents) : [];
  root.hidden = companions.length === 0;
  if (!session || companions.length === 0) {
    root.replaceChildren();
    return;
  }
  const main = agentTab(
    'main',
    'Main',
    itemsForAgent(session.items, undefined).length,
    state.agent === undefined,
  );
  const others = companions.map((companion, index) =>
    agentTab(
      companion.agentId,
      state.bare ? `Companion ${index + 1}` : companion.agentType,
      companion.items.length,
      state.agent === companion.agentId,
      companion,
    ),
  );
  replace(root, main, ...others);
  wireTabs(root, id => {
    ctx.store.set({ agent: id === 'main' ? undefined : id, itemId: undefined, highlightIds: [] });
  });
}

function agentTab(
  id: string,
  name: string,
  count: number,
  selected: boolean,
  companion?: Companion,
): HTMLButtonElement {
  const where = companion?.status === 'active' ? 'on the trail' : 'back at the pack';
  return h(
    'button',
    {
      type: 'button',
      role: 'tab',
      class: `tab agent-tab${companion ? ` hat-${companion.hat % 6}` : ''}`,
      'aria-selected': String(selected),
      tabindex: selected ? 0 : -1,
      title: companion ? `${plural(count, 'item')}, ${where}` : plural(count, 'item'),
      'data-focus': `agent:${id}`,
      'data-id': id,
    },
    companion && h('span', { class: 'hat', 'aria-hidden': 'true' }),
    h('span', { class: 'tab-name' }, name),
    h('span', { class: 'tab-count' }, String(count)),
    companion?.status === 'returned' && h('span', { class: 'sr-only' }, ', returned'),
  );
}

const ARROW_STEP: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };

/** Tablist keyboard pattern: arrows move between tabs, activation follows focus. */
function wireTabs(root: HTMLElement, activate: (id: string) => void): void {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  tabs.forEach((tab, index) => {
    const id = tab.dataset.id ?? '';
    tab.addEventListener('click', () => {
      activate(id);
    });
    tab.addEventListener('keydown', event => {
      const step = ARROW_STEP[event.key];
      if (step === undefined) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      next?.focus();
      if (next?.dataset.id !== undefined) activate(next.dataset.id);
    });
  });
}
