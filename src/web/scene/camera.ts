/**
 * Every scrolling layer takes its offset from one camera, the distance walked in scene pixels.
 * Offsets are rounded to device pixels, not scene pixels, so at 4x a layer glides in quarter
 * pixel steps while each scene pixel still covers a whole square block of the screen.
 */

/** How far a layer scrolling at `factor` of the walking speed has moved, in device pixels. */
export function layerShift(camera: number, factor: number, scale: number): number {
  return Math.round(camera * factor * scale);
}

/** The shift of a repeating strip `period` scene pixels wide, wrapped into one period. */
export function stripShift(camera: number, factor: number, scale: number, period: number): number {
  const span = period * scale;
  const shift = layerShift(camera, factor, scale) % span;
  return shift < 0 ? shift + span : shift;
}

export interface GroundView {
  /** Trail position of the ground canvas's left edge, in whole scene pixels. */
  origin: number;
  /** Device pixels to slide the ground canvas left when compositing it. */
  slide: number;
}

/**
 * Splits the ground's shift into whole scene pixels, where tiles and props are drawn on their
 * own canvas, and a device pixel remainder applied when that canvas is composited. Everything
 * on the ground canvas moves as one rigid sheet, so nothing swims against the dirt.
 */
export function groundView(camera: number, scale: number): GroundView {
  const shift = layerShift(camera, 1, scale);
  const origin = Math.floor(shift / scale);
  return { origin, slide: shift - origin * scale };
}
