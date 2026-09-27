// Builds the sprite gallery and opens it, unless --no-open.
import { spawn } from 'node:child_process';
import { buildGallery } from './lib.mjs';

const gallery = await buildGallery();
console.log(`gallery at ${gallery}`);
if (!process.argv.includes('--no-open')) openBrowser(gallery);

function openBrowser(url) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true })
    .on('error', () => undefined)
    .unref();
}
