import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type PackLightServer } from '../server/index';
import { hike, parseDemoArgs } from './demo';
import { API, demoItemId, demoSteps, TRAIL } from './demo-script';

let home: string;
let server: PackLightServer;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'packlight-demo-'));
  process.env.PACK_LIGHT_HOME = home;
  server = await startServer({ discoverMinutes: 0, webRoot: home });
  await hike(server, home, 1000);
  await server.hub.tick();
});

afterAll(async () => {
  await server.close();
  delete process.env.PACK_LIGHT_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('demo hike', () => {
  it('fills two sessions', () => {
    expect(
      server.hub
        .list()
        .map(s => s.sessionId)
        .sort(),
    ).toEqual([API.sessionId, TRAIL.sessionId].sort());
  });

  it('tells the whole story on the main trail', () => {
    const trail = server.hub.get(TRAIL.sessionId)!;
    const byId = (toolUseId: string) =>
      trail.items.find(item => item.id === demoItemId(TRAIL, toolUseId));

    expect(trail.compactions).toHaveLength(1);
    expect(trail.pins.map(pin => pin.itemId)).toEqual([demoItemId(TRAIL, 't1')]);
    expect(byId('t1')).toMatchObject({ status: 'pinned', mentionedInSummary: true });
    expect(byId('t4')?.duplicateOf).toBe(demoItemId(TRAIL, 't1'));
    expect(byId('t5')?.status).toBe('repacked');
    expect(Object.values(trail.subagents)).toHaveLength(1);
    expect(trail.compactions[0]?.droppedIds).toContain(demoItemId(TRAIL, 't5'));
  });
});

describe('interactive demo', () => {
  const total = (interactive: boolean): number =>
    demoSteps({ interactive }).reduce((sum, step) => sum + step.wait, 0);

  it('leaves the pin and the repack out without changing the pacing', () => {
    const actions = demoSteps({ interactive: true }).map(step => step.action.type);
    expect(actions).not.toContain('pin');
    expect(actions).not.toContain('repack');
    expect(total(true)).toBe(total(false));
  });

  it('drops everything at camp when nobody pins', async () => {
    const other = mkdtempSync(join(tmpdir(), 'packlight-demo-hands-'));
    process.env.PACK_LIGHT_HOME = other;
    const bare = await startServer({ discoverMinutes: 0, webRoot: other });
    try {
      await hike(bare, other, 1000, true);
      await bare.hub.tick();
      const trail = bare.hub.get(TRAIL.sessionId)!;
      const t5 = trail.items.find(item => item.id === demoItemId(TRAIL, 't5'));
      expect(trail.pins).toEqual([]);
      expect(t5?.status).toBe('dropped');
    } finally {
      await bare.close();
      process.env.PACK_LIGHT_HOME = home;
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('parseDemoArgs', () => {
  it('reads flags and rejects unknown ones', () => {
    expect(parseDemoArgs(['--no-open', '--speed', '4', '--loop'])).toEqual({
      open: false,
      loop: true,
      interactive: false,
      speed: 4,
    });
    expect(parseDemoArgs(['--interactive'])).toMatchObject({ interactive: true });
    expect(parseDemoArgs(['--speed'])).toBe('--speed needs a number.');
    expect(parseDemoArgs(['--wat'])).toBe('Unknown option "--wat".');
  });
});
