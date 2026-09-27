import { readFile, stat } from 'node:fs/promises';
import type { ExcerptResponse } from '../core/protocol';
import type { Item } from '../core/types';

const EXCERPT_MAX_LINES = 200;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type ExcerptResult =
  { ok: true; excerpt: ExcerptResponse } | { ok: false; status: number; error: string };

function rangeStart(item: Item): number {
  const start = Number.parseInt(item.range ?? '', 10);
  return Number.isFinite(start) && start > 0 ? start : 1;
}

function parseLine(value: string | null): number | undefined {
  if (value === null || !/^\d{1,9}$/.test(value)) return undefined;
  const n = Number(value);
  return n > 0 ? n : undefined;
}

function isFileItem(item: Item): item is Item & { path: string } {
  return item.path !== undefined && (item.kind === 'file_read' || item.kind === 'edit');
}

/** Lines of a file the session already read, so the UI can offer a snippet to pin. */
export async function readExcerpt(item: Item, query: URLSearchParams): Promise<ExcerptResult> {
  if (!isFileItem(item)) return { ok: false, status: 400, error: 'Only file items have excerpts.' };
  const start = parseLine(query.get('start')) ?? rangeStart(item);
  const wanted = parseLine(query.get('end')) ?? start + EXCERPT_MAX_LINES - 1;
  const end = Math.max(start, Math.min(wanted, start + EXCERPT_MAX_LINES - 1));
  try {
    const info = await stat(item.path);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) {
      return { ok: false, status: 413, error: 'That file is too big to excerpt.' };
    }
    const lines = (await readFile(item.path, 'utf8')).split(/\r?\n/);
    const last = Math.min(end, lines.length);
    return {
      ok: true,
      excerpt: {
        path: item.path,
        start,
        end: last,
        totalLines: lines.length,
        text: lines.slice(start - 1, last).join('\n'),
      },
    };
  } catch {
    return { ok: false, status: 404, error: 'The file is no longer there.' };
  }
}
