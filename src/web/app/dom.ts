type Attrs = Record<string, string | number | boolean | undefined>;
export type Child = Node | string | false | null | undefined;

/** Builds an element. Attributes set to false or undefined are skipped, true sets an empty value. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== false) {
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }
  replace(element, ...children);
  return element;
}

export function button(attrs: Attrs, onClick: () => void, ...children: Child[]): HTMLButtonElement {
  const element = h('button', { type: 'button', ...attrs }, ...children);
  element.addEventListener('click', onClick);
  return element;
}

export function replace(parent: Element, ...children: Child[]): void {
  parent.replaceChildren(
    ...children.filter(child => child !== false && child !== null && child !== undefined),
  );
}

export function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Missing #${id}`);
  return element;
}

/** Inline code for UI copy such as "Run `packlight install`". */
export function withCode(text: string): (Node | string)[] {
  return text.split('`').map((part, index) => (index % 2 === 1 ? h('code', {}, part) : part));
}

/** Fills a list with rows, or with one quiet line when there are none. */
export function renderRows<T>(
  list: HTMLElement,
  items: readonly T[],
  row: (item: T, index: number) => Node,
  emptyText?: string,
): void {
  keepFocus(list, () => {
    if (items.length === 0 && emptyText !== undefined) {
      replace(list, h('li', { class: 'quiet' }, ...withCode(emptyText)));
    } else {
      replace(list, ...items.map(row));
    }
  });
}

/**
 * Panels rebuild their DOM on every server update. This keeps keyboard focus and a text caret
 * on the element with the same `data-focus` key so live updates never steal the user's place.
 */
export function keepFocus(root: HTMLElement, render: () => void): void {
  const active = document.activeElement;
  const key =
    active instanceof HTMLElement && root.contains(active) ? active.dataset.focus : undefined;
  const caret =
    active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
      ? { start: active.selectionStart, end: active.selectionEnd }
      : undefined;
  render();
  if (key === undefined) return;
  const next = root.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (caret && (next instanceof HTMLTextAreaElement || next instanceof HTMLInputElement)) {
    try {
      next.setSelectionRange(caret.start, caret.end);
    } catch {
      // Number inputs do not support selection ranges.
    }
  }
}
