import type { Item } from '../../core/types';

export interface Point {
  x: number;
  y: number;
}

/** A point on a throw from `from` to `to` that rises `lift` pixels above the straight line. */
export function arcPoint(from: Point, to: Point, t: number, lift: number): Point {
  const p = Math.min(1, Math.max(0, t));
  return {
    x: Math.round(from.x + (to.x - from.x) * p),
    y: Math.round(from.y + (to.y - from.y) * p - lift * 4 * p * (1 - p)),
  };
}

/**
 * Snaps smooth progress to `steps` discrete poses, the first a step along and the last exactly
 * at the end, so a flight reads as a few chunky frames like the walk cycle.
 */
export function steppedProgress(progress: number, steps: number): number {
  if (progress < 0) return 0;
  return Math.min(steps, Math.floor(progress * steps) + 1) / steps;
}

/** Discrete poses along a flight's arc. Items land in 6. */
const FLIGHT_POSES = 6;

export interface Flight {
  sprite: string;
  from: Point;
  start: number;
  duration: number;
  lift: number;
  /** Set for a duplicate read, the stack count to show once it lands. */
  stack?: number;
}

/**
 * Where a flight's sprite centre is at `now` on its way into the pack, or undefined before it
 * starts or after it lands.
 */
export function flightAt(flight: Flight, now: number, pack: Point): Point | undefined {
  const elapsed = now - flight.start;
  if (elapsed < 0 || elapsed >= flight.duration) return undefined;
  const t = steppedProgress(elapsed / flight.duration, FLIGHT_POSES);
  return arcPoint(flight.from, pack, t, flight.lift);
}

/** Copies of one file read in this epoch, the original included, for the "x3" badge. */
export function stackCount(items: readonly Item[], item: Item): number {
  const root = item.duplicateOf ?? item.id;
  return items.filter(other => other.id === root || other.duplicateOf === root).length;
}

export interface CompanionActor {
  agentId: string;
  hat: number;
  x: number;
  /** Ground covered in scene pixels, which drives the walk cycle. */
  walked: number;
  /** Set once the companion has been dismissed, the time its fade began. */
  leftAt?: number;
}

export interface RosterEntry {
  agentId: string;
  hat: number;
}

const MAX_COMPANIONS = 4;

/**
 * Brings the walking party in line with the active companions. New ones appear at their slot,
 * or at `enterX` when they have just joined, and ones no longer active start fading out.
 */
export function syncRoster(
  actors: readonly CompanionActor[],
  active: readonly RosterEntry[],
  now: number,
  slotX: (index: number) => number,
  joining: ReadonlySet<string>,
  enterX: number,
): CompanionActor[] {
  const wanted = active.slice(0, MAX_COMPANIONS);
  const wantedIds = new Set(wanted.map(entry => entry.agentId));
  const kept = actors.map(actor =>
    wantedIds.has(actor.agentId) || actor.leftAt !== undefined ? actor : { ...actor, leftAt: now },
  );
  const known = new Set(
    kept.filter(actor => actor.leftAt === undefined).map(actor => actor.agentId),
  );
  const added = wanted
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !known.has(entry.agentId))
    .map(({ entry, index }) => ({
      agentId: entry.agentId,
      hat: entry.hat,
      x: joining.has(entry.agentId) ? enterX : slotX(index),
      walked: 0,
    }));
  return [...kept, ...added];
}

/** Slot of each companion still walking, in roster order. */
export function walkingOrder(actors: readonly CompanionActor[]): Map<string, number> {
  return new Map(
    actors
      .filter(actor => actor.leftAt === undefined)
      .map((actor, index) => [actor.agentId, index]),
  );
}

/** Moves toward a target at a fixed speed without overshooting. */
export function approach(current: number, target: number, maxStep: number): number {
  if (Math.abs(target - current) <= maxStep) return target;
  return current + Math.sign(target - current) * maxStep;
}

/**
 * Moves a companion toward its slot. Its feet cover the trail scrolling by, `groundMoved`,
 * plus its own movement on screen, so the walk cycle keeps pace with the ground.
 */
export function walkCompanion(
  actor: CompanionActor,
  target: number,
  maxStep: number,
  groundMoved: number,
): CompanionActor {
  const x = approach(actor.x, target, maxStep);
  return { ...actor, x, walked: actor.walked + Math.abs(groundMoved + x - actor.x) };
}
