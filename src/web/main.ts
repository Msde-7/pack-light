import { selectItem, togglePin } from './app/actions';
import { ApiError, connectStream, createApi } from './app/api';
import { createToaster } from './app/context';
import type { AppContext } from './app/context';
import { mountDetail } from './app/detail';
import { mountDialogs, openHelp } from './app/dialogs';
import { byId } from './app/dom';
import { spriteCanvas } from './app/icon';
import { mountInsights } from './app/insights';
import { mountInventory } from './app/inventory';
import { findItem } from './app/inventory-model';
import { mountKeepList } from './app/keep-list';
import { mountLostFound } from './app/lost-found';
import { loadPrefs, persistPrefs } from './app/prefs';
import { mountScene } from './app/scene-view';
import type { SceneView } from './app/scene-view';
import { mountStamina } from './app/stamina';
import { applyMessage, createStore, currentSession, deriveState } from './app/store';
import type { AppState } from './app/store';
import { takeToken } from './app/token';
import { mountTopbar } from './app/topbar';
import { PALETTE } from './sprites/sprites';
import type { ServerMessage } from '../core/protocol';

function start(): void {
  applyPalette();
  const token = takeToken();
  const store = createStore<AppState>(
    {
      connection: token === undefined ? 'no_token' : 'connecting',
      sessions: [],
      agent: undefined,
      highlightIds: [],
      lostSelection: [],
      ...loadPrefs(),
    },
    deriveState,
  );
  persistPrefs(store);
  const ctx: AppContext = {
    store,
    api: token === undefined ? undefined : createApi(token),
    toast: createToaster(byId('toasts', HTMLElement)),
  };

  byId('brand-mark', HTMLElement).append(spriteCanvas('backpack', 2));
  mountDialogs(ctx);
  mountTopbar(ctx);
  mountStamina(ctx);
  const scene = mountScene(ctx);
  mountInventory(ctx);
  mountInsights(ctx);
  mountDetail(ctx);
  mountKeepList(ctx);
  mountLostFound(ctx);
  wireKeys(ctx, scene);
  if (token !== undefined) connect(ctx, token, scene);
}

function connect(ctx: AppContext, token: string, scene: SceneView): void {
  const receive = (message: ServerMessage): void => {
    if (message.type === 'cue') {
      if (message.sessionId === ctx.store.get().sessionId) scene.cue(message.cue);
      return;
    }
    ctx.store.set(state => ({ sessions: applyMessage(state.sessions, message) }));
  };
  connectStream(token, {
    onMessage: receive,
    onStatus: status => {
      ctx.store.set({ connection: status });
    },
  });
  ctx.api
    ?.sessions()
    .then(sessions => {
      receive({ type: 'snapshot', sessions });
    })
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        ctx.store.set({ connection: 'denied' });
      }
    });
}

function wireKeys(ctx: AppContext, scene: SceneView): void {
  document.addEventListener('keydown', event => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      isTyping(event.target)
    ) {
      return;
    }
    const state = ctx.store.get();
    if (event.key === 'Escape') {
      if (currentSession(state)?.phase === 'camping') scene.skipCamp();
      else if (state.itemId !== undefined) selectItem(ctx, undefined);
    } else if (event.key === '?') {
      openHelp();
    } else if (event.key === 'p' || event.key === 'P') {
      const item = findItem(currentSession(state), state.itemId);
      if (item) void togglePin(ctx, item);
    }
  });
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('dialog') !== null
  );
}

/** One palette for canvas and CSS. Keys are case sensitive, so `--p-g` and `--p-G` differ. */
function applyPalette(): void {
  for (const [key, color] of Object.entries(PALETTE)) {
    document.documentElement.style.setProperty(`--p-${key}`, color);
  }
}

start();
