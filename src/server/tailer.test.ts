import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTailer } from './tailer';

let dir: string;
let file: string;
let text: string;
let resets: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'packlight-tail-'));
  file = join(dir, 't.jsonl');
  text = '';
  resets = 0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tailer(chunkBytes?: number) {
  return createTailer({
    path: file,
    onText: chunk => {
      text += chunk;
    },
    onReset: () => {
      resets += 1;
      text = '';
    },
    ...(chunkBytes === undefined ? {} : { chunkBytes }),
  });
}

it('waits for a missing file and reads it once it appears', async () => {
  const t = tailer();
  await t.poll();
  expect(text).toBe('');
  writeFileSync(file, 'a\n');
  await t.poll();
  expect(text).toBe('a\n');
});

it('reads only what was appended, keeping multibyte characters whole across chunks', async () => {
  writeFileSync(file, '≈≈≈\n');
  const t = tailer(2);
  await t.poll();
  appendFileSync(file, 'partial');
  await t.poll();
  appendFileSync(file, ' line ≈\n');
  await t.poll();
  expect(text).toBe('≈≈≈\npartial line ≈\n');
});

it('starts over when the file is truncated', async () => {
  writeFileSync(file, 'one\ntwo\n');
  const t = tailer();
  await t.poll();
  writeFileSync(file, 'x\n');
  await t.poll();
  expect(resets).toBe(1);
  expect(text).toBe('x\n');
});

it('rewinds on request', async () => {
  writeFileSync(file, 'one\n');
  const t = tailer();
  await t.poll();
  t.rewind();
  text = '';
  await t.poll();
  expect(text).toBe('one\n');
});
