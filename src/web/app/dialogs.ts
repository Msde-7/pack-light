import { live } from './context';
import type { AppContext } from './context';
import { byId } from './dom';
import { isMotion } from './prefs';
import { prefersReducedMotion } from './scene-view';

/** Settings and help live in static <dialog> markup. This wires their controls to the store. */
export function mountDialogs(ctx: AppContext): void {
  const settings = byId('settings', HTMLDialogElement);
  const help = byId('help', HTMLDialogElement);
  byId('open-settings', HTMLButtonElement).addEventListener('click', () => {
    settings.showModal();
  });
  byId('open-help', HTMLButtonElement).addEventListener('click', openHelp);
  for (const dialog of [settings, help]) {
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
  }

  const bare = byId('bare-mode', HTMLInputElement);
  bare.addEventListener('change', () => {
    ctx.store.set({ bare: bare.checked });
  });
  const motions = [...settings.querySelectorAll<HTMLInputElement>('input[name="motion"]')];
  for (const radio of motions) {
    radio.addEventListener('change', () => {
      if (isMotion(radio.value)) ctx.store.set({ motion: radio.value });
    });
  }

  live(ctx, state => {
    bare.checked = state.bare;
    for (const radio of motions) radio.checked = radio.value === state.motion;
    document.body.classList.toggle('reduce-motion', prefersReducedMotion(state.motion));
  });
}

export function openHelp(): void {
  const help = byId('help', HTMLDialogElement);
  if (!help.open) help.showModal();
}
