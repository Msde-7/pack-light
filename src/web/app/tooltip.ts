import { h, replace } from './dom';

const GAP = 8;

export interface Tooltip {
  show: (anchor: HTMLElement, lines: string[]) => void;
  hide: () => void;
  /** Runs a re-render without letting restored focus pop the tooltip back up. */
  hold: (run: () => void) => void;
}

export function createTooltip(root: HTMLElement): Tooltip {
  const hide = (): void => {
    root.hidden = true;
  };
  let held = false;
  window.addEventListener('scroll', hide, true);
  return {
    hide,
    hold(run) {
      hide();
      held = true;
      try {
        run();
      } finally {
        held = false;
      }
    },
    show(anchor, lines) {
      if (held) return;
      const [title, ...rest] = lines;
      replace(root, h('strong', {}, title ?? ''), ...rest.map(line => h('span', {}, line)));
      root.hidden = false;
      place(root, anchor.getBoundingClientRect());
    },
  };
}

/** Prefers below the slot, flips above when it would leave the viewport. */
function place(tip: HTMLElement, anchor: DOMRect): void {
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  const left = Math.min(Math.max(GAP, anchor.left), window.innerWidth - width - GAP);
  const below = anchor.bottom + GAP;
  const top = below + height > window.innerHeight ? anchor.top - height - GAP : below;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(Math.max(GAP, top))}px`;
}
