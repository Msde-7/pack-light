import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../core/config';
import { fixturePath } from '../core/fixtures';
import { writePins } from '../core/store';
import { describeSession, sessionFromTranscript } from './status';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'packlight-status-'));
  process.env.PACK_LIGHT_HOME = home;
});

afterEach(() => {
  delete process.env.PACK_LIGHT_HOME;
  rmSync(home, { recursive: true, force: true });
});

const LATER = Date.parse('2026-09-02T00:00:00Z');
const settings = { config: DEFAULT_CONFIG, claude: { disable1m: false } };

it('summarizes a session read straight from its transcript', () => {
  writePins('fixture-session-1', [
    { itemId: 'x', kind: 'file_read', label: 'src/auth.ts', pinnedAt: 1 },
  ]);
  const state = sessionFromTranscript(
    'fixture-session-1',
    fixturePath('trail.jsonl'),
    settings,
    LATER,
  );
  expect(state).toBeDefined();
  const text = describeSession(state!);
  expect(text).toContain('● demo-app');
  expect(text).toContain('7% to camp · 7% of window · ≈65K / 1M · claude-opus-5[1m]');
  expect(text).toContain('1. Field Notes');
  expect(text).toContain('2. src/auth.ts');
  expect(text).toContain('resting');
  expect(text).toContain('1 pin');
  expect(text).not.toMatch(/npm test/);
});

it('skips transcripts it cannot read', () => {
  expect(sessionFromTranscript('nope', join(home, 'missing.jsonl'), settings, 0)).toBeUndefined();
});
