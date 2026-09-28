import type { Api } from './api';
import { h } from './dom';
import type { AppState, Store } from './store';

type ToastTone = 'info' | 'error';

/** What every panel needs. `api` is missing until a token is known. */
export interface AppContext {
  store: Store<AppState>;
  api: Api | undefined;
  toast(text: string, tone?: ToastTone): void;
}

/** Renders now and again after every state change. */
export function live(ctx: AppContext, render: (state: AppState) => void): void {
  ctx.store.subscribe(render);
  render(ctx.store.get());
}

const TOAST_MS = 3500;
const MAX_TOASTS = 3;

export function createToaster(region: HTMLElement): AppContext['toast'] {
  return (text, tone = 'info') => {
    const toast = h('div', { class: `toast toast-${tone}` }, text);
    region.append(toast);
    while (region.childElementCount > MAX_TOASTS) region.firstElementChild?.remove();
    setTimeout(() => {
      toast.remove();
    }, TOAST_MS);
  };
}
