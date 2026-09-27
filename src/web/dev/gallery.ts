// Dev gallery. Every sprite at 6x with its name, animations playing, pack layers and hat swaps.
import { ANIMATIONS, animationFrame } from '../sprites/animations';
import { HAT_COLORS, hatPalette } from '../sprites/palette';
import type { PaletteOverride } from '../sprites/palette';
import { packOffset } from '../sprites/art/pack';
import type { PackSize } from '../sprites/art/pack';
import {
  SPRITE_GROUPS,
  context2d,
  drawSprite,
  spriteRows,
  stackBadgeName,
} from '../sprites/sprites';

const SCALE = 6;

interface Layer {
  name: string;
  x?: number;
  y?: number;
  override?: PaletteOverride;
}

function size(name: string): { width: number; height: number } {
  const rows = spriteRows(name);
  return { width: rows?.[0]?.length ?? 0, height: rows?.length ?? 0 };
}

function section(title: string): HTMLElement {
  const block = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'grid';
  block.append(heading, grid);
  document.getElementById('gallery')?.append(block);
  return grid;
}

/** A labeled canvas big enough for its layers. `paint` redraws it, for animations. */
function tile(
  grid: HTMLElement,
  label: string,
  width: number,
  height: number,
): (layers: Layer[]) => void {
  const figure = document.createElement('figure');
  const canvas = document.createElement('canvas');
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const caption = document.createElement('figcaption');
  caption.textContent = label;
  figure.append(canvas, caption);
  grid.append(figure);
  const ctx = context2d(canvas);
  return layers => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const layer of layers) {
      drawSprite(
        ctx,
        layer.name,
        (layer.x ?? 0) * SCALE,
        (layer.y ?? 0) * SCALE,
        SCALE,
        layer.override,
      );
    }
  };
}

function still(grid: HTMLElement, name: string, label = name, override?: PaletteOverride): void {
  const { width, height } = size(name);
  tile(grid, label, width, height)([{ name, override }]);
}

const animated: ((seconds: number) => void)[] = [];

function allSprites(): void {
  const grids = new Map<string, HTMLElement>();
  for (const group of SPRITE_GROUPS) {
    const grid = grids.get(group.category) ?? section(group.category);
    grids.set(group.category, grid);
    for (const name of Object.keys(group.sprites)) {
      const { width, height } = size(name);
      still(grid, name, `${name} ${width}x${height}`);
    }
  }
}

function overlays(): void {
  const grid = section('Overlays on an icon');
  still(grid, stackBadgeName(3), 'stack_badge x3');
  still(grid, stackBadgeName(12), 'stack_badge x12');
  tile(grid, 'pinned scroll', 16, 16)([{ name: 'scroll_file' }, { name: 'pin_glow' }]);
  tile(grid, 'stale globe', 16, 16)([{ name: 'globe_web' }, { name: 'stale_overlay' }]);
}

function animations(): void {
  const grid = section('Animations');
  for (const [name, animation] of Object.entries(ANIMATIONS)) {
    const { width, height } = size(animation.frames[0] ?? '');
    const paint = tile(grid, `${name} (${animation.fps} fps)`, width, height);
    animated.push(seconds => {
      paint([{ name: animationFrame(animation, seconds) }]);
    });
  }
}

/** The hiker with each pack size, animated, laid out the way the scene draws them. */
function packs(): void {
  const grid = section('Hiker with pack layers');
  const sizes: [PackSize, 'walk' | 'tired' | 'exhausted'][] = [
    ['pack_s', 'walk'],
    ['pack_m', 'walk'],
    ['pack_l', 'walk'],
    ['pack_xl', 'tired'],
    ['pack_xl', 'exhausted'],
  ];
  for (const [pack, pose] of sizes) {
    const animation = ANIMATIONS[pose];
    const paint = tile(grid, `${pose} ${pack}`, 22, 24);
    animated.push(seconds => {
      const frame = animationFrame(animation, seconds);
      const offset = packOffset(frame) ?? { x: 0, y: 0 };
      paint([
        { name: pack, x: 6 + offset.x, y: 4 + offset.y },
        { name: frame, x: 6, y: 4 },
        ...(pose === 'exhausted' ? [{ name: 'sweat_drop', x: 21, y: 10 }] : []),
      ]);
    });
  }
  for (const frame of ['hiker_sit', 'hiker_camp_1', 'hiker_cheer_up', 'hiker_exhausted_1']) {
    const offset = packOffset(frame) ?? { x: 0, y: 0 };
    tile(
      grid,
      `${frame} pack_m`,
      22,
      24,
    )([
      { name: 'pack_m', x: 6 + offset.x, y: 4 + offset.y },
      { name: frame, x: 6, y: 4 },
    ]);
  }
}

function hats(): void {
  const grid = section('Companion hats');
  HAT_COLORS.forEach((_, hat) => {
    const paint = tile(grid, `hat ${hat}`, 12, 16);
    animated.push(seconds => {
      paint([
        { name: animationFrame(ANIMATIONS.buddy, seconds + hat * 0.06), override: hatPalette(hat) },
      ]);
    });
  });
}

allSprites();
overlays();
animations();
packs();
hats();

const start = performance.now();
function play(time: number): void {
  const seconds = (time - start) / 1000;
  for (const paint of animated) paint(seconds);
  requestAnimationFrame(play);
}
requestAnimationFrame(play);
