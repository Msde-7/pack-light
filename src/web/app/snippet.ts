import type { ExcerptResponse } from '../../core/protocol';
import { LIMITS } from '../../core/types';
import type { Item } from '../../core/types';
import { pinItem } from './actions';
import type { DetailProps } from './detail';
import { button, h } from './dom';

export interface SnippetDraft {
  start: number;
  end: number;
  excerpt?: ExcerptResponse;
  loading: boolean;
  error?: string;
  /** Remembers the disclosure state across live re-renders. */
  open?: boolean;
}

interface Range {
  start: number;
  end: number;
}

const DEFAULT_SPAN = 30;

export function isSnippetable(item: Item): boolean {
  return item.kind === 'file_read' && item.path !== undefined;
}

/** Starts from the lines the item actually read, such as "40-58", else the top of the file. */
export function initialRange(range: string | undefined): Range {
  const match = /^(\d+)\s*-\s*(\d+)$/.exec(range ?? '');
  const start = Number(match?.[1] ?? 1);
  const end = Number(match?.[2] ?? DEFAULT_SPAN);
  if (!match || start < 1 || end < start) return { start: 1, end: DEFAULT_SPAN };
  return { start, end };
}

export function clampRange(start: number, end: number, totalLines?: number): Range {
  const last = totalLines ?? Number.MAX_SAFE_INTEGER;
  const from = Math.min(Math.max(1, Math.floor(start) || 1), last);
  const to = Math.min(Math.max(from, Math.floor(end) || from), last);
  return { start: from, end: to };
}

export function snippetFits(text: string): boolean {
  return text.length <= LIMITS.snippetChars;
}

/** Numbered lines for the preview. The kept snippet is the raw text without numbers. */
export function numberedLines(excerpt: ExcerptResponse): { number: number; text: string }[] {
  return excerpt.text.split('\n').map((text, index) => ({ number: excerpt.start + index, text }));
}

/** Lets the user pick a line range of a file item and keep it verbatim with the pin. */
export function renderSnippetEditor(props: DetailProps): HTMLElement | null {
  const { item, pin } = props;
  if (!isSnippetable(item)) return null;
  const kept = pin?.snippet ?? item.pinnedSnippet;
  const { snippet } = props.draft;
  const details = h(
    'details',
    { class: 'field snippet', open: snippet.open ?? kept !== undefined },
    h(
      'summary',
      { 'data-focus': 'snippet:summary' },
      kept === undefined ? 'Keep an excerpt' : 'Kept excerpt',
    ),
    kept !== undefined && keptView(props, kept),
    rangePicker(props),
    preview(props),
  );
  details.addEventListener('toggle', () => {
    snippet.open = details.open;
  });
  return details;
}

function keptView({ item, ctx }: DetailProps, kept: string): HTMLElement {
  return h(
    'div',
    { class: 'kept' },
    h('pre', { class: 'mono excerpt' }, kept),
    h(
      'div',
      { class: 'button-row' },
      h('span', { class: 'quiet' }, `${kept.length} characters kept`),
      button(
        { class: 'btn btn-small', 'data-focus': 'snippet:remove' },
        () => void pinItem(ctx, item, { snippet: '' }),
        'Remove',
      ),
    ),
  );
}

function rangePicker(props: DetailProps): HTMLElement {
  const { snippet } = props.draft;
  const start = numberInput('snippet-start', snippet.start, 'snippet:start');
  const end = numberInput('snippet-end', snippet.end, 'snippet:end');
  const sync = (): void => {
    snippet.start = start.valueAsNumber;
    snippet.end = end.valueAsNumber;
  };
  start.addEventListener('input', sync);
  end.addEventListener('input', sync);
  return h(
    'div',
    { class: 'range' },
    h('label', { for: 'snippet-start' }, 'Lines'),
    start,
    h('label', { for: 'snippet-end' }, 'to'),
    end,
    button(
      { class: 'btn btn-small', 'data-focus': 'snippet:load', disabled: snippet.loading },
      () => void loadExcerpt(props),
      snippet.loading ? 'Loading' : 'Load lines',
    ),
  );
}

function numberInput(id: string, value: number, focus: string): HTMLInputElement {
  const input = h('input', {
    id,
    type: 'number',
    class: 'input input-num',
    min: 1,
    step: 1,
    'data-focus': focus,
  });
  input.valueAsNumber = value;
  return input;
}

async function loadExcerpt({ ctx, session, item, draft, rerender }: DetailProps): Promise<void> {
  if (!ctx.api) return;
  const { snippet } = draft;
  const range = clampRange(snippet.start, snippet.end, snippet.excerpt?.totalLines);
  Object.assign(snippet, range, { loading: true, error: undefined });
  rerender();
  try {
    const excerpt = await ctx.api.excerpt(session.sessionId, item.id, range.start, range.end);
    Object.assign(snippet, { excerpt, start: excerpt.start, end: excerpt.end });
  } catch {
    snippet.error = 'Could not read that file. It may have moved.';
  }
  snippet.loading = false;
  rerender();
}

function preview({ draft, ctx, item }: DetailProps): HTMLElement {
  const { error, excerpt } = draft.snippet;
  if (error !== undefined) return h('p', { class: 'flag flag-bad' }, error);
  if (!excerpt) return h('p', { class: 'quiet' }, 'Load a few lines to keep them word for word.');
  const fits = snippetFits(excerpt.text);
  const lines = numberedLines(excerpt).map(line =>
    h(
      'span',
      { class: 'line' },
      h('span', { class: 'ln', 'aria-hidden': 'true' }, String(line.number)),
      line.text,
    ),
  );
  return h(
    'div',
    { class: 'preview' },
    h(
      'pre',
      {
        class: 'mono excerpt',
        tabindex: 0,
        'aria-label': `Lines ${excerpt.start} to ${excerpt.end}`,
      },
      ...lines,
    ),
    h(
      'div',
      { class: 'button-row' },
      h(
        'span',
        { class: fits ? 'counter' : 'counter over' },
        `${excerpt.text.length} / ${LIMITS.snippetChars}`,
      ),
      !fits && h('span', { class: 'quiet' }, 'Too long. Pick fewer lines.'),
      button(
        { class: 'btn btn-primary btn-small', disabled: !fits, 'data-focus': 'snippet:keep' },
        () => void pinItem(ctx, item, { snippet: excerpt.text }),
        'Keep these lines',
      ),
    ),
    h('p', { class: 'quiet' }, `The file has ${excerpt.totalLines} lines.`),
  );
}
