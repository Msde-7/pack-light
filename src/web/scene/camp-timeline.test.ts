import { describe, expect, it } from 'vitest';
import { CAMP, CAMP_SECONDS, campStateAt } from './camp-timeline';

describe('camp timeline', () => {
  it('lasts between 3 and 4 seconds', () => {
    expect(CAMP_SECONDS).toBeGreaterThanOrEqual(3);
    expect(CAMP_SECONDS).toBeLessThanOrEqual(4);
    expect(campStateAt(CAMP_SECONDS - 0.01, 3, 2).done).toBe(false);
    expect(campStateAt(CAMP_SECONDS, 3, 2).done).toBe(true);
  });

  it('lights the fire, opens the pack, then closes it', () => {
    expect(campStateAt(0, 1, 1)).toMatchObject({ fire: false, packOpen: false });
    expect(campStateAt(1, 1, 1)).toMatchObject({ fire: true, packOpen: true });
    expect(campStateAt(CAMP.packOn, 1, 1).packOpen).toBe(false);
  });

  it('drops every item before the pile fades, one after another', () => {
    const early = campStateAt(CAMP.dropStart + 0.1, 4, 0);
    expect(early.drops[0]).toBeGreaterThan(0);
    expect(early.drops[3]).toBe(0);
    expect(campStateAt(CAMP.fadeStart, 4, 0).drops).toEqual([1, 1, 1, 1]);
    expect(campStateAt(CAMP.fadeStart, 4, 0).pileOpacity).toBe(1);
    expect(campStateAt(CAMP.fadeEnd, 4, 0).pileOpacity).toBe(0);
  });

  it('hops pinned items back in, then adds the field notes', () => {
    expect(campStateAt(CAMP.keepStart - 0.01, 0, 2).keeps).toEqual([0, 0]);
    expect(campStateAt(CAMP.notesStart, 0, 2).keeps).toEqual([1, 1]);
    expect(campStateAt(CAMP.notesStart, 0, 2).notes).toBe(0);
    expect(campStateAt(CAMP.notesStart + CAMP.notesFlight, 0, 2).notes).toBe(1);
  });

  it('works with nothing dropped or pinned', () => {
    expect(campStateAt(2, 0, 0)).toMatchObject({ drops: [], keeps: [] });
  });
});
