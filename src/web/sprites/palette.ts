/**
 * The shared palette. The first 15 keys are the base set. The rest are the documented additions:
 *   e  #86b9e2  mid sky, the band between deep blue and the horizon
 *   c  #bfe4ee  pale sky near the horizon, cloud shade
 *   f  #8fb3bf  distant mountains, softened by haze
 *   m  #6f9c86  far hills, a hazy green
 *   n  #4d8a55  near hills, between grass and tree green
 *   p  #8d5fc4  purple, a companion hat color
 *   a  #c8433a  swap slot for companion hats, defaults to red and is overridden per companion
 *   l  #94c766  sunlit leaf and grass tips, the top-left highlight on greens
 *   v  #7596a8  shaded mountain faces
 *   j  #5d8a78  far hill shade and far treeline
 *   1  #d39a74  skin shade, under the jaw and on the far hand
 *   2  #1d3868  denim shade, the far leg
 *   3  #8e2c2c  swap slot for the shade of a companion's hat, overridden per companion
 *   4  #dca676  trail dust, a pale tan that reads against the dirt
 */
// prettier-ignore
export const PALETTE: Record<string, string> = {
  k: '#1f1a24', w: '#f4efe6', g: '#9aa0a6', d: '#4a4e57',
  b: '#7a4527', B: '#b5683a', y: '#f2c14e', o: '#e8783a',
  r: '#c8433a', G: '#5fa05a', D: '#2f6b3b', u: '#4f8fd6',
  U: '#2b4f8a', s: '#f0c8a0', h: '#3a2a22',
  e: '#86b9e2', c: '#bfe4ee', f: '#8fb3bf', m: '#6f9c86',
  n: '#4d8a55', p: '#8d5fc4', a: '#c8433a', l: '#94c766',
  v: '#7596a8', j: '#5d8a78', 1: '#d39a74', 2: '#1d3868',
  3: '#8e2c2c', 4: '#dca676',
};

export type PaletteOverride = Readonly<Record<string, string>>;

/** Hat colors for companions as base and shade, indexed by `Companion.hat`. */
export const HAT_COLORS: readonly (readonly [string, string])[] = [
  ['#c8433a', '#8e2c2c'],
  ['#4f8fd6', '#2b4f8a'],
  ['#f2c14e', '#c4862c'],
  ['#8d5fc4', '#5e3b8c'],
  ['#5fa05a', '#2f6b3b'],
  ['#f4efe6', '#b9b3aa'],
];

export function hatPalette(hat: number): PaletteOverride {
  const index = ((Math.trunc(hat) % HAT_COLORS.length) + HAT_COLORS.length) % HAT_COLORS.length;
  const [base, shade] = HAT_COLORS[index] ?? ['#c8433a', '#8e2c2c'];
  return { a: base, 3: shade };
}
