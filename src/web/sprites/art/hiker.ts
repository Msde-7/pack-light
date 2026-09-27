import { blankGrid, stamp } from '../grid';
import type { Grid } from '../grid';

const HIKER_WIDTH = 16;
const HIKER_HEIGHT = 20;

// Parts are full-width rows so they stamp at x = 0. The pack is a separate layer drawn behind
// the hiker, so the back (column 5 when upright) is bare here and the pack covers it.

// prettier-ignore
const HEAD: Grid = [
  '......kkkk......',
  '.....khhhhk.....',
  '.....khhssk.....',
  '.....khskssk....',
  '.....k1sssk.....',
  '......kkkk......',
];

const headWith = (row: number, line: string): Grid =>
  HEAD.map((current, r) => (r === row ? line : current));

const HEAD_BLINK = headWith(3, '.....khs1ssk....');
const HEAD_TIRED = headWith(2, '.....khhhhk.....');
const HEAD_PANT = headWith(4, '.....k1ssrk.....');

// The near arm is a shaded stripe on the shirt, as it swings. A strap crosses the shoulder.
// prettier-ignore
const ARM_DOWN: Grid = [
  '.....kbGGGk.....',
  '.....kbGDGGk....',
  '.....kGGDGk.....',
  '.....kGGDGk.....',
  '.....kGGsGk.....',
  '.....kbbbbk.....',
];

// prettier-ignore
const ARM_FORWARD: Grid = [
  '.....kbGGGk.....',
  '.....kbGDGGk....',
  '.....kGGGDGk....',
  '.....kGGGGDsk...',
  '.....kGGGGkk....',
  '.....kbbbbk.....',
];

// prettier-ignore
const ARM_BACK: Grid = [
  '.....kbGGGk.....',
  '.....kGDGGGk....',
  '.....kDGGGk.....',
  '....ksGGGGk.....',
  '....kkGGGGk.....',
  '.....kbbbbk.....',
];

// Legs, drawn one at a time so the far leg can sit behind the near one in a darker denim.
// Each starts at the hips and ends in a boot on the ground line, row 7.

// prettier-ignore
const LEG_FORWARD: Grid = [
  '.....kUUUUk.....',
  '......kUUUUk....',
  '.......kUUUk....',
  '........kUUk....',
  '........kUUk....',
  '.........kUUkk..',
  '.........kbbbbk.',
  '.........kkkkkk.',
];

// prettier-ignore
const LEG_PLANTED: Grid = [
  '.....kUUUUk.....',
  '......kUUUk.....',
  '......kUUUk.....',
  '.......kUUk.....',
  '.......kUUk.....',
  '.......kUUkk....',
  '.......kbbbbk...',
  '.......kkkkkk...',
];

// prettier-ignore
const LEG_UNDER: Grid = [
  '.....kUUUUk.....',
  '.....kUUUk......',
  '.....kUUUk......',
  '.....kUUk.......',
  '.....kUUk.......',
  '.....kUUkk......',
  '.....kbbbbk.....',
  '.....kkkkkk.....',
];

// prettier-ignore
const LEG_BACK: Grid = [
  '.....kUUUUk.....',
  '....kUUUk.......',
  '....kUUk........',
  '...kUUk.........',
  '...kUUk.........',
  '..kUUk..........',
  '.kbbbk..........',
  '..kkkk..........',
];

// prettier-ignore
const LEG_LIFT: Grid = [
  '.....kUUUUk.....',
  '.....kUUUk......',
  '....kUUUk.......',
  '....kUUk........',
  '...kUUk.........',
  '..kbbbk.........',
  '..kkkk..........',
  '................',
];

// prettier-ignore
const LEG_SWING: Grid = [
  '.....kUUUUk.....',
  '......kUUUk.....',
  '......kUUUk.....',
  '......kUUk......',
  '.....kUUk.......',
  '....kbbbbk......',
  '....kkkkkk......',
  '................',
];

const far = (leg: Grid): Grid => leg.map(row => row.replaceAll('U', '2'));

const shift = (part: Grid, dx: number): Grid =>
  part.map(row =>
    dx >= 0 ? '.'.repeat(dx) + row.slice(0, row.length - dx) : row.slice(-dx) + '.'.repeat(-dx),
  );

function frame(...parts: [Grid, number, number][]): string[] {
  return parts.reduce<string[]>(
    (grid, [part, x, y]) => stamp(grid, part, x, y),
    blankGrid(HIKER_WIDTH, HIKER_HEIGHT),
  );
}

interface Pose {
  near: Grid;
  far: Grid;
  arm: Grid;
  /** How far the upper body sinks, in pixels. */
  bob: number;
}

const LEGS_Y = 12;

function walker({ near, far: back, arm, bob }: Pose, head = HEAD): string[] {
  return frame([far(back), 0, LEGS_Y], [near, 0, LEGS_Y], [arm, 0, 6 + bob], [head, 0, bob]);
}

