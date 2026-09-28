// Bundles the pieces of the app the showcase drives: the demo trail for Node, and a card
// script for the browser that draws the real scene.
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from '../lib.mjs';

const TRAIL_ENTRY = `
export { startServer } from './src/server/index';
export { performStep } from './src/cli/demo';
export { demoItemId, demoSteps, TRAIL } from './src/cli/demo-script';
`;

/** Loads the demo server and script in this process, so the recorder can step them. */
export async function loadTrail(outDir) {
  const outfile = join(outDir, 'trail.mjs');
  await build({
    stdin: { contents: TRAIL_ENTRY, resolveDir: root, loader: 'ts' },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'warning',
  });
  return import(pathToFileURL(outfile).href);
}

export async function buildCardScript(outDir) {
  await build({
    entryPoints: [join(root, 'scripts/showcase/card.mjs')],
    outfile: join(outDir, 'card.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    logLevel: 'warning',
  });
}
