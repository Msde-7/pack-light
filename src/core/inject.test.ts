import { describe, expect, it } from 'vitest';
import {
  buildCompactCommand,
  buildPinContext,
  mentionedPinIds,
  packPins,
  packRepack,
  sanitize,
} from './inject';
import type { Pin, RepackEntry } from './types';
import { LIMITS } from './types';

function pin(overrides: Partial<Pin> & Pick<Pin, 'itemId' | 'label'>): Pin {
  return { kind: 'file_read', pinnedAt: 1, ...overrides };
}

describe('sanitize', () => {
  it('strips control, bidi and zero-width characters and collapses whitespace', () => {
    expect(sanitize('a\u0000b\u0007 \u202e c\u200b\td\r\n\n e\u009b')).toBe('ab c d e');
  });

  it('keeps snippet lines and indentation readable', () => {
    const snippet = '\n\nfunction f() {\r\n\treturn 1;   \n\n\n\n}\u0000\n\n';
    expect(sanitize(snippet, { keepNewlines: true })).toBe('function f() {\n  return 1;\n\n}');
  });
});

describe('buildPinContext', () => {
  it('returns undefined without pins', () => {
    expect(buildPinContext([])).toBeUndefined();
  });

  it('matches the documented format', () => {
    const text = buildPinContext([
      pin({
        itemId: 'a',
        label: 'src/auth/middleware.ts',
        path: 'C:\\repo\\src\\auth\\middleware.ts',
        note: 'the 401 bug comes from a token refresh race in refreshSession().',
      }),
      pin({
        itemId: 'b',
        kind: 'bash_output',
        label: 'npm test -- auth',
        note: '3 tests fail, all in session-refresh.spec.ts.',
      }),
      pin({
        itemId: 'c',
        label: 'src/auth/session.ts',
        range: '40-58',
        snippet: 'const a = 1;\n  const b = 2;',
      }),
    ]);
    expect(text).toBe(
      [
        'Context carried over from before compaction (pinned by the user in Pack Light):',
        '- File src/auth/middleware.ts was read before compaction. User note: the 401 bug comes from a token refresh race in refreshSession().',
        '- Command `npm test -- auth` was run before compaction. User note: 3 tests fail, all in session-refresh.spec.ts.',
        '- Kept excerpt from src/auth/session.ts (lines 40-58):',
        '  const a = 1;',
        '    const b = 2;',
        'These files can be re-read if their current contents are needed.',
      ].join('\n'),
    );
  });

  it('phrases each kind as a factual statement', () => {
    const lines = buildPinContext([
      pin({ itemId: '1', kind: 'search', label: 'grep: refreshToken' }),
      pin({ itemId: '2', kind: 'web', label: 'example.com/docs' }),
      pin({ itemId: '3', kind: 'web', label: 'search: token refresh race' }),
      pin({ itemId: '4', kind: 'edit', label: 'edit: src/a.ts', path: '/r/src/a.ts' }),
      pin({ itemId: '5', kind: 'subagent_report', label: 'Audit auth flow' }),
      pin({ itemId: '6', kind: 'other', label: '', note: 'ship on Friday' }),
      pin({ itemId: '7', label: 'src/b.ts', range: '10-' }),
      pin({ itemId: '8', kind: 'bash_output', label: 'echo `x`' }),
    ])?.split('\n');
    expect(lines).toEqual([
      'Context carried over from before compaction (pinned by the user in Pack Light):',
      '- Search `grep: refreshToken` was run before compaction.',
      '- Web page example.com/docs was fetched before compaction.',
      '- Web search `token refresh race` was run before compaction.',
      '- File src/a.ts was edited before compaction.',
      '- Subagent report "Audit auth flow" was received before compaction.',
      '- User note: ship on Friday',
      '- File src/b.ts (from line 10) was read before compaction.',
      "- Command `echo 'x'` was run before compaction.",
      'These files can be re-read if their current contents are needed.',
    ]);
  });

  it('omits the re-read footer when no pin is a file', () => {
    const text = buildPinContext([pin({ itemId: '1', kind: 'bash_output', label: 'ls' })]);
    expect(text).not.toContain('re-read');
  });

  it('puts the note before an excerpt', () => {
    const text = buildPinContext([
      pin({ itemId: '1', label: 'src/a.ts', range: '1-2', note: 'the fix', snippet: 'x()' }),
    ]);
    expect(text).toContain('- Kept excerpt from src/a.ts (lines 1-2). User note: the fix\n  x()');
  });

  it('sanitizes and clips user text', () => {
    const text = buildPinContext([
      pin({ itemId: '1', label: 'src/a\u0000.ts', note: `x\u202e${'n'.repeat(400)}` }),
    ]);
    expect(text).toContain('File src/a.ts was read');
    expect(text).not.toContain('\u202e');
    expect(text).toContain(`User note: x${'n'.repeat(LIMITS.noteChars - 2)}…`);
  });

  it('skips pins with nothing to say', () => {
    expect(buildPinContext([pin({ itemId: '1', kind: 'other', label: '  ' })])).toBeUndefined();
  });

  it('trims from the bottom of the Keep List and stays under the cap', () => {
    const pins = Array.from({ length: 12 }, (_, i) =>
      pin({ itemId: `p${i}`, label: `src/f${i}.ts`, snippet: 'x'.repeat(1400) }),
    );
    const packed = packPins(pins);
    expect(packed).toBeDefined();
    expect(packed!.text.length).toBeLessThanOrEqual(LIMITS.injectionChars);
    const kept = packed!.included.map(p => p.itemId);
    expect(kept).toEqual(pins.slice(0, kept.length).map(p => p.itemId));
    expect(kept.length).toBeLessThan(pins.length);
    expect(packed!.text).toContain(
      `${pins.length - kept.length} lower-priority pins were left out to stay under the size limit.`,
    );
  });
});

