import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lineDiff } from './_diff';
import type { JsonObject as Json } from '../core/json';
import {
  HOOK_SPECS,
  addHooks,
  formatSettings,
  missingEntries,
  removeHooks,
  statusLineCommand,
  wrapStatusLine,
} from './_settings';

const HOOKS_DIR = join('/', 'home', 'u', '.pack-light', 'hooks');
const SETTINGS = join('/', 'home', 'u', '.claude', 'settings.json');

const userHook = { type: 'command', command: 'echo hi' };

function userSettings(): Json {
  return {
    model: 'opus',
    hooks: {
      PostToolUse: [{ matcher: 'Bash', hooks: [userHook] }],
      Stop: [{ hooks: [userHook] }],
    },
    permissions: { allow: ['Read'] },
  };
}

function groupsOf(settings: Json, event: string): Json[] {
  const hooks = settings.hooks as Record<string, Json[]>;
  return hooks[event] ?? [];
}

describe('addHooks', () => {
  it('adds one group per hook with exec form entries', () => {
    const { settings, target } = addHooks({}, SETTINGS, HOOKS_DIR);
    const sessionStart = groupsOf(settings, 'SessionStart');
    expect(sessionStart).toEqual([
      {
        matcher: 'compact',
        hooks: [
          {
            type: 'command',
            command: 'node',
            args: [join(HOOKS_DIR, 'session-start.js')],
            timeout: 5,
          },
        ],
      },
      {
        matcher: 'startup|resume|clear|fork',
        hooks: [
          {
            type: 'command',
            command: 'node',
            args: [join(HOOKS_DIR, 'session-start.js')],
            async: true,
            timeout: 5,
          },
        ],
      },
    ]);
    expect(groupsOf(settings, 'UserPromptSubmit')[0]).toEqual({
      hooks: [expect.not.objectContaining({ async: true })],
    });
    expect(groupsOf(settings, 'PreCompact')[0]).toEqual({
      hooks: [expect.objectContaining({ async: true, timeout: 5 })],
    });
    expect(target.entries).toHaveLength(HOOK_SPECS.length);
    expect(target.createdHooksKey).toBe(true);
  });

  it('keeps user hooks, other settings and key order', () => {
    const { settings, target } = addHooks(userSettings(), SETTINGS, HOOKS_DIR);
    expect(Object.keys(settings)).toEqual(['model', 'hooks', 'permissions']);
    expect(groupsOf(settings, 'PostToolUse')[0]).toEqual({ matcher: 'Bash', hooks: [userHook] });
    expect(groupsOf(settings, 'PostToolUse')).toHaveLength(2);
    expect(Object.keys(settings.hooks as Json).slice(0, 2)).toEqual(['PostToolUse', 'Stop']);
    expect(target.createdHooksKey).toBe(false);
    expect(target.createdEvents).not.toContain('PostToolUse');
    expect(target.createdEvents).toContain('SessionStart');
  });

  it('does not touch its input', () => {
    const input = userSettings();
    addHooks(input, SETTINGS, HOOKS_DIR);
    expect(input).toEqual(userSettings());
  });

  it('is idempotent', () => {
    const first = addHooks(userSettings(), SETTINGS, HOOKS_DIR);
    const second = addHooks(first.settings, SETTINGS, HOOKS_DIR, first.target);
    expect(second.settings).toEqual(first.settings);
    expect(second.target).toEqual(first.target);
  });
});

describe('removeHooks', () => {
  it('restores the original settings exactly', () => {
    const original = userSettings();
    const { settings, target } = addHooks(original, SETTINGS, HOOKS_DIR);
    expect(removeHooks(settings, target).settings).toEqual(original);
  });

  it('removes the hooks key it created', () => {
    const { settings, target } = addHooks({ model: 'opus' }, SETTINGS, HOOKS_DIR);
    expect(removeHooks(settings, target).settings).toEqual({ model: 'opus' });
  });

  it('keeps hooks the user added next to ours afterwards', () => {
    const { settings, target } = addHooks({}, SETTINGS, HOOKS_DIR);
    groupsOf(settings, 'Stop').push({ hooks: [userHook] });
    const [ourGroup] = groupsOf(settings, 'PreCompact');
    (ourGroup!.hooks as Json[]).push(userHook);
    const removed = removeHooks(settings, target).settings;
    expect(groupsOf(removed, 'Stop')).toEqual([{ hooks: [userHook] }]);
    expect(groupsOf(removed, 'PreCompact')).toEqual([{ hooks: [userHook] }]);
    expect(Object.keys(removed.hooks as Json)).toEqual(['Stop', 'PreCompact']);
  });

  it('is idempotent', () => {
    const { settings, target } = addHooks(userSettings(), SETTINGS, HOOKS_DIR);
    const once = removeHooks(settings, target).settings;
    expect(removeHooks(once, target).settings).toEqual(once);
  });
});

