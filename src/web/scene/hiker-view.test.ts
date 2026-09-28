import { describe, expect, it } from 'vitest';
import { CHEER_SECONDS, hikerView } from './hiker-view';
import type { HikerInput } from './hiker-view';

const base: HikerInput = {
  phase: 'walking',
  fill: 0.3,
  seconds: 0,
  walked: 0,
  camping: false,
  reducedMotion: false,
};

describe('hikerView', () => {
  it('steps through six frames per 16 pixels walked, whatever the time', () => {
    const frames = [0, 3, 6, 8, 11, 14].map(walked => hikerView({ ...base, walked }).frame);
    expect(frames).toEqual([1, 2, 3, 4, 5, 6].map(i => `hiker_walk_${i}`));
    expect(hikerView({ ...base, walked: 3, seconds: 9 }).frame).toBe('hiker_walk_2');
    expect(hikerView(base).walking).toBe(true);
  });

  it('trudges when tired', () => {
    expect(hikerView({ ...base, fill: 0.8 }).frame).toMatch(/^hiker_tired_/);
  });

  it('staggers when exhausted, a few steps and then a stop, hands on knees', () => {
    const stepping = hikerView({ ...base, fill: 0.95, seconds: 0.5 });
    expect(stepping).toMatchObject({ walking: true, sweat: true });
    expect(stepping.frame).toMatch(/^hiker_tired_/);
    const resting = hikerView({ ...base, fill: 0.95, seconds: 2.5 });
    expect(resting).toMatchObject({ walking: false, sweat: true });
    expect(resting.frame).toMatch(/^hiker_exhausted_/);
  });

  it('sits with a bubble while waiting or idle, breathing, and does not walk', () => {
    expect(hikerView({ ...base, phase: 'waiting_for_user', seconds: 0.5 })).toEqual({
      frame: 'hiker_sit',
      bubble: 'bubble_alert',
      sweat: false,
      walking: false,
      lift: 0,
    });
    expect(hikerView({ ...base, phase: 'idle', seconds: 2 })).toMatchObject({
      frame: 'hiker_sit_breath',
      bubble: 'bubble_zzz',
    });
  });

  it('stands, breathes and blinks when done', () => {
    const frames = [0, 2, 4.2].map(seconds => hikerView({ ...base, phase: 'done', seconds }).frame);
    expect(frames).toEqual(['hiker_stand', 'hiker_stand_breath', 'hiker_stand_blink']);
    expect(hikerView({ ...base, phase: 'done', fill: 0.8 }).frame).toBe('hiker_tired_2');
  });

  it('hops twice when cheering, then holds its arms up', () => {
    const lifts = [0.05, 0.25, 0.3, 0.45].map(cheerAge => hikerView({ ...base, cheerAge }).lift);
    expect(lifts[0]).toBe(0);
    expect(Math.max(...lifts)).toBeGreaterThan(3);
    expect(hikerView({ ...base, cheerAge: 0.05 }).frame).toBe('hiker_cheer_crouch');
    expect(hikerView({ ...base, cheerAge: 1.3 })).toMatchObject({
      frame: 'hiker_cheer_up',
      lift: 0,
    });
    expect(hikerView({ ...base, cheerAge: CHEER_SECONDS }).frame).toMatch(/^hiker_walk_/);
  });

  it('camps before it cheers', () => {
    expect(hikerView({ ...base, camping: true, cheerAge: 0.2 }).frame).toMatch(/^hiker_camp_/);
    expect(hikerView({ ...base, phase: 'idle', cheerAge: 0.2 }).frame).toMatch(/^hiker_cheer_/);
  });

  it('holds one frame with reduced motion', () => {
    const frames = [0, 0.2, 0.4].map(
      seconds => hikerView({ ...base, seconds, walked: seconds * 40, reducedMotion: true }).frame,
    );
    expect(new Set(frames).size).toBe(1);
    const exhausted = hikerView({ ...base, fill: 0.95, reducedMotion: true, seconds: 2 });
    expect(exhausted.frame).toBe('hiker_exhausted_1');
  });
});
