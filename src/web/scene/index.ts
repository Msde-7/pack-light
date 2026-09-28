import type { SceneCue } from '../../core/protocol';
import type { Item, ItemKind, SessionState } from '../../core/types';
import { ANIMATIONS, animationFrame, gaitFrame, gaitIndex } from '../sprites/animations';
import { packOffset } from '../sprites/art/pack';
import { opaqueBounds } from '../sprites/grid';
import { miniIcon } from '../sprites/icons';
import { hatPalette } from '../sprites/palette';
import {
  context2d,
  makeCanvas,
  spriteCanvas,
  spriteRows,
  stackBadgeName,
} from '../sprites/sprites';
import { arcPoint, flightAt, stackCount, syncRoster, walkCompanion, walkingOrder } from './actors';
import type { CompanionActor, Flight, Point } from './actors';
import { createBackdrop } from './backdrop';
import { campStateAt } from './camp-timeline';
import type { CampState } from './camp-timeline';
import { draw } from './draw';
import { CHEER_SECONDS, hikerView } from './hiker-view';
import type { HikerView } from './hiker-view';
import {
  packForFill,
  poseForFill,
  signCrossed,
  signForFill,
  signStillDue,
  walkSpeed,
} from './motion';
import type { TrailSign } from './motion';
import { groundView, stripShift } from './camera';
import { STEP_SECONDS, advanceClock, blendFactor, lerp } from './timestep';
import {
  FEET_Y,
  FRONT_GRASS_Y,
  GRASS_Y,
  HILL_PERIOD,
  MEADOW_Y,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  VERGE_BASE,
  hashSlot,
  propsInView,
  screenX,
} from './trail';

export interface SceneOptions {
  reducedMotion: boolean;
}

export interface Scene {
  /** Shows a session, or an empty trail when undefined. Safe to call on every state update. */
  setSession(state: SessionState | undefined): void;
  /** Plays a one-shot animation. Unknown or stale cues are ignored. */
  cue(cue: SceneCue): void;
  /** Ends a running camp animation immediately. */
  skipCamp(): void;
  setReducedMotion(reduced: boolean): void;
  destroy(): void;
}

const HIKER_X = 124;
const HIKER_Y = FEET_Y - 20;
const COMPANION_Y = FEET_Y - 16;
const COMPANION_GAP = 22;
const MINI_HALF = 4;
const MAX_DROPS = 8;
const MAX_KEEPS = 4;
const BADGE_SECONDS = 1.3;
const LEAVE_SECONDS = 0.6;
const CHEST_X = HIKER_X + 112;
const DUST_SECONDS = 0.36;
const DUST_FRAMES = ['dust_1', 'dust_2', 'dust_3'];
/** Where a landing heel kicks up dust, from the hiker's left edge, for each gait. */
const HEEL_X = { walk: 6, tired: 4 } as const;
/** The pack squashes a pixel as an item lands in it, then springs back up. */
const SQUASH_SECONDS = 0.16;
const SIGN_AHEAD = 196;
/** The ground canvas runs one tile past the right edge, so a sub-pixel slide never shows a gap. */
const GROUND_WIDTH = SCENE_WIDTH + 16;
const PARALLAX = [
  ['mountains', 0.12],
  ['far', 0.3],
  ['near', 0.6],
] as const;

interface Camp {
  start: number;
  drops: ItemKind[];
  keeps: ItemKind[];
}

interface Timed {
  start: number;
}

interface Badge extends Timed {
  count: number;
}

interface Chest extends Timed {
  until: number;
}

interface Dust {
  /** Trail position of the puff's left edge. */
  x: number;
  start: number;
}

interface PlacedSign {
  sprite: TrailSign;
  x: number;
}

function itemsById(state: SessionState | undefined, ids: readonly string[]): Item[] {
  if (!state) return [];
  const byId = new Map(state.items.map(item => [item.id, item]));
  return ids.flatMap(id => byId.get(id) ?? []);
}

