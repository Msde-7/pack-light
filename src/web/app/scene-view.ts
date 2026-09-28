import type { SceneCue } from '../../core/protocol';
import { createScene } from '../scene';
import type { AppContext } from './context';
import { byId } from './dom';
import { SCENE_HEIGHT, SCENE_WIDTH, applyLayout, planLayout } from './layout';
import type { MotionPref } from './prefs';
import { currentSession } from './store';

export function prefersReducedMotion(motion: MotionPref): boolean {
  if (motion !== 'system') return motion === 'reduce';
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface SceneView {
  cue(cue: SceneCue): void;
  skipCamp(): void;
}

export function mountScene(ctx: AppContext): SceneView {
  const canvas = byId('scene', HTMLCanvasElement);
  const hint = byId('scene-hint', HTMLElement);
  canvas.width = SCENE_WIDTH;
  canvas.height = SCENE_HEIGHT;
  const scene = createScene(canvas, {
    reducedMotion: prefersReducedMotion(ctx.store.get().motion),
  });
  const skip = (): void => {
    scene.skipCamp();
  };
  const syncMotion = (): void => {
    scene.setReducedMotion(prefersReducedMotion(ctx.store.get().motion));
  };

  fitLayout(canvas);
  canvas.addEventListener('click', skip);
  hint.addEventListener('click', skip);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', syncMotion);

  ctx.store.subscribe((state, previous) => {
    const session = currentSession(state);
    if (session !== currentSession(previous)) {
      safely(() => {
        scene.setSession(session);
      });
    }
    if (state.motion !== previous.motion) syncMotion();
    hint.hidden = session?.phase !== 'camping';
  });
  safely(() => {
    scene.setSession(currentSession(ctx.store.get()));
  });

  return {
    cue: cue => {
      safely(() => {
        scene.cue(cue);
      });
    },
    skipCamp: skip,
  };
}

/** The scene is drawn by its own module. A bug there should never take down the panels. */
function safely(run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error('scene error', error);
  }
}

/** Only the viewport decides the layout, so growing panels never nudge the scene. */
function fitLayout(canvas: HTMLCanvasElement): void {
  const fit = (): void => {
    applyLayout(
      planLayout(window.innerWidth, window.innerHeight),
      document.documentElement,
      canvas,
    );
  };
  window.addEventListener('resize', fit);
  fit();
}
