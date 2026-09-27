const CONTEXT_LINES = 2;

interface Op {
  kind: ' ' | '+' | '-';
  line: string;
}

function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Longest common subsequence over the changed middle, which is small for settings edits. */
function middleOps(before: readonly string[], after: readonly string[]): Op[] {
  const rows = before.length + 1;
  const cols = after.length + 1;
  const table = new Uint32Array(rows * cols);
  const at = (row: number, col: number): number => table[row * cols + col] ?? 0;
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        before[i] === after[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const b = before[i];
    const a = after[j];
    if (b !== undefined && b === a) {
      ops.push({ kind: ' ', line: b });
      i++;
      j++;
    } else if (b !== undefined && (a === undefined || at(i + 1, j) >= at(i, j + 1))) {
      ops.push({ kind: '-', line: b });
      i++;
    } else if (a !== undefined) {
      ops.push({ kind: '+', line: a });
      j++;
    }
  }
  return ops;
}

function diffOps(before: readonly string[], after: readonly string[]): Op[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  const same = (line: string): Op => ({ kind: ' ', line });
  return [
    ...before.slice(0, start).map(same),
    ...middleOps(before.slice(start, before.length - end), after.slice(start, after.length - end)),
    ...before.slice(before.length - end).map(same),
  ];
}

function visibleLines(ops: readonly Op[]): boolean[] {
  const visible = ops.map(() => false);
  ops.forEach((op, index) => {
    if (op.kind === ' ') return;
    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(ops.length - 1, index + CONTEXT_LINES);
    for (let at = from; at <= to; at++) visible[at] = true;
  });
  return visible;
}

/** A readable line diff with a little context around each change. Empty when nothing changed. */
export function lineDiff(before: string, after: string): string {
  const ops = diffOps(splitLines(before), splitLines(after));
  const visible = visibleLines(ops);
  const out: string[] = [];
  ops.forEach((op, index) => {
    if (!visible[index]) return;
    if (index > 0 && visible[index - 1] !== true) out.push('  …');
    out.push(`${op.kind} ${op.line}`);
  });
  return out.join('\n');
}