// A step and its mirror. Contact, the sink as weight lands, then the leg passing under.
const WALK: readonly Pose[] = [
  { near: LEG_FORWARD, far: LEG_BACK, arm: ARM_BACK, bob: 1 },
  { near: LEG_PLANTED, far: LEG_LIFT, arm: ARM_BACK, bob: 1 },
  { near: LEG_UNDER, far: LEG_SWING, arm: ARM_DOWN, bob: 0 },
  { near: LEG_BACK, far: LEG_FORWARD, arm: ARM_FORWARD, bob: 1 },
  { near: LEG_LIFT, far: LEG_PLANTED, arm: ARM_FORWARD, bob: 1 },
  { near: LEG_SWING, far: LEG_UNDER, arm: ARM_DOWN, bob: 0 },
];

// Tired: shorter, heavier steps that sink further, the back straight and leaning from the hips.
const TIRED: readonly Pose[] = [
  { near: LEG_PLANTED, far: LEG_BACK, arm: ARM_DOWN, bob: 1 },
  { near: LEG_UNDER, far: LEG_SWING, arm: ARM_DOWN, bob: 2 },
  { near: LEG_BACK, far: LEG_PLANTED, arm: ARM_DOWN, bob: 1 },
  { near: LEG_SWING, far: LEG_UNDER, arm: ARM_DOWN, bob: 2 },
];

const TIRED_LEAN = 2;

// The torso leaned two pixels from the hips, the arm hanging straight down from the shoulder.
// prettier-ignore
const TIRED_TORSO: Grid = [
  '.......kbGGGk...',
  '.......kbGDGk...',
  '......kGGGDk....',
  '......kGGGDk....',
  '.....kGGGGsk....',
  '.....kbbbbk.....',
];

function trudger(pose: Pose): string[] {
  return frame(
    [far(pose.far), 0, LEGS_Y],
    [pose.near, 0, LEGS_Y],
    [TIRED_TORSO, 0, 6 + pose.bob],
    [HEAD_TIRED, TIRED_LEAN, pose.bob],
  );
}

// Hands on knees, catching breath. The back is straight and angled, the head up. The upper
// body rises and sinks over the legs as the hiker pants.
// prettier-ignore
const EXHAUSTED_UPPER: Grid = [
  '.......kkkk.....',
  '......kbGGGk....',
  '.....kbGGkDk....',
  '....kGGGGkDk....',
  '....kGGGGkDk....',
  '....kbbbbkDk....',
  '.........ksk....',
];

// prettier-ignore
const EXHAUSTED_LEGS: Grid = [
  '...kUUUUUk......',
  '...kUUUUUUUUk...',
  '....k22kkkUUk...',
  '....k22k.kUUk...',
  '....k22k.kUUk...',
  '...kbbbbkbbbbk..',
  '...kkkkkkkkkkk..',
];

// prettier-ignore
const SIT_LOWER: Grid = [
  '.....kbbbbkkk...',
  '.....kUUUUUUUk..',
  '..kkkkkkkkkUUk..',
  '.kgwwgggkkkUUkk.',
  '.kgggdddgkkbbbbk',
  '.kkkkkkkkkkkkkkk',
];

// prettier-ignore
const CAMP_LOWER: Grid = [
  '.....kbbbbkkk...',
  '.....kUUUUUUUk..',
  '..kkkkkkkkkUUk..',
  '.kyBBBBBbkkUUkk.',
  '.kBbbbbbbkkbbbbk',
  '..kkkkkkkkkkkkkk',
];

// prettier-ignore
const ARM_WARMING: Grid = [
  '.....kGGGGk.....',
  '.....kGGGGGkkk..',
  '.....kGGDDDDssk.',
  '.....kGGGGkkkk..',
  '.....kGGGGk.....',
];

// prettier-ignore
const ARM_RUBBING: Grid = [
  '.....kGGGGk.....',
  '.....kGGGGGk.kk.',
  '.....kGGDDDDkssk',
  '.....kGGGGkkkkk.',
  '.....kGGGGk.....',
];

// prettier-ignore
const CHEER_UP: Grid = [
  '................',
  '..kk.......kk...',
  '.kssk.....kssk..',
  '.kDDk.kkkkkDDk..',
  '..kDkkhhhhkDk...',
  '..kDkkhhssDkk...',
  '...kDkhskssk....',
  '...kDk1sssDk....',
  '....kDkkkkDk....',
  '....kGDGGDGk....',
  '.....kGGGGk.....',
  '.....kGGGGk.....',
  '.....kGGGGk.....',
  '.....kbbbbk.....',
  '.....kUUUUk.....',
  '.....kUUk2k.....',
  '.....kUUk2k.....',
  '.....kUUk2k.....',
  '.....kbbkbbk....',
  '.....kkkkkkk....',
];

// prettier-ignore
const CHEER_CROUCH: Grid = [
  '................',
  '................',
  '................',
  '...kk......kk...',
  '..kssk....kssk..',
  '..kDDk....kDDk..',
  '...kDkkkkkkDk...',
  '...kDkhhhhDk....',
  '....kkhhssk.....',
  '.....khskssk....',
  '.....k1sssk.....',
  '....kGkkkkGk....',
  '....kGGGGGGk....',
  '.....kGGGGk.....',
  '.....kbbbbk.....',
  '....kUUUUUUk....',
  '...kUUkkkkUUk...',
  '...k2Uk..kU2k...',
  '..kbbbk..kbbbk..',
  '..kkkkk..kkkkk..',
];

