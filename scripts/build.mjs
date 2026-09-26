import { build } from 'esbuild';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp, root } from './lib.mjs';

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dist = join(root, 'dist');
const hookDir = join(root, 'src/hooks');
const hookEntries = readdirSync(hookDir)
  .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.startsWith('_'))
  .map(file => join(hookDir, file));

const node = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
};

rmSync(dist, { recursive: true, force: true });
await Promise.all([
  build({
    ...node,
    entryPoints: [join(root, 'src/cli/main.ts')],
    outfile: join(dist, 'cli.js'),
    banner: { js: '#!/usr/bin/env node' },
    define: { 'process.env.PACK_LIGHT_VERSION': JSON.stringify(pkg.version) },
  }),
  build({ ...node, entryPoints: hookEntries, outdir: join(dist, 'hooks'), minify: true }),
  buildApp(join(dist, 'web')),
]);

console.log(`built dist with ${hookEntries.length} hooks`);
