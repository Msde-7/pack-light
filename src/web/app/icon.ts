import type { ItemKind } from '../../core/types';
import { ITEM_ICON } from '../sprites/icons';
import { drawSprite } from '../sprites/sprites';
import { h } from './dom';

/** A 16x16 sprite drawn at an integer scale. */
export function spriteCanvas(name: string, scale: number, className?: string): HTMLCanvasElement {
  const size = 16 * scale;
  const canvas = h('canvas', {
    class: className,
    width: size,
    height: size,
    'aria-hidden': 'true',
  });
  const ctx = canvas.getContext('2d');
  if (ctx) drawSprite(ctx, name, 0, 0, scale);
  return canvas;
}

export function kindIcon(kind: ItemKind, scale: number, className: string): HTMLCanvasElement {
  return spriteCanvas(ITEM_ICON[kind], scale, className);
}
