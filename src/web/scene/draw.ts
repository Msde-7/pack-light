import { bayer } from '../sprites/grid';
import type { PaletteOverride } from '../sprites/palette';
import { makeCanvas, spriteCanvas } from '../sprites/sprites';

export interface DrawOptions {
  override?: PaletteOverride;
  /** Mirror horizontally, for companions facing the fire. */
  flip?: boolean;
  /** 0 to 1, drawn as an ordered dither in quarter steps so pixels stay crisp. */
  opacity?: number;
}

const masks = new Map<number, HTMLCanvasElement>();

/** A 4x4 tile that is opaque where pixels should be erased at this level. */
function eraseMask(level: number): HTMLCanvasElement {
  const hit = masks.get(level);
  if (hit) return hit;
  const [tile, ctx] = makeCanvas(4, 4);
  ctx.fillStyle = '#000';
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) if (bayer(x, y) < level * 4) ctx.fillRect(x, y, 1, 1);
  }
  masks.set(level, tile);
  return tile;
}

let scratch: [HTMLCanvasElement, CanvasRenderingContext2D] | undefined;

/** The image with a quarter-step dither erased from it, on a shared scratch canvas. */
function dithered(
  image: HTMLCanvasElement,
  level: number,
  x: number,
  y: number,
): HTMLCanvasElement {
  scratch ??= makeCanvas(image.width, image.height);
  const [canvas, ctx] = scratch;
  if (canvas.width < image.width) canvas.width = image.width;
  if (canvas.height < image.height) canvas.height = image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const pattern = ctx.createPattern(eraseMask(level), 'repeat');
  if (!pattern) return image;
  // Anchor the dither to the screen grid so a moving sprite does not shimmer.
  pattern.setTransform(new DOMMatrix([1, 0, 0, 1, -(x & 3), -(y & 3)]));
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, image.width, image.height);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/** Draws a named sprite at its top-left pixel. Unknown names draw nothing. */
export function draw(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  options: DrawOptions = {},
): void {
  const image = spriteCanvas(name, options.override);
  const level = 4 - Math.round(Math.min(1, Math.max(0, options.opacity ?? 1)) * 4);
  if (!image || level >= 4) return;
  const px = Math.round(x);
  const py = Math.round(y);
  const source = level === 0 ? image : dithered(image, level, px, py);
  const { width, height } = image;
  ctx.save();
  ctx.translate(options.flip ? px + width : px, py);
  if (options.flip) ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0, width, height, 0, 0, width, height);
  ctx.restore();
}