describe('missingEntries', () => {
  it('reports entries removed by hand', () => {
    const { settings, target } = addHooks({}, SETTINGS, HOOKS_DIR);
    expect(missingEntries(settings, target)).toEqual([]);
    delete (settings.hooks as Json).Stop;
    expect(missingEntries(settings, target).map(entry => entry.event)).toEqual(['Stop']);
  });
});

describe('status line', () => {
  it('wraps an existing status line and restores it', () => {
    const original = {
      ...userSettings(),
      statusLine: { type: 'command', command: 'my-line', padding: 1 },
    };
    const merge = wrapStatusLine(addHooks(original, SETTINGS, HOOKS_DIR), HOOKS_DIR);
    expect(merge.settings.statusLine).toEqual({
      type: 'command',
      command: statusLineCommand(HOOKS_DIR, SETTINGS),
      padding: 1,
    });
    expect(merge.target.statusLine?.original).toEqual(original.statusLine);
    expect(removeHooks(merge.settings, merge.target).settings).toEqual(original);
  });

  it('adds and removes a status line when there was none', () => {
    const merge = wrapStatusLine(addHooks({}, SETTINGS, HOOKS_DIR), HOOKS_DIR);
    expect(merge.target.statusLine?.original).toBeUndefined();
    expect(removeHooks(merge.settings, merge.target).settings).toEqual({});
  });

  it('keeps the original on a second run', () => {
    const original = { statusLine: { type: 'command', command: 'my-line' } };
    const first = wrapStatusLine(addHooks(original, SETTINGS, HOOKS_DIR), HOOKS_DIR);
    const second = wrapStatusLine(
      addHooks(first.settings, SETTINGS, HOOKS_DIR, first.target),
      HOOKS_DIR,
    );
    expect(second.settings).toEqual(first.settings);
    expect(second.target.statusLine?.original).toEqual(original.statusLine);
  });

  it('leaves a status line the user changed after install', () => {
    const merge = wrapStatusLine(addHooks({}, SETTINGS, HOOKS_DIR), HOOKS_DIR);
    merge.settings.statusLine = { type: 'command', command: 'theirs' };
    const removal = removeHooks(merge.settings, merge.target);
    expect(removal.settings.statusLine).toEqual({ type: 'command', command: 'theirs' });
    expect(removal.warnings).toHaveLength(1);
  });

  it('passes the settings path so the wrapper finds its original', () => {
    const command = statusLineCommand(HOOKS_DIR, SETTINGS);
    expect(command.startsWith('node ')).toBe(true);
    expect(command).toContain('statusline.js');
    expect(command).toContain('settings.json');
  });
});

describe('formatSettings', () => {
  it('keeps the file indent and line endings', () => {
    const text = '{\r\n    "a": 1\r\n}\r\n';
    expect(formatSettings({ a: 1 }, text)).toBe(text);
    expect(formatSettings({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});

describe('lineDiff', () => {
  it('shows changed lines with a little context', () => {
    const before = ['{', '"a": 1,', '"b": 2,', '"c": 3,', '"d": 4,', '"e": 5,', '"f": 6', '}'].join(
      '\n',
    );
    const after = before.replace('"e": 5', '"e": 50');
    expect(lineDiff(before, after)).toBe(
      ['  …', '  "c": 3,', '  "d": 4,', '- "e": 5,', '+ "e": 50,', '  "f": 6', '  }'].join('\n'),
    );
  });

  it('is empty when nothing changed', () => {
    expect(lineDiff('a\nb\n', 'a\r\nb\r\n')).toBe('');
  });
});
