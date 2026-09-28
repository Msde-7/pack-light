// Frame-perfect capture. Page time only moves when the recorder advances Playwright's fake
// clock by one frame, so every frame is a screenshot of exactly the moment it stands for.
import { spawn } from 'node:child_process';
import { installOverlay } from './overlay.mjs';

const START = new Date('2026-09-28T09:00:00Z').getTime();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Pipes PNG frames into a lossless master file that the final encodes start from. */
export function createEncoder(file, fps) {
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      String(fps),
      '-c:v',
      'png',
      '-i',
      '-',
      '-c:v',
      'libx264rgb',
      '-preset',
      'ultrafast',
      '-crf',
      '0',
      file,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise((resolve, reject) => {
    ffmpeg.on('exit', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
  return {
    write: png =>
      new Promise(resolve => {
        if (ffmpeg.stdin.write(png)) resolve();
        else ffmpeg.stdin.once('drain', resolve);
      }),
    close: async () => {
      ffmpeg.stdin.end();
      await done;
    },
  };
}

export async function openRecorder(
  browser,
  {
    url,
    fps,
    file,
    width = 1920,
    height = 1080,
    captionArea = { x: 0, y: 0, width, height },
    beforeFrame = async () => {},
  },
) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    bypassCSP: true,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.clock.install({ time: START });
  await page.clock.pauseAt(START + 1000);
  await page.addInitScript(installOverlay);
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  const cdp = await context.newCDPSession(page);
  const encoder = createEncoder(file, fps);

  let frame = 0;
  let pageMs = 0;
  const full = { x: 0, y: 0, width, height };
  let camera = full;
  let mouse = { x: width * 0.72, y: height * 1.1 };

  const settle = async () => {
    let last = -1;
    let calm = 0;
    while (calm < 2) {
      await sleep(40);
      const net = await page.evaluate(() => ({ ...window.__showcase.net }));
      calm = net.messages === last && net.inflight === 0 ? calm + 1 : 0;
      last = net.messages;
    }
  };

  const placeCaption = () => {
    const zoomed = camera.width < width;
    const area = zoomed ? camera : captionArea;
    return page.evaluate(
      ([a, u, top]) => window.__showcase.captionFrame(a, u, top),
      [area, camera.width / width, zoomed],
    );
  };
  await placeCaption();

  const shoot = async () => {
    const clip = { ...camera, scale: width / camera.width };
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip,
      optimizeForSpeed: true,
    });
    await encoder.write(Buffer.from(data, 'base64'));
  };

  /** Advances page time by one frame and records it. */
  const tick = async () => {
    frame++;
    const target = Math.round((frame * 1000) / fps);
    await beforeFrame(target - pageMs);
    await page.clock.runFor(target - pageMs);
    pageMs = target;
    await page.evaluate(() => window.__showcase.driveAnimations());
    await shoot();
  };

  const frames = async count => {
    for (let i = 0; i < count; i++) await tick();
  };
  const hold = ms => frames(Math.round((ms / 1000) * fps));

  /** Glides the pointer to a point, or to a point that may move while the pointer travels. */
  const moveTo = async (target, ms = 700) => {
    const where = typeof target === 'function' ? target : async () => target;
    const from = { ...mouse };
    const steps = Math.max(1, Math.round((ms / 1000) * fps));
    for (let i = 1; i <= steps; i++) {
      const to = await where();
      const t = ease(i / steps);
      // A slight arc reads as a hand, a straight line reads as a robot.
      const bend = Math.min(70, Math.hypot(to.x - from.x, to.y - from.y) * 0.1);
      const lift = Math.sin(Math.PI * t) * bend;
      mouse = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - lift };
      await page.mouse.move(mouse.x, mouse.y);
      await tick();
    }
  };

  const center = async locator => {
    await locator.waitFor({ state: 'visible' });
    const box = await locator.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  const click = async (locator, { ms = 750, dwell = 250 } = {}) => {
    await moveTo(() => center(locator), ms);
    const target = await center(locator);
    await page.mouse.move(target.x, target.y);
    mouse = target;
    await hold(dwell);
    await page.mouse.down();
    await tick();
    await tick();
    await page.mouse.up();
    await settle();
    await hold(200);
  };

  const type = async (text, perChar = 2) => {
    for (const char of text) {
      await page.keyboard.type(char);
      await frames(char === ' ' ? perChar + 1 : perChar);
    }
  };

  return {
    page,
    errors,
    frames,
    hold,
    settle,
    moveTo,
    click,
    type,
    center,
    caption: text => page.evaluate(t => window.__showcase.caption(t), text ?? ''),
    /** Eases the camera to a 16:9 region of the page, or back to the whole page. */
    pan: async (rect = full, ms = 600) => {
      const from = camera;
      const steps = Math.max(1, Math.round((ms / 1000) * fps));
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps);
        const mix = key => from[key] + (rect[key] - from[key]) * t;
        camera = {
          x: mix('x'),
          y: mix('y'),
          width: mix('width'),
          height: mix('width') * (height / width),
        };
        await placeCaption();
        await tick();
      }
      camera = rect;
      await placeCaption();
    },
    get seconds() {
      return frame / fps;
    },
    close: async () => {
      await encoder.close();
      await context.close();
      return frame;
    },
  };
}
