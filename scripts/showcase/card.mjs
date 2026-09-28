// Title and end cards. They draw the real scene with a small synthetic session, so the hiker
// on the cards is the same one that walks the trail in the app.
import { createScene } from '../../src/web/scene/index';
import { PALETTE } from '../../src/web/sprites/sprites';

const KINDS = ['file_read', 'search', 'bash_output', 'web', 'edit', 'file_read'];

function session(phase, fill) {
  const items = KINDS.map((kind, i) => ({
    id: `card-${i}`,
    sessionId: 'card',
    kind,
    label: kind,
    tokensEst: 1500,
    weight: 'book',
    turn: 1,
    addedAt: 0,
    epoch: 0,
    status: 'carried',
  }));
  return {
    sessionId: 'card',
    cwd: '/home/hiker/trail-app',
    transcriptPath: '/home/hiker/trail-app.jsonl',
    title: 'trail-app',
    windowTokens: 200_000,
    compactAtTokens: 193_000,
    contextTokens: Math.round(fill * 193_000),
    contextSource: 'statusline',
    fill,
    windowFill: fill * 0.965,
    phase,
    turn: 3,
    epoch: 0,
    startedAt: 0,
    updatedAt: 0,
    items,
    subagents: {},
    compactions: [],
    pins: [],
    tips: [],
  };
}

for (const [key, color] of Object.entries(PALETTE))
  document.documentElement.style.setProperty(`--p-${key}`, color);

const card = new URLSearchParams(location.search).get('card') ?? 'title';
document.body.classList.add(`card-${card}`);
const canvas = document.querySelector('canvas');
const scene = createScene(canvas, { reducedMotion: false });
if (card === 'end') {
  scene.setSession(session('done', 0.2));
  const cheer = () => scene.cue({ cue: 'cheer' });
  setTimeout(cheer, 500);
  setInterval(cheer, 2600);
} else {
  scene.setSession(session('walking', 0.15));
}
