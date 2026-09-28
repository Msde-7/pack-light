import type { SessionPhase } from '../../core/types';
import { ANIMATIONS, animationFrame, gaitFrame } from '../sprites/animations';
import { poseForFill } from './motion';

export interface HikerInput {
  phase: SessionPhase;
  fill: number;
  seconds: number;
  /** Scene pixels walked, which drives the walk cycle. */
  walked: number;
  /** Seconds since a cheer began, while it plays. */
  cheerAge?: number;
  camping: boolean;
  reducedMotion: boolean;
}

export interface HikerView {
  frame: string;
  bubble?: 'bubble_alert' | 'bubble_zzz';
  sweat: boolean;
  /** True when the trail should scroll under the hiker. */
  walking: boolean;
  /** Pixels off the ground, for the cheer's hops. */
  lift: number;
}

export const CHEER_SECONDS = 1.6;

/** Two hops, each a crouch, a jump and a landing, then arms up on the ground. */
const HOP_SECONDS = 0.5;
const HOPS = 2;
const HOP_HEIGHT = 5;

/** An exhausted hiker takes a few heavy steps, then stops, hands on knees, to breathe. */
const STAGGER_SECONDS = 3.2;
const STAGGER_STEPS = 1.7;

const BREATH_SECONDS = 3.2;
const BLINK_SECONDS = 4.3;

function cheer(age: number): Pick<HikerView, 'frame' | 'lift'> {
  if (age >= HOP_SECONDS * HOPS) return { frame: 'hiker_cheer_up', lift: 0 };
  const t = (age % HOP_SECONDS) / HOP_SECONDS;
  if (t < 0.2 || t >= 0.8) return { frame: 'hiker_cheer_crouch', lift: 0 };
  const air = (t - 0.2) / 0.6;
  return { frame: 'hiker_cheer_up', lift: Math.round(HOP_HEIGHT * Math.sin(Math.PI * air)) };
}

/** A resting frame that breathes and now and then blinks. */
function resting(name: 'hiker_stand' | 'hiker_sit', seconds: number): string {
  if (seconds % BLINK_SECONDS > BLINK_SECONDS - 0.15) return `${name}_blink`;
  return seconds % BREATH_SECONDS < BREATH_SECONDS / 2 ? name : `${name}_breath`;
}

export function hikerView(input: HikerInput): HikerView {
  const still = { sweat: false, walking: false, lift: 0 };
  const seconds = input.reducedMotion ? 0 : input.seconds;
  if (input.camping) return { ...still, frame: animationFrame(ANIMATIONS.camp, seconds) };
  if (input.cheerAge !== undefined && input.cheerAge < CHEER_SECONDS) {
    return { ...still, ...cheer(input.cheerAge) };
  }
  if (input.phase === 'waiting_for_user' || input.phase === 'idle') {
    const bubble = input.phase === 'idle' ? 'bubble_zzz' : 'bubble_alert';
    return { ...still, frame: resting('hiker_sit', seconds), bubble };
  }
  const pose = poseForFill(input.fill);
  const walking = input.phase === 'walking';
  const walked = input.reducedMotion ? 0 : input.walked;
  if (pose === 'exhausted') {
    const stepping = walking && !input.reducedMotion && seconds % STAGGER_SECONDS < STAGGER_STEPS;
    const frame = stepping
      ? gaitFrame(ANIMATIONS.tired, walked)
      : animationFrame(ANIMATIONS.exhausted, seconds);
    return { frame, sweat: true, walking: stepping, lift: 0 };
  }
  if (walking) {
    return { frame: gaitFrame(ANIMATIONS[pose], walked), sweat: false, walking, lift: 0 };
  }
  const frame = pose === 'tired' ? 'hiker_tired_2' : resting('hiker_stand', seconds);
  return { ...still, frame };
}