// prettier-ignore
export const HIKER_SPRITES: Record<string, Grid> = {
  ...Object.fromEntries(WALK.map((pose, i) => [`hiker_walk_${i + 1}`, walker(pose)])),
  ...Object.fromEntries(TIRED.map((pose, i) => [`hiker_tired_${i + 1}`, trudger(pose)])),
  hiker_stand: walker({ near: LEG_UNDER, far: shift(LEG_UNDER, 1), arm: ARM_DOWN, bob: 1 }),
  hiker_stand_breath: walker({ near: LEG_UNDER, far: shift(LEG_UNDER, 1), arm: ARM_DOWN, bob: 0 }),
  hiker_stand_blink: walker({ near: LEG_UNDER, far: shift(LEG_UNDER, 1), arm: ARM_DOWN, bob: 1 }, HEAD_BLINK),
  hiker_exhausted_1: frame([EXHAUSTED_LEGS, 0, 13], [EXHAUSTED_UPPER, 0, 7], [HEAD_PANT, 4, 2]),
  hiker_exhausted_2: frame([EXHAUSTED_LEGS, 0, 13], [EXHAUSTED_UPPER, 0, 8], [HEAD_TIRED, 4, 3]),
  hiker_sit: frame([HEAD, 0, 3], [ARM_DOWN, 0, 9], [SIT_LOWER, 0, 14]),
  hiker_sit_breath: frame([HEAD, 0, 2], [ARM_DOWN, 0, 8], [SIT_LOWER, 0, 14]),
  hiker_sit_blink: frame([HEAD_BLINK, 0, 3], [ARM_DOWN, 0, 9], [SIT_LOWER, 0, 14]),
  hiker_camp_1: frame([HEAD, 0, 3], [ARM_WARMING, 0, 9], [CAMP_LOWER, 0, 14]),
  hiker_camp_2: frame([HEAD, 0, 3], [ARM_RUBBING, 0, 9], [CAMP_LOWER, 0, 14]),
  hiker_cheer_up: CHEER_UP,
  hiker_cheer_crouch: CHEER_CROUCH,
};

/**
 * Where the pack layer's bottom-right pixel sits on each hiker frame, in frame pixels. The pack
 * hugs the back and follows the body a beat late, so it bounces as the hiker walks.
 */
export const PACK_MOUNT: Record<string, readonly [number, number]> = {
  ...Object.fromEntries(
    WALK.map((_, i) => [`hiker_walk_${i + 1}`, [5, 11 + (WALK.at(i - 1)?.bob ?? 0)] as const]),
  ),
  ...Object.fromEntries(
    TIRED.map((_, i) => [`hiker_tired_${i + 1}`, [7, 12 + (TIRED.at(i - 1)?.bob ?? 0)] as const]),
  ),
  hiker_stand: [5, 12],
  hiker_stand_breath: [5, 11],
  hiker_stand_blink: [5, 12],
  hiker_exhausted_1: [6, 12],
  hiker_exhausted_2: [6, 13],
  hiker_sit: [5, 14],
  hiker_sit_breath: [5, 13],
  hiker_sit_blink: [5, 14],
  hiker_camp_1: [5, 14],
  hiker_camp_2: [5, 14],
  hiker_cheer_up: [5, 13],
  hiker_cheer_crouch: [5, 14],
};

// prettier-ignore
export const HIKER_EXTRAS = {
  sweat_drop: [
    '.k.',
    'kuk',
    'kwk',
    '.k.',
  ],
  bubble_alert: [
    '.kkkkkkk.',
    'kwwwwwwwk',
    'kwwwrwwwk',
    'kwwwrwwwk',
    'kwwwrwwwk',
    'kwwwwwwwk',
    'kwwwrwwwk',
    'kwwwwwwwk',
    '.kkwwkkk.',
    '..kwk....',
    '..kk.....',
  ],
  bubble_zzz: [
    '.kkkkkkkkkk.',
    'kwwwwwwwwwwk',
    'kwUUUUwwwwwk',
    'kwwwwUwwwwwk',
    'kwwwUwwwwwwk',
    'kwwUwwwUUUwk',
    'kwUUUUwwwUwk',
    'kwwwwwwwUwwk',
    'kwwwwwwUUUwk',
    'kwwwwwwwwwwk',
    '.kkwwkkkkkk.',
    '..kwk.......',
    '..kk........',
  ],
} satisfies Record<string, Grid>;

/** A puff of trail dust where a boot lands, rising and spreading as it fades. */
// prettier-ignore
export const DUST_SPRITES: Record<string, Grid> = {
  dust_1: [
    '......',
    '..44..',
    '.4444.',
  ],
  dust_2: [
    '.4..4.',
    '44..44',
    '......',
  ],
  dust_3: [
    '4....4',
    '......',
    '......',
  ],
};
