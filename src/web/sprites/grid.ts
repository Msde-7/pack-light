/** A sprite as equal-length rows. '.' is transparent, any other character is a palette key. */
export type Grid = readonly string[];

const CLEAR = '.';

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** The 4x4 ordered-dither threshold at (x, y), 0 to 15. */
export function bayer(x: number, y: number): number {
  return BAYER[y & 3]?.[x & 3] ?? 0;
}

export function blankGrid(width: number, height: number): string[] {
  return Array.from({ length: height }, () => CLEAR.repeat(width));
}

export function gridWidth(grid: Grid): number {
  return grid[0]?.length ?? 0;
}

/** Copies the opaque pixels of `part` onto `base` at (x, y), clipping at the edges. */
export function stamp(base: Grid, part: Grid, x: number, y: number): string[] {
  return base.map((row, r) => {
    const source = part[r - y];
    if (source === undefined) return row;
    const cells = row.split('');
    for (let c = 0; c < source.length; c++) {
      const key = source.charAt(c);
      if (key !== CLEAR && x + c >= 0 && x + c < cells.length) cells[x + c] = key;
    }
    return cells.join('');
  });
}

/** Box around the opaque pixels, or undefined when the grid is empty. */
export function opaqueBounds(
  grid: Grid,
): { x: number; y: number; width: number; height: number } | undefined {
  const cells = grid.flatMap((row, r) =>
    row.split('').flatMap((key, c) => (key === CLEAR ? [] : [{ r, c }])),
  );
  if (cells.length === 0) return undefined;
  const xs = cells.map(cell => cell.c);
  const ys = cells.map(cell => cell.r);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x + 1, height: Math.max(...ys) - y + 1 };
}
