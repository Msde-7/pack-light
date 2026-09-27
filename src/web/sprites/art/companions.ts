import { blankGrid, stamp } from '../grid';
import type { Grid } from '../grid';

/**
 * Companions, 12x16, facing right. The pom beanie uses the swap keys `a` and `3`, recolored per
 * companion with `hatPalette`, so every hat has the same shape. A satchel rides on the hip.
 */

const WIDTH = 12;
const HEIGHT = 16;

// prettier-ignore
const HEAD: Grid = [
  '.....kk.....',
  '....kwwk....',
  '...kkaakk...',
  '..kaaaaa3k..',
  '..k333333k..',
  '..khssssk...',
  '..khsskssk..',
  '...k1sssk...',
];

const BLINK = HEAD.map((row, r) => (r === 6 ? '..khss1ssk..' : row));

// prettier-ignore
const TORSO_DOWN: Grid = [
  '..kUUUbUk...',
  '..kUUbU2k...',
  '..kbUUUsk...',
];

// prettier-ignore
const TORSO_FORWARD: Grid = [
  '..kUUUbUk...',
  '..kUUbUU2k..',
  '..kbUUUUksk.',
  '.........k..',
];

// prettier-ignore
const TORSO_BACK: Grid = [
  '..kUUUbUk...',
  '..k2UbUUk...',
  '..kbUUUUk...',
];

// prettier-ignore
const SATCHEL: Grid = [
  'kkkk',
  'kBBk',
  'kbyk',
  'kkkk',
];

// prettier-ignore
const LEG_FORWARD: Grid = [
  '...kdddk....',
  '....kddk....',
  '.....kddk...',
  '.....kbbbk..',
  '.....kkkkk..',
];

// prettier-ignore
const LEG_PLANTED: Grid = [
  '...kdddk....',
  '....kddk....',
  '....kddk....',
  '....kbbbk...',
  '....kkkkk...',
];

// prettier-ignore
const LEG_UNDER: Grid = [
  '...kdddk....',
  '...kddk.....',
  '...kddk.....',
  '...kbbbk....',
  '...kkkkk....',
];

// prettier-ignore
const LEG_BACK: Grid = [
  '...kdddk....',
  '..kddk......',
  '.kddk.......',
  'kbbk........',
  '.kkk........',
];

// prettier-ignore
const LEG_LIFT: Grid = [
  '...kdddk....',
  '..kddk......',
  '.kbbk.......',
  '.kkk........',
  '............',
];

// prettier-ignore
const LEG_SWING: Grid = [
  '...kdddk....',
  '...kddk.....',
  '..kbbbk.....',
  '..kkkk......',
  '............',
];

const far = (leg: Grid): Grid => leg.map(row => row.replaceAll('d', 'h'));

interface Pose {
  near: Grid;
  far: Grid;
  torso: Grid;
  bob: number;
}

function companion({ near, far: back, torso, bob }: Pose, head = HEAD): string[] {
  const parts: [Grid, number, number][] = [
    [far(back), 0, 11],
    [near, 0, 11],
    [torso, 0, 8 + bob],
    [head, 0, bob],
    [SATCHEL, 0, 10 + bob],
  ];
  return parts.reduce<string[]>(
    (grid, [part, x, y]) => stamp(grid, part, x, y),
    blankGrid(WIDTH, HEIGHT),
  );
}

/** The same six beats as the hiker's walk, scaled to a shorter stride. */
const WALK: readonly Pose[] = [
  { near: LEG_FORWARD, far: LEG_BACK, torso: TORSO_BACK, bob: 1 },
  { near: LEG_PLANTED, far: LEG_LIFT, torso: TORSO_BACK, bob: 1 },
  { near: LEG_UNDER, far: LEG_SWING, torso: TORSO_DOWN, bob: 0 },
  { near: LEG_BACK, far: LEG_FORWARD, torso: TORSO_FORWARD, bob: 1 },
  { near: LEG_LIFT, far: LEG_PLANTED, torso: TORSO_FORWARD, bob: 1 },
  { near: LEG_SWING, far: LEG_UNDER, torso: TORSO_DOWN, bob: 0 },
];

const STAND: Pose = { near: LEG_UNDER, far: LEG_PLANTED, torso: TORSO_DOWN, bob: 1 };

export const COMPANION_SPRITES: Record<string, Grid> = {
  ...Object.fromEntries(WALK.map((pose, i) => [`buddy_walk_${i + 1}`, companion(pose)])),
  buddy_stand: companion(STAND),
  buddy_blink: companion(STAND, BLINK),
};
