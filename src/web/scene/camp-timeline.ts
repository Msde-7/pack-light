/** Seconds from the camp cue. The whole stop lasts CAMP_SECONDS, 3 to 4 s. */
export const CAMP = {
  fireLit: 0.1,
  packOff: 0.35,
  dropStart: 0.5,
  dropSpread: 0.7,
  dropFlight: 0.45,
  fadeStart: 1.7,
  fadeEnd: 2.5,
  keepStart: 1.8,
  keepSpread: 0.4,
  keepFlight: 0.5,
  notesStart: 2.7,
  notesFlight: 0.5,
  packOn: 3.25,
} as const;

export const CAMP_SECONDS = 3.5;

export interface CampState {
  fire: boolean;
  packOpen: boolean;
  /** Flight progress of each dropped item from the pack to the pile, 0 before it leaves. */
  drops: number[];
  pileOpacity: number;
  /** Progress of each pinned item's glowing hop out of the pack and back in. */
  keeps: number[];
  /** Progress of the Field Notes scroll falling into the pack. */
  notes: number;
  done: boolean;
}

const progress = (t: number, start: number, duration: number): number =>
  Math.min(1, Math.max(0, (t - start) / duration));

function staggered(
  t: number,
  count: number,
  start: number,
  spread: number,
  flight: number,
): number[] {
  const gap = count > 1 ? spread / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => progress(t, start + i * gap, flight));
}

export function campStateAt(seconds: number, drops: number, keeps: number): CampState {
  const t = Math.max(0, seconds);
  return {
    fire: t >= CAMP.fireLit,
    packOpen: t >= CAMP.packOff && t < CAMP.packOn,
    drops: staggered(t, drops, CAMP.dropStart, CAMP.dropSpread, CAMP.dropFlight),
    pileOpacity: 1 - progress(t, CAMP.fadeStart, CAMP.fadeEnd - CAMP.fadeStart),
    keeps: staggered(t, keeps, CAMP.keepStart, CAMP.keepSpread, CAMP.keepFlight),
    notes: progress(t, CAMP.notesStart, CAMP.notesFlight),
    done: t >= CAMP_SECONDS,
  };
}