describe('packRepack text', () => {
  const entries: RepackEntry[] = [
    { itemId: 'a', kind: 'file_read', label: 'src/x.ts', note: 'the parser' },
    { itemId: 'b', kind: 'bash_output', label: 'npm test' },
  ];

  it('returns undefined for an empty queue', () => {
    expect(packRepack([])?.text).toBeUndefined();
  });

  it('matches the documented phrasing', () => {
    expect(packRepack(entries)?.text).toBe(
      [
        'Context the user asked to bring back:',
        '- file src/x.ts (read earlier in this session, can be re-read if needed); note: the parser',
        '- command `npm test` (run earlier in this session, can be run again if needed)',
      ].join('\n'),
    );
  });

  it('stays under the cap and keeps queue order', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      itemId: `e${i}`,
      kind: 'file_read' as const,
      label: `src/f${i}.ts`,
      note: 'n'.repeat(250),
    }));
    const packed = packRepack(many)!;
    expect(packed.text.length).toBeLessThanOrEqual(LIMITS.injectionChars);
    expect(packed.included[0]?.itemId).toBe('e0');
    expect(packed.included.length).toBeLessThan(many.length);
  });
});

describe('buildCompactCommand', () => {
  it('names pins as short phrases on one line', () => {
    const command = buildCompactCommand([
      pin({ itemId: '1', label: 'src/a.ts', note: 'the race' }),
      pin({ itemId: '2', kind: 'bash_output', label: 'npm test' }),
    ]);
    expect(command).toBe('/compact Preserve: src/a.ts (the race), output of `npm test`');
  });

  it('stays under the command limit by dropping the lowest pins', () => {
    const pins = Array.from({ length: 30 }, (_, i) =>
      pin({ itemId: `p${i}`, label: `src/f${i}.ts`, note: `note ${'n'.repeat(80)}\nline` }),
    );
    const command = buildCompactCommand(pins)!;
    expect(command.length).toBeLessThanOrEqual(LIMITS.compactCommandChars);
    expect(command).not.toContain('\n');
    expect(command).toContain('src/f0.ts');
    expect(command).not.toContain('src/f29.ts');
  });

  it('returns undefined without pins', () => {
    expect(buildCompactCommand([])).toBeUndefined();
  });
});

describe('mentionedPinIds', () => {
  const pins = [
    pin({
      itemId: 'path',
      label: 'src/auth/middleware.ts',
      path: 'C:\\r\\src\\auth\\middleware.ts',
    }),
    pin({ itemId: 'base', label: 'lib/session.ts', path: '/r/lib/session.ts' }),
    pin({ itemId: 'cmd', kind: 'bash_output', label: 'npm test -- auth' }),
    pin({ itemId: 'short', label: 'a.ts', path: '/r/a.ts' }),
    pin({ itemId: 'tiny', kind: 'bash_output', label: 'ls' }),
    pin({ itemId: 'absent', label: 'src/unrelated.ts', path: '/r/src/unrelated.ts' }),
  ];

  it('matches path, file name and label case-insensitively', () => {
    const summary =
      'We fixed SRC/AUTH/MIDDLEWARE.TS and looked at Session.ts. Ran NPM TEST -- AUTH. Also data.ts and tools.';
    expect(mentionedPinIds(pins, summary)).toEqual(['path', 'base', 'cmd']);
  });

  it('matches Windows paths in the summary', () => {
    expect(mentionedPinIds(pins, 'Edited C:\\r\\src\\auth\\middleware.ts.')).toEqual(['path']);
  });

  it('ignores trivially short tokens and partial words', () => {
    expect(mentionedPinIds(pins, 'ls a.tsx metadata.ts')).toEqual([]);
    expect(mentionedPinIds(pins, 'see a.ts')).toEqual(['short']);
  });
});