export function createScene(canvas: HTMLCanvasElement, options: SceneOptions): Scene {
  const screen = context2d(canvas);
  // Layers at scene resolution, composited at the integer scale with device pixel offsets.
  const [actorLayer, ctx] = makeCanvas(SCENE_WIDTH, SCENE_HEIGHT);
  const [groundLayer, ground] = makeCanvas(GROUND_WIDTH, SCENE_HEIGHT);
  const [frontLayer, front] = makeCanvas(GROUND_WIDTH, SCENE_HEIGHT);
  const backdrop = createBackdrop();
  let reduced = options.reducedMotion;
  let session: SessionState | undefined;
  let now = 0;
  let distance = 0;
  /** Where the last update started, so a frame can be drawn between two updates. */
  let previous = { now: 0, distance: 0, companions: new Map<string, number>() };
  /** Distance walked as drawn this frame, between the last two updates. */
  let camera = 0;
  /** Scene time as drawn this frame. */
  let drawnNow = 0;
  let lastFill = 0;
  let camp: Camp | undefined;
  let fireX: number | undefined;
  let cheerStart: number | undefined;
  let squashStart = -1;
  let dust: Dust[] = [];
  let lastStep = -1;
  let flights: Flight[] = [];
  let badges: Badge[] = [];
  let sparkles: Timed[] = [];
  let chest: Chest | undefined;
  let signs: PlacedSign[] = [];
  let companions: CompanionActor[] = [];
  const joining = new Set<string>();
  let destroyed = false;

  const fill = (): number => session?.fill ?? 0;
  const campState = (): CampState | undefined =>
    camp ? campStateAt(now - camp.start, camp.drops.length, camp.keeps.length) : undefined;
  const camping = (): boolean => camp !== undefined || session?.phase === 'camping';

  function view(walked = distance): HikerView {
    return hikerView({
      phase: session?.phase ?? 'done',
      fill: fill(),
      seconds: now,
      walked,
      cheerAge: cheerStart === undefined ? undefined : now - cheerStart,
      camping: camping(),
      reducedMotion: reduced,
    });
  }

  function packOnBack(current: HikerView): { sprite: string; x: number; y: number } | undefined {
    if (campState()?.packOpen) return undefined;
    const offset = packOffset(current.frame);
    if (!offset) return undefined;
    const y = HIKER_Y + offset.y - current.lift;
    return { sprite: packForFill(fill()), x: HIKER_X + offset.x, y };
  }

  /** Top centre of the pack, where flying items drop in. */
  function packMouth(): Point {
    if (campState()?.packOpen) return { x: HIKER_X - 10, y: FEET_Y - 11 };
    const pack = packOnBack(view(camera));
    const rows = pack ? spriteRows(pack.sprite) : undefined;
    const bounds = rows ? opaqueBounds(rows) : undefined;
    if (!pack || !bounds) return { x: HIKER_X + 2, y: HIKER_Y + 6 };
    return { x: pack.x + bounds.x + Math.floor(bounds.width / 2), y: pack.y + bounds.y + 2 };
  }

  function slotX(index: number): number {
    if (camping() && fireX !== undefined) return screenX(fireX, distance) + 20 + index * 14;
    return HIKER_X - COMPANION_GAP * (index + 1);
  }

  function syncCompanions(): void {
    const active = Object.values(session?.subagents ?? {})
      .filter(companion => companion.status === 'active')
      .map(companion => ({ agentId: companion.agentId, hat: companion.hat }));
    companions = syncRoster(companions, active, now, slotX, joining, -14);
    for (const actor of companions) joining.delete(actor.agentId);
    if (reduced) companions = companions.filter(actor => actor.leftAt === undefined);
  }

  function plantSign(sprite: TrailSign | undefined, ahead: number): void {
    if (!sprite) return;
    signs = [...signs.filter(sign => sign.sprite !== sprite), { sprite, x: distance + ahead }];
  }

  function clearActors(): void {
    camp = undefined;
    fireX = undefined;
    cheerStart = undefined;
    dust = [];
    flights = [];
    badges = [];
    sparkles = [];
    chest = undefined;
    signs = [];
    companions = [];
    joining.clear();
  }

  function setSession(state: SessionState | undefined): void {
    const switched = state?.sessionId !== session?.sessionId;
    session = state;
    if (switched) {
      clearActors();
      lastFill = state?.fill ?? 0;
      if (state) plantSign(signForFill(state.fill), SIGN_AHEAD);
    } else if (state) {
      plantSign(signCrossed(lastFill, state.fill), reduced ? SIGN_AHEAD : SCENE_WIDTH + 12);
      signs = signs.filter(sign => signStillDue(sign.sprite, state.fill));
      lastFill = state.fill;
    }
    if (state?.phase === 'camping') fireX ??= Math.round(distance) + HIKER_X + 24;
    syncCompanions();
  }

  function throwItem(item: Item, duplicate: boolean): void {
    const count = duplicate ? stackCount(session?.items ?? [], item) : 1;
    const stack = count > 1 ? count : undefined;
    if (reduced) {
      if (stack) badges.push({ count: stack, start: now });
      return;
    }
    flights.push({
      sprite: miniIcon(item.kind),
      from: { x: SCENE_WIDTH + MINI_HALF, y: HIKER_Y - 14 },
      start: now,
      duration: 0.4,
      lift: 18,
      stack,
    });
  }

  function startCamp(compactionIndex: number): void {
    if (!session) return;
    const dropped = itemsById(session, session.compactions[compactionIndex]?.droppedIds ?? []);
    const pinned = session.items.filter(item => item.status === 'pinned');
    fireX = Math.round(distance) + HIKER_X + 24;
    flights = [];
    if (reduced) return;
    camp = {
      start: now,
      drops: dropped.slice(0, MAX_DROPS).map(item => item.kind),
      keeps: pinned.slice(0, MAX_KEEPS).map(item => item.kind),
    };
  }

  function repack(itemIds: readonly string[]): void {
    const items = itemsById(session, itemIds).slice(0, MAX_DROPS);
    if (reduced || items.length === 0) return;
    const from = { x: CHEST_X + 8, y: FEET_Y - 14 };
    items.forEach((item, i) => {
      flights.push({
        sprite: miniIcon(item.kind),
        from,
        start: now + 0.3 + i * 0.2,
        duration: 0.5,
        lift: 26,
      });
    });
    chest = { start: now, until: now + 0.3 + items.length * 0.2 + 0.8 };
  }

  function returnCompanion(agentId: string): void {
    const actor = companions.find(
      companion => companion.agentId === agentId && companion.leftAt === undefined,
    );
    if (!actor || reduced) return;
    flights.push({
      sprite: 'letter_mini',
      from: { x: Math.round(actor.x) + 6, y: COMPANION_Y + 4 },
      start: now,
      duration: 0.6,
      lift: 18,
    });
  }

  function cue(next: SceneCue): void {
    if (!session) return;
    switch (next.cue) {
      case 'item_added': {
        const item = session.items.find(candidate => candidate.id === next.itemId);
        if (item) throwItem(item, next.duplicate);
        return;
      }
      case 'camp':
        startCamp(next.compactionIndex);
        return;
      case 'repacked':
        repack(next.itemIds);
        return;
      case 'pinned':
        if (!reduced) sparkles.push({ start: now });
        return;
      case 'cheer':
        if (!reduced) cheerStart = now;
        return;
      case 'companion_joined':
        joining.add(next.agentId);
        if (!reduced) {
          companions = companions.map(actor =>
            actor.agentId === next.agentId ? { ...actor, x: -14 } : actor,
          );
        }
        syncCompanions();
        return;
      case 'companion_returned':
        returnCompanion(next.agentId);
        return;
    }
  }

  function update(dt: number): void {
    now += dt;
    if (campState()?.done) camp = undefined;
    if (cheerStart !== undefined && now - cheerStart >= CHEER_SECONDS) cheerStart = undefined;
    const walking = view().walking && !reduced;
    const stride = walking ? walkSpeed(fill()) * dt : 0;
    distance += stride;
    kickDust(walking);
    const landed = flights.filter(flight => now >= flight.start + flight.duration);
    flights = flights.filter(flight => now < flight.start + flight.duration);
    for (const flight of landed) {
      squashStart = now;
      if (flight.stack) badges.push({ count: flight.stack, start: now });
    }
    dust = dust.filter(puff => now - puff.start < DUST_SECONDS);
    badges = badges.filter(badge => now - badge.start < BADGE_SECONDS);
    sparkles = sparkles.filter(sparkle => now - sparkle.start < 0.9);
    if (chest && now > chest.until) chest = undefined;
    signs = signs.filter(sign => screenX(sign.x, distance) > -32);
    if (fireX !== undefined && !camping() && screenX(fireX, distance) < -20) fireX = undefined;
    moveCompanions(dt, stride);
  }

  /** A puff of dust each time a heel lands. */
  function kickDust(walking: boolean): void {
    const gait = poseForFill(fill()) === 'walk' ? 'walk' : 'tired';
    const step = walking ? gaitIndex(ANIMATIONS[gait], distance) : -1;
    if (step !== lastStep && ANIMATIONS[gait].footfalls.includes(step)) {
      dust.push({ x: Math.round(distance) + HIKER_X + HEEL_X[gait], start: now });
    }
    lastStep = step;
  }

  function moveCompanions(dt: number, stride: number): void {
    const order = walkingOrder(companions);
    companions = companions
      .filter(actor => actor.leftAt === undefined || now - actor.leftAt < LEAVE_SECONDS)
      .map(actor => {
        const index = order.get(actor.agentId);
        if (index === undefined) return actor;
        const target = slotX(index);
        if (reduced) return { ...actor, x: target };
        return walkCompanion(actor, target, 70 * dt, stride);
      });
  }

  // Rendering, back to front. Sprites and tiles are drawn at scene resolution into layers, and
  // the layers are scaled onto the screen with offsets in device pixels.

  function drawBackdrop(scale: number): void {
    const { width, height } = canvas;
    screen.drawImage(backdrop.sky, 0, 0, width, height);
    const span = SCENE_WIDTH + 60;
    const drift = camera * 0.08 + (reduced ? 0 : drawnNow * 1.5);
    backdrop.clouds.forEach((cloud, i) => {
      const x = ((((i * 173 + 40 - drift) % span) + span) % span) - 30;
      screen.drawImage(
        cloud,
        Math.round(x * scale),
        (10 + i * 20) * scale,
        cloud.width * scale,
        cloud.height * scale,
      );
    });
    for (const [layer, factor] of PARALLAX) {
      const strip = backdrop[layer];
      const shift = stripShift(camera, factor, scale, HILL_PERIOD);
      const stripWidth = HILL_PERIOD * scale;
      screen.drawImage(strip, -shift, 0, stripWidth, height);
      screen.drawImage(strip, stripWidth - shift, 0, stripWidth, height);
    }
  }

  function drawTiles(
    layer: CanvasRenderingContext2D,
    origin: number,
    y: number,
    tile: string | ((column: number) => string),
  ): void {
    const first = Math.floor(origin / 16);
    for (let column = first; column * 16 - origin < GROUND_WIDTH; column++) {
      draw(layer, typeof tile === 'string' ? tile : tile(column), column * 16 - origin, y);
    }
  }

  /** The trail and everything standing on it, drawn in trail pixels less `origin`. */
  function drawGround(origin: number): void {
    ground.clearRect(0, 0, GROUND_WIDTH, SCENE_HEIGHT);
    drawTiles(ground, origin, GRASS_Y, 'ground_grass_edge');
    drawTiles(ground, origin, GRASS_Y + 16, column =>
      hashSlot(column) % 3 === 0 ? 'ground_dirt_rut' : 'ground_dirt',
    );
    for (const prop of propsInView(origin, GROUND_WIDTH)) {
      draw(ground, prop.sprite, prop.x - origin, VERGE_BASE - prop.height + 1);
    }
    for (const sign of signs) {
      draw(ground, sign.sprite, Math.round(sign.x) - origin, VERGE_BASE - 23);
    }
    if (!session) return;
    drawFire(origin);
    for (const puff of dust) {
      const t = (now - puff.start) / DUST_SECONDS;
      const frame = DUST_FRAMES[Math.min(DUST_FRAMES.length - 1, Math.floor(t * 3))] ?? '';
      draw(ground, frame, puff.x - origin, FEET_Y - 4, { opacity: 1 - t * 0.6 });
    }
  }

  function drawFront(origin: number): void {
    front.clearRect(0, 0, GROUND_WIDTH, SCENE_HEIGHT);
    drawTiles(front, origin, FRONT_GRASS_Y, 'ground_grass_front');
    for (let y = MEADOW_Y; y < SCENE_HEIGHT; y += 16) drawTiles(front, origin, y, 'ground_grass');
  }

  function drawFire(origin: number): void {
    if (fireX === undefined) return;
    if (camp && !campState()?.fire) return;
    const frame = reduced ? 'campfire_1' : animationFrame(ANIMATIONS.campfire, now);
    draw(ground, frame, fireX - origin, FEET_Y - 16);
  }

  function companionFrame(actor: CompanionActor, index: number, walking: boolean): string {
    const moving = !reduced && (walking || Math.abs(actor.x - slotX(index)) > 0.5);
    // Each companion keeps its own step and blinks on its own beat.
    if (moving) return gaitFrame(ANIMATIONS.buddy, actor.walked + index * 5);
    const blinking = !reduced && (now + index * 1.7) % 4.6 > 4.45;
    return blinking ? 'buddy_blink' : 'buddy_stand';
  }

  function drawCompanions(blend: number): void {
    const walking = view().walking;
    const facingFire = camping() && fireX !== undefined;
    const order = walkingOrder(companions);
    for (const actor of companions) {
      const frame = companionFrame(actor, order.get(actor.agentId) ?? 0, walking);
      const opacity = actor.leftAt === undefined ? 1 : 1 - (now - actor.leftAt) / LEAVE_SECONDS;
      const flip = facingFire && actor.leftAt === undefined;
      const x = Math.round(lerp(previous.companions.get(actor.agentId) ?? actor.x, actor.x, blend));
      draw(ctx, frame, x, COMPANION_Y, { override: hatPalette(actor.hat), opacity, flip });
    }
  }

  function drawMini(name: string, at: Point, opacity = 1): void {
    draw(ctx, name, at.x - MINI_HALF, at.y - MINI_HALF, { opacity });
  }

  function drawCampProps(state: CampState, current: Camp): void {
    if (state.packOpen) draw(ctx, 'pack_open', HIKER_X - 18, FEET_Y - 15);
    const mouth = packMouth();
    current.drops.forEach((kind, i) => {
      const progress = state.drops[i] ?? 0;
      if (progress <= 0) return;
      const rest = {
        x: HIKER_X - 30 - (i % 4) * 7 - Math.floor(i / 4) * 3,
        y: FEET_Y - 4 - Math.floor(i / 4) * 5,
      };
      drawMini(
        miniIcon(kind),
        arcPoint(mouth, rest, progress, 16),
        progress < 1 ? 1 : state.pileOpacity,
      );
    });
    current.keeps.forEach((kind, i) => {
      const progress = state.keeps[i] ?? 0;
      if (progress <= 0 || progress >= 1) return;
      const spread = (i - (current.keeps.length - 1) / 2) * 12;
      const at = arcPoint(mouth, mouth, progress, 26 + i * 3);
      const point = { x: at.x + Math.round(spread * Math.sin(progress * Math.PI)), y: at.y };
      drawMini(miniIcon(kind), point);
      draw(ctx, 'mini_pin_glow', point.x - 5, point.y - 5);
    });
    if (state.notes > 0 && state.notes < 1) {
      drawMini(
        'mini_field_notes',
        arcPoint({ x: mouth.x, y: -8 }, mouth, state.notes * state.notes, 0),
      );
    }
  }

  /**
   * The pack on the back. Just after an item lands, its top half sinks a pixel into the bottom
   * half, then rises a pixel above it, a small squash and stretch.
   */
  function drawPack(pack: { sprite: string; x: number; y: number }): void {
    const age = now - squashStart;
    const image = spriteCanvas(pack.sprite);
    const bounds = opaqueBounds(spriteRows(pack.sprite) ?? []);
    if (reduced || age >= SQUASH_SECONDS || !image || !bounds) {
      draw(ctx, pack.sprite, pack.x, pack.y);
      return;
    }
    const split = bounds.y + Math.floor(bounds.height / 2);
    const give = age < SQUASH_SECONDS / 2 ? 1 : -1;
    const { width, height } = image;
    ctx.drawImage(image, 0, 0, width, split, pack.x, pack.y + give, width, split);
    if (give < 0) {
      ctx.drawImage(image, 0, split - 1, width, 1, pack.x, pack.y + split - 1, width, 1);
    }
    ctx.drawImage(
      image,
      0,
      split,
      width,
      height - split,
      pack.x,
      pack.y + split,
      width,
      height - split,
    );
  }

  function drawHiker(current: HikerView): void {
    const pack = packOnBack(current);
    if (pack) drawPack(pack);
    draw(ctx, current.frame, HIKER_X, HIKER_Y - current.lift);
    if (current.sweat) {
      const fall = reduced ? 0 : Math.floor(((now * 1.4) % 1) * 5);
      if (fall < 4) draw(ctx, 'sweat_drop', HIKER_X + 15, HIKER_Y + 6 + fall);
    }
    if (current.bubble) {
      const bob = reduced ? 0 : Math.floor(now * 2) % 2;
      const height = spriteRows(current.bubble)?.length ?? 0;
      draw(ctx, current.bubble, HIKER_X + 10, HIKER_Y + 4 - height - bob);
    }
  }

  function drawEffects(): void {
    const mouth = packMouth();
    for (const flight of flights) {
      const at = flightAt(flight, now, mouth);
      if (at) {
        drawMini(flight.sprite, flight.sprite === 'letter_mini' ? { x: at.x, y: at.y + 1 } : at);
      }
    }
    for (const sparkle of sparkles) {
      const t = (now - sparkle.start) / 0.9;
      const at = { x: mouth.x, y: mouth.y - 6 - Math.round(t * 12) };
      const opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      drawMini('mini_star_pin', at, opacity);
      draw(ctx, 'mini_pin_glow', at.x - 5, at.y - 5, { opacity });
    }
    for (const badge of badges) {
      const age = now - badge.start;
      const shake = !reduced && age < 0.4 ? (Math.floor(age * 30) % 2 === 0 ? 1 : -1) : 0;
      const opacity = age > BADGE_SECONDS - 0.3 ? (BADGE_SECONDS - age) / 0.3 : 1;
      draw(ctx, stackBadgeName(badge.count), mouth.x - 5 + shake, mouth.y - 14, { opacity });
    }
    if (chest) {
      const opacity = Math.min(1, (now - chest.start) / 0.2, (chest.until - now) / 0.3);
      draw(ctx, 'lost_and_found_chest', CHEST_X, FEET_Y - 15, { opacity });
    }
  }

  function render(blend: number): void {
    camera = lerp(previous.distance, distance, blend);
    drawnNow = lerp(previous.now, now, blend);
    const scale = canvas.width / SCENE_WIDTH;
    const { origin, slide } = groundView(camera, scale);
    screen.imageSmoothingEnabled = false;
    drawBackdrop(scale);
    drawGround(origin);
    screen.drawImage(groundLayer, -slide, 0, GROUND_WIDTH * scale, canvas.height);
    ctx.clearRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
    if (session) {
      drawCompanions(blend);
      const state = campState();
      if (state && camp) drawCampProps(state, camp);
      drawHiker(view(camera));
      drawEffects();
    }
    screen.drawImage(actorLayer, 0, 0, canvas.width, canvas.height);
    drawFront(origin);
    screen.drawImage(frontLayer, -slide, 0, GROUND_WIDTH * scale, canvas.height);
  }

  // The host sizes the canvas with CSS. The backing store follows it in whole multiples of
  // 320x180 device pixels, so every scene pixel covers the same number of screen pixels.
  function fitBacking(devicePixelWidth: number): void {
    if (canvas.style.width === '' || devicePixelWidth <= 0) return;
    const scale = Math.max(1, Math.round(devicePixelWidth / SCENE_WIDTH));
    if (canvas.width === SCENE_WIDTH * scale) return;
    canvas.width = SCENE_WIDTH * scale;
    canvas.height = SCENE_HEIGHT * scale;
    render(blendFactor(clock));
  }

  const clock = { carry: 0 };
  canvas.width = SCENE_WIDTH;
  canvas.height = SCENE_HEIGHT;
  canvas.style.imageRendering = 'pixelated';
  const observer = observeSize(canvas, fitBacking);

  let last = performance.now();
  let frameRequest = requestAnimationFrame(tick);
  function tick(time: number): void {
    if (destroyed) return;
    const steps = advanceClock(clock, (time - last) / 1000);
    last = time;
    for (let i = 0; i < steps; i++) {
      previous = {
        now,
        distance,
        companions: new Map(companions.map(actor => [actor.agentId, actor.x])),
      };
      update(STEP_SECONDS);
    }
    render(blendFactor(clock));
    frameRequest = requestAnimationFrame(tick);
  }
  render(0);

  return {
    setSession,
    cue,
    skipCamp: () => {
      camp = undefined;
    },
    setReducedMotion: (next: boolean) => {
      reduced = next;
      if (!next) return;
      camp = undefined;
      flights = [];
      sparkles = [];
      chest = undefined;
      cheerStart = undefined;
      dust = [];
      syncCompanions();
    },
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(frameRequest);
      observer.disconnect();
    },
  };
}

function observeSize(
  canvas: HTMLCanvasElement,
  onWidth: (devicePixels: number) => void,
): ResizeObserver {
  const observer = new ResizeObserver(entries => {
    const entry = entries[0];
    if (!entry) return;
    const device = entry.devicePixelContentBoxSize[0]?.inlineSize;
    onWidth(device ?? entry.contentRect.width * (window.devicePixelRatio || 1));
  });
  try {
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(canvas);
  }
  return observer;
}
