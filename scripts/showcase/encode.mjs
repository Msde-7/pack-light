// Final encodes from the lossless masters.
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';

const FADE = 0.5;

function ffmpeg(args) {
  const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

export function megabytes(file) {
  return (statSync(file).size / 1024 / 1024).toFixed(1);
}

const BT709 = [
  '-colorspace',
  'bt709',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-color_range',
  'tv',
];

/** Title, trail and end card, cross-faded, as a web-ready H.264 file. */
export function encodeVideo({ parts, fps, out }) {
  const inputs = parts.flatMap(part => ['-i', part.file]);
  const chain = [];
  let label = '0:v';
  let length = parts[0].seconds;
  for (let i = 1; i < parts.length; i++) {
    const next = `x${i}`;
    chain.push(
      `[${label}][${i}:v]xfade=transition=fade:duration=${FADE}:offset=${(length - FADE).toFixed(3)}[${next}]`,
    );
    length += parts[i].seconds - FADE;
    label = next;
  }
  chain.push(
    `[${label}]fade=t=in:st=0:d=0.4,fade=t=out:st=${(length - 0.7).toFixed(3)}:d=0.7,` +
      'scale=out_color_matrix=bt709:out_range=tv:flags=neighbor,format=yuv420p[v]',
  );
  ffmpeg([
    ...inputs,
    '-filter_complex',
    chain.join(';'),
    '-map',
    '[v]',
    '-r',
    String(fps),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-tune',
    'animation',
    '-crf',
    '17',
    ...BT709,
    '-movflags',
    '+faststart',
    out,
  ]);
  return length;
}

/**
 * A short README loop cut from the trail master. The scene is drawn at 4x, so halving the
 * frame on the scene's pixel grid keeps every art pixel a crisp 2x2 block.
 */
export function encodeGif({ master, clips, gridOffset, out, fps = 12 }) {
  const trims = clips.map(
    ([start, end], i) =>
      `[0:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS[c${i}]`,
  );
  const joined = clips.map((_, i) => `[c${i}]`).join('');
  const { x, y } = gridOffset;
  const shape =
    `concat=n=${clips.length}:v=1:a=0,fps=${fps},` +
    `crop=iw-${2 * x}:ih-${2 * y}:${x}:${y},scale=iw/2:ih/2:flags=area`;
  const graph = [
    ...trims,
    `${joined}${shape},split[a][b]`,
    '[a]palettegen=max_colors=256:stats_mode=full[p]',
    '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
  ].join(';');
  ffmpeg(['-i', master, '-filter_complex', graph, '-loop', '0', out]);
}
