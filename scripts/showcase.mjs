// Renders the Pack Light showcase video and README gif, frame by frame.
//   node scripts/showcase.mjs
// Page time runs on Playwright's fake clock and moves one frame per screenshot, and the demo
// trail runs in this process on the same beat, so the result is smooth however slow capture is.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { artifacts, root } from './lib.mjs';
import { buildCardScript, loadTrail } from './showcase/bundles.mjs';
import { encodeGif, encodeVideo, megabytes } from './showcase/encode.mjs';
import { openRecorder } from './showcase/recorder.mjs';
import { recordTrail } from './showcase/trail.mjs';

const FPS = 30;
const out = join(artifacts, 'showcase');
const work = join(out, 'build');
const webRoot = join(root, 'dist/web');
mkdirSync(work, { recursive: true });

execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { stdio: 'inherit' });
const trail = await loadTrail(work);
await buildCardScript(work);
copyFileSync(join(root, 'scripts/showcase/card.html'), join(work, 'card.html'));
cpSync(join(webRoot, 'fonts'), join(work, 'fonts'), { recursive: true });

const browser = await chromium.launch();
try {
  const title = await recordCard('title', 3.2);
  console.log('recorded the title card');
  const main = await recordTrail(browser, {
    trail,
    webRoot,
    fps: FPS,
    file: join(work, 'trail.mkv'),
  });
  console.log(`recorded the trail, ${(main.frames / FPS).toFixed(1)} s`, main.marks);
  if (main.pins !== 1) throw new Error('The pin did not land through the page.');
  const end = await recordCard('end', 4.2);
  console.log('recorded the end card');

  const video = join(out, 'pack-light.mp4');
  const seconds = encodeVideo({
    parts: [title, { file: join(work, 'trail.mkv'), seconds: main.frames / FPS }, end],
    fps: FPS,
    out: video,
  });
  console.log(`wrote ${video}, ${seconds.toFixed(1)} s, ${megabytes(video)} MB`);

  const { marks, sceneBox } = main;
  const gif = join(root, 'docs/showcase.gif');
  encodeGif({
    master: join(work, 'trail.mkv'),
    clips: [
      [marks.stack, marks.stack + 4.5],
      [marks.pin + 0.3, marks.pinned + 0.4],
      [marks.camp, marks.camped - 1],
    ],
    gridOffset: { x: Math.round(sceneBox.x) % 2, y: Math.round(sceneBox.y) % 2 },
    out: gif,
  });
  console.log(`wrote ${gif}, ${megabytes(gif)} MB`);
} finally {
  await browser.close();
}

async function recordCard(card, seconds) {
  const file = join(work, `${card}.mkv`);
  const url = `${pathToFileURL(join(work, 'card.html')).href}?card=${card}`;
  const rec = await openRecorder(browser, { url, fps: FPS, file });
  await rec.hold(seconds * 1000);
  const frames = await rec.close();
  if (rec.errors.length > 0) throw new Error(rec.errors.join('\n'));
  return { file, seconds: frames / FPS };
}
