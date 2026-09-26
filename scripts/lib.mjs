// Build steps shared by the production build and the dev scripts.
import { build } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const artifacts = join(root, '.artifacts');

const FONTS = [
  { pkg: 'vt323', license: 'VT323-OFL.txt' },
  { pkg: 'press-start-2p', license: 'PressStart2P-OFL.txt' },
];

function copyFonts(webDir) {
  const out = join(webDir, 'fonts');
  mkdirSync(out, { recursive: true });
  for (const { pkg, license } of FONTS) {
    const dir = join(root, 'node_modules/@fontsource', pkg);
    const file = `${pkg}-latin-400-normal.woff2`;
    cpSync(join(dir, 'files', file), join(out, file));
    cpSync(join(dir, 'LICENSE'), join(out, license));
  }
}

function bundle(entry, outfile, options) {
  return build({
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    logLevel: 'warning',
    ...options,
  });
}

/** The shipped web app, its static files and the OFL pixel fonts, into `webDir`. */
export async function buildApp(webDir) {
  await bundle('src/web/main.ts', join(webDir, 'app.js'), {
    format: 'esm',
    minify: true,
    sourcemap: true,
  });
  cpSync(join(root, 'src/web/static'), webDir, { recursive: true });
  copyFonts(webDir);
}

/** Builds the sprite gallery into .artifacts/dev and returns its file URL. */
export async function buildGallery() {
  const out = join(artifacts, 'dev');
  await bundle('src/web/dev/gallery.ts', join(out, 'gallery.js'), { format: 'iife' });
  copyFileSync(join(root, 'src/web/dev/gallery.html'), join(out, 'gallery.html'));
  return pathToFileURL(join(out, 'gallery.html')).href;
}
