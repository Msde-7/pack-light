export const SCENE_WIDTH = 320;
export const SCENE_HEIGHT = 180;

/** Frame padding, border and margin plus the canvas border, both sides together. */
export const FRAME_CHROME = 28;
const PAD = 12;
const GAP = 12;
const TOPBAR = 52;
const TOPBAR_NARROW = 92;
const HEAD = 44;
const NARROW_BELOW = 900;
const SCROLLBAR = 16;
const SIDE_MIN = 400;
const SIDE_MAX = 520;
const NOTES_MIN_HEIGHT = 150;
const NOTES_MIN_WIDTH = 240;
const PEEK = 80;

export type LayoutMode = 'wide' | 'stack' | 'narrow';

export interface LayoutPlan {
  mode: LayoutMode;
  scale: number;
  topbar: number;
  head: number;
  frameWidth: number;
  frameHeight: number;
  side: number;
  notesBeside: boolean;
}

/** Largest integer scale that fits, never below 1, so pixels stay square and crisp. */
export function sceneScale(width: number, maxHeight: number): number {
  return Math.max(
    1,
    Math.min(Math.floor(width / SCENE_WIDTH), Math.floor(maxHeight / SCENE_HEIGHT)),
  );
}

/**
 * Sizes every fixed part of the page from the viewport alone, so panel content can never
 * move or resize the scene.
 */
export function planLayout(width: number, height: number): LayoutPlan {
  if (width < NARROW_BELOW) return narrowPlan(width, height);
  const wideWidth = width - 2 * PAD - GAP - SIDE_MIN - FRAME_CHROME;
  if (Math.floor(wideWidth / SCENE_WIDTH) >= 3) return widePlan(width, height, wideWidth);
  return stackPlan(width, height);
}

function widePlan(width: number, height: number, room: number): LayoutPlan {
  const tall = height - TOPBAR - 2 * PAD - HEAD - 2 * GAP - NOTES_MIN_HEIGHT - FRAME_CHROME;
  const scale = sceneScale(room, tall);
  const frameWidth = SCENE_WIDTH * scale + FRAME_CHROME;
  const side = Math.min(SIDE_MAX, width - 2 * PAD - GAP - frameWidth);
  return {
    mode: 'wide',
    scale,
    topbar: TOPBAR,
    head: HEAD,
    frameWidth: width - 2 * PAD - GAP - side,
    frameHeight: SCENE_HEIGHT * scale + FRAME_CHROME,
    side,
    notesBeside: false,
  };
}

function stackPlan(width: number, height: number): LayoutPlan {
  const inner = width - SCROLLBAR - 2 * PAD;
  const tall = height - TOPBAR - PAD - HEAD - GAP - PEEK - FRAME_CHROME;
  const scale = sceneScale(inner - FRAME_CHROME, tall);
  const frameWidth = SCENE_WIDTH * scale + FRAME_CHROME;
  const notesBeside = inner - GAP - frameWidth >= NOTES_MIN_WIDTH;
  return {
    mode: 'stack',
    scale,
    topbar: TOPBAR,
    head: HEAD,
    frameWidth: notesBeside ? frameWidth : inner,
    frameHeight: SCENE_HEIGHT * scale + FRAME_CHROME,
    side: 0,
    notesBeside,
  };
}

function narrowPlan(width: number, height: number): LayoutPlan {
  const inner = width - SCROLLBAR - 16;
  const scale = sceneScale(inner - FRAME_CHROME, height * 0.6 - FRAME_CHROME);
  return {
    mode: 'narrow',
    scale,
    topbar: TOPBAR_NARROW,
    head: 0,
    frameWidth: inner,
    frameHeight: SCENE_HEIGHT * scale + FRAME_CHROME,
    side: 0,
    notesBeside: false,
  };
}

/** Publishes the plan as CSS variables and data attributes that styles.css lays out from. */
export function applyLayout(plan: LayoutPlan, root: HTMLElement, canvas: HTMLElement): void {
  root.dataset.layout = plan.mode;
  root.dataset.notes = plan.notesBeside ? 'beside' : 'below';
  const vars: Record<string, number> = {
    '--topbar-h': plan.topbar,
    '--head-h': plan.head,
    '--frame-w': plan.frameWidth,
    '--frame-h': plan.frameHeight,
    '--side': plan.side,
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, `${value}px`);
  canvas.style.width = `${SCENE_WIDTH * plan.scale}px`;
  canvas.style.height = `${SCENE_HEIGHT * plan.scale}px`;
}
