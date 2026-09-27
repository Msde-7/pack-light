import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { findRecentTranscripts, subagentTranscriptPath } from './discover';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'packlight-projects-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

it('finds recently changed main transcripts only', () => {
  const project = join(root, 'C--work');
  mkdirSync(join(project, 'abc', 'subagents'), { recursive: true });
  writeFileSync(join(project, 'abc.jsonl'), '');
  writeFileSync(join(project, 'old.jsonl'), '');
  writeFileSync(join(project, 'notes.txt'), '');
  writeFileSync(join(project, 'abc', 'subagents', 'agent-x.jsonl'), '');
  const hourAgo = new Date(Date.now() - 2 * 3_600_000);
  utimesSync(join(project, 'old.jsonl'), hourAgo, hourAgo);
  const found = findRecentTranscripts(root, Date.now() - 3_600_000);
  expect(found.map(f => f.sessionId)).toEqual(['abc']);
  expect(findRecentTranscripts(join(root, 'missing'), 0)).toEqual([]);
});

it('puts subagent transcripts next to the parent', () => {
  expect(subagentTranscriptPath(join('p', 'abc.jsonl'), 'a1')).toBe(
    join('p', 'abc', 'subagents', 'agent-a1.jsonl'),
  );
});
