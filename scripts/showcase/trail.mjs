// The main shot. The demo trail runs in this process on a clock that only moves with the
// recorded frames, and the pin and the repack happen through the real page with the cursor.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecorder } from './recorder.mjs';

/** Demo milliseconds per page millisecond. Below 1 gives each beat a little more air. */
const PACE = 0.85;
/** How often the server re-derives phases, in demo milliseconds, like its own ticker. */
const TICK_MS = 500;
const SIDEBAR_WIDTH = 544;

export async function recordTrail(browser, { trail, webRoot, fps, file }) {
  const home = mkdtempSync(join(tmpdir(), 'pack-light-showcase-'));
  process.env.PACK_LIGHT_HOME = home;
  const epoch = Date.now();
  const demo = { ms: 0, paused: false, holdAt: Infinity, lastTick: 0, next: 0 };
  const now = () => epoch + demo.ms;
  const server = await trail.startServer({
    discoverMinutes: 0,
    webRoot,
    tickMs: 1_000_000_000,
    now,
  });

  let at = 0;
  const steps = trail.demoSteps({ interactive: true }).map(step => {
    at += step.wait;
    return { at, action: step.action };
  });
  const trailId = trail.TRAIL.sessionId;
  const itemId = toolUseId => trail.demoItemId(trail.TRAIL, toolUseId);

  let rec;
  const advance = async dt => {
    if (demo.paused) return;
    demo.ms = Math.min(demo.ms + dt * PACE, demo.holdAt);
    let changed = false;
    while (demo.next < steps.length && steps[demo.next].at <= demo.ms) {
      const { at: due, action } = steps[demo.next++];
      await trail.performStep(server, home, action, epoch + due);
      changed = true;
    }
    if (demo.ms - demo.lastTick >= TICK_MS) {
      demo.lastTick = demo.ms;
      await server.hub.tick();
      changed = true;
    }
    if (changed) await rec.settle();
  };

  rec = await openRecorder(browser, {
    url: server.url,
    fps,
    file,
    captionArea: { x: 0, y: 0, width: 1920 - SIDEBAR_WIDTH, height: 1080 },
    beforeFrame: advance,
  });
  const { page } = rec;
  const marks = {};
  const mark = name => {
    marks[name] = rec.seconds;
  };

  /** Records frames until the demo clock reaches a moment of the script, in demo ms. */
  const until = async ms => {
    while (demo.ms < ms) await rec.frames(1);
  };
  const stepAt = predicate => steps.find(step => predicate(step.action))?.at ?? 0;
  const toolAt = toolUseId =>
    stepAt(a => a.type === 'event' && a.body.tool?.toolUseId === toolUseId);
  const eventAt = event => stepAt(a => a.type === 'event' && a.body.event === event);
  const lastPromptAt = steps.findLast(
    step => step.action.type === 'event' && step.action.body.event === 'UserPromptSubmit',
  ).at;

  const sceneBox = await page.locator('#scene').boundingBox();
  const sidebar = page.locator('aside.side');
  const scrollSidebar = async (to, ms = 500) => {
    const from = await sidebar.evaluate(el => el.scrollTop);
    const target = to === 'end' ? await sidebar.evaluate(el => el.scrollHeight) : to;
    const frames = Math.round((ms / 1000) * fps);
    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await sidebar.evaluate((el, y) => (el.scrollTop = y), from + (target - from) * eased);
      await rec.frames(1);
    }
  };

  // Opening, the pack fills.
  await rec.frames(1);
  const tab = page.locator('[role="tab"]', { hasText: 'trail-app' });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await until(1300);
  await rec.caption('Every file read and tool output\nlands in the pack');
  await until(toolAt('t4') - 1500);
  mark('stack');
  await until(toolAt('t4') + 250);
  await rec.caption('Read it twice and it stacks');
  await until(eventAt('SubagentStart') + 250);
  await rec.caption('Subagents walk alongside');

  // The pin, by hand. The demo waits while the person works, like a real session between tools.
  await until(toolAt('t7') + 600);
  demo.paused = true;
  mark('pin');
  await rec.caption('Pin what matters');
  const stack = page.locator(`.slot[data-id="${itemId('t1')}"]`);
  const slot = (await stack.count()) > 0 ? stack : page.locator('.slot:has(.slot-stack)').first();
  await rec.click(slot, { ms: 900 });
  await rec.hold(300);
  await rec.click(page.locator('#note-input'), { ms: 600 });
  await rec.type('the 401 comes from a token refresh race');
  await rec.hold(300);
  await rec.click(page.locator('#detail-body button', { hasText: 'Pin with note' }), { ms: 500 });
  await rec.hold(900);
  mark('pinned');
  await rec.moveTo({ x: 1100, y: 620 }, 700);
  demo.paused = false;

  // Heavier and heavier.
  await until(toolAt('t9') - 200);
  await rec.caption('The fuller the context,\nthe heavier the walk');

  // Camp, up close. The frame stops above the skip hint and keeps every art pixel 2x2.
  const campFrame = {
    x: Math.round(sceneBox.x + 26),
    y: Math.round(sceneBox.y + sceneBox.height - 540 - 64),
    width: 960,
    height: 540,
  };
  // The next prompt waits for the repack, however long camp takes to film.
  demo.holdAt = lastPromptAt - 300;
  const pinsBack = 'Unpinned items stay behind.\nPins come back, guaranteed.';
  await until(eventAt('PreCompact') - 900);
  await rec.caption('');
  await rec.hold(300);
  mark('camp');
  await rec.pan(campFrame, 800);
  await rec.caption('Compaction is a campfire stop');
  await until(eventAt('PostCompact') + 1300 * PACE);
  await rec.caption(pinsBack);
  await until(eventAt('PostCompact') + 3900 * PACE);
  await rec.caption('');
  await rec.hold(300);
  await rec.pan(undefined, 800);
  await rec.caption(pinsBack);
  await rec.hold(2400);
  mark('camped');

  // The repack, by hand, before the next prompt picks it up.
  await rec.caption('Repack anything on your next prompt');
  await scrollSidebar('end', 600);
  const dropped = page.locator(`label[for="lost-${itemId('t5')}"]`);
  await rec.click(dropped, { ms: 900 });
  await rec.click(page.locator('#repack'), { ms: 600 });
  await rec.hold(800);
  mark('repacked');
  await rec.moveTo({ x: 1000, y: 560 }, 700);
  demo.holdAt = Infinity;
  await until(steps.at(-1).at + 200);
  await scrollSidebar(0, 600);
  await rec.hold(2200);
  await rec.caption('');
  await rec.hold(600);

  const frames = await rec.close();
  const errors = rec.errors;
  await server.close();
  rmSync(home, { recursive: true, force: true });
  if (errors.length > 0) throw new Error(`Page errors:\n${errors.join('\n')}`);
  const trailState = server.hub.get(trailId);
  return { frames, marks, sceneBox, pins: trailState?.pins.length ?? 0 };
}
