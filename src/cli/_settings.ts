import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { getString, isObject, type JsonObject } from '../core/json';
import type { InstalledEntry, InstalledTarget } from './_installed';
import { samePath } from './_installed';

const HOOK_TIMEOUT_S = 5;

interface HookSpec {
  event: string;
  script: string;
  matcher?: string;
  /** Sync hooks can return context, everything else runs in the background. */
  sync?: true;
}

/** Events without matcher support get none. The rest match everything unless noted. */
export const HOOK_SPECS: readonly HookSpec[] = [
  { event: 'SessionStart', script: 'session-start.js', matcher: 'compact', sync: true },
  { event: 'SessionStart', script: 'session-start.js', matcher: 'startup|resume|clear|fork' },
  { event: 'UserPromptSubmit', script: 'user-prompt-submit.js', sync: true },
  { event: 'PostToolUse', script: 'post-tool-use.js', matcher: '*' },
  { event: 'PostToolUseFailure', script: 'post-tool-use-failure.js', matcher: '*' },
  { event: 'SubagentStart', script: 'subagent-start.js' },
  { event: 'SubagentStop', script: 'subagent-stop.js' },
  { event: 'InstructionsLoaded', script: 'instructions-loaded.js' },
  { event: 'Notification', script: 'notification.js' },
  { event: 'Stop', script: 'stop.js' },
  { event: 'PreCompact', script: 'pre-compact.js' },
  { event: 'PostCompact', script: 'post-compact.js' },
  { event: 'SessionEnd', script: 'session-end.js' },
];

const STATUSLINE_SCRIPT = 'statusline.js';

export const REQUIRED_SCRIPTS: readonly string[] = [
  ...new Set([...HOOK_SPECS.map(spec => spec.script), STATUSLINE_SCRIPT]),
];

function hookEntry(spec: HookSpec, script: string): JsonObject {
  return {
    type: 'command',
    command: 'node',
    args: [script],
    ...(spec.sync ? {} : { async: true }),
    timeout: HOOK_TIMEOUT_S,
  };
}

function isOurHook(hook: unknown, script: string): boolean {
  if (!isObject(hook) || getString(hook, 'command') !== 'node' || !Array.isArray(hook.args)) {
    return false;
  }
  const first: unknown = hook.args[0];
  return typeof first === 'string' && samePath(first, script);
}

function groupHas(group: unknown, matcher: string | undefined, script: string): boolean {
  if (!isObject(group) || getString(group, 'matcher') !== matcher) return false;
  return Array.isArray(group.hooks) && group.hooks.some(hook => isOurHook(hook, script));
}

function objectAt(parent: JsonObject, key: string): JsonObject | undefined {
  const value = parent[key];
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error(`"${key}" in settings is not an object.`);
  return value;
}

function arrayAt(parent: JsonObject, key: string): unknown[] | undefined {
  const value = parent[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`"hooks.${key}" is not a list.`);
  const list: unknown[] = value;
  return list;
}

export interface Merge {
  settings: JsonObject;
  target: InstalledTarget;
}

/**
 * Adds one group per hook spec unless an identical entry is already there, so a second run
 * changes nothing. New keys go at the end, which keeps the user's key order.
 */
export function addHooks(
  source: JsonObject,
  settingsPath: string,
  hooksDir: string,
  previous?: InstalledTarget,
): Merge {
  const settings = structuredClone(source);
  let hooks = objectAt(settings, 'hooks');
  const createdHooksKey = previous?.createdHooksKey ?? hooks === undefined;
  if (hooks === undefined) {
    hooks = {};
    settings.hooks = hooks;
  }
  const createdEvents = new Set(previous?.createdEvents ?? []);
  const entries: InstalledEntry[] = [];

  for (const spec of HOOK_SPECS) {
    const script = join(hooksDir, spec.script);
    let groups = arrayAt(hooks, spec.event);
    if (groups === undefined) {
      groups = [];
      hooks[spec.event] = groups;
      createdEvents.add(spec.event);
    }
    const matcher = spec.matcher === undefined ? {} : { matcher: spec.matcher };
    if (!groups.some(group => groupHas(group, spec.matcher, script))) {
      groups.push({ ...matcher, hooks: [hookEntry(spec, script)] });
    }
    entries.push({ event: spec.event, ...matcher, script });
  }

  return {
    settings,
    target: {
      settingsPath,
      entries,
      createdEvents: [...createdEvents],
      createdHooksKey,
      ...(previous?.statusLine === undefined ? {} : { statusLine: previous.statusLine }),
    },
  };
}

function quoteArg(value: string): string {
  if (process.platform === 'win32') return `"${value.replace(/\\/g, '/')}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Status lines run as a shell string, so both paths are quoted for the platform's shell. */
export function statusLineCommand(hooksDir: string, settingsPath: string): string {
  return `node ${quoteArg(join(hooksDir, STATUSLINE_SCRIPT))} ${quoteArg(settingsPath)}`;
}

/** Points statusLine at the wrapper and remembers any existing one so it keeps running. */
export function wrapStatusLine(merge: Merge, hooksDir: string): Merge {
  const settings = structuredClone(merge.settings);
  const current = settings.statusLine;
  const known = merge.target.statusLine;
  if (known !== undefined && isDeepStrictEqual(current, known.ours)) return merge;

  const padding =
    isObject(current) && typeof current.padding === 'number' ? current.padding : undefined;
  const ours: JsonObject = {
    type: 'command',
    command: statusLineCommand(hooksDir, merge.target.settingsPath),
    ...(padding === undefined ? {} : { padding }),
  };
  settings.statusLine = ours;
  const original = isObject(current) ? current : undefined;
  return {
    settings,
    target: { ...merge.target, statusLine: original === undefined ? { ours } : { ours, original } },
  };
}

export interface Removal {
  settings: JsonObject;
  warnings: string[];
}

function withoutOurs(group: unknown, entries: readonly InstalledEntry[]): unknown {
  if (!isObject(group) || !Array.isArray(group.hooks)) return group;
  const matcher = getString(group, 'matcher');
  const mine = entries.filter(entry => entry.matcher === matcher);
  const kept = group.hooks.filter(hook => !mine.some(entry => isOurHook(hook, entry.script)));
  if (kept.length === group.hooks.length) return group;
  return kept.length === 0 ? undefined : { ...group, hooks: kept };
}

function removeFromEvent(hooks: JsonObject, event: string, target: InstalledTarget): void {
  const groups = hooks[event];
  if (!Array.isArray(groups)) return;
  const entries = target.entries.filter(entry => entry.event === event);
  const kept = groups
    .map(group => withoutOurs(group, entries))
    .filter(group => group !== undefined);
  if (kept.length === 0 && target.createdEvents.includes(event)) {
    Reflect.deleteProperty(hooks, event);
    return;
  }
  hooks[event] = kept;
}

function restoreStatusLine(
  settings: JsonObject,
  target: InstalledTarget,
  warnings: string[],
): void {
  const record = target.statusLine;
  if (record === undefined) return;
  if (!isDeepStrictEqual(settings.statusLine, record.ours)) {
    warnings.push('the status line was changed after install, so it was left as it is.');
    return;
  }
  if (record.original === undefined) delete settings.statusLine;
  else settings.statusLine = record.original;
}

/** Removes exactly what install recorded, plus the containers it created once they are empty. */
export function removeHooks(source: JsonObject, target: InstalledTarget): Removal {
  const settings = structuredClone(source);
  const warnings: string[] = [];
  const hooks = settings.hooks;
  if (isObject(hooks)) {
    for (const event of new Set(target.entries.map(entry => entry.event))) {
      removeFromEvent(hooks, event, target);
    }
    if (Object.keys(hooks).length === 0 && target.createdHooksKey) delete settings.hooks;
  }
  restoreStatusLine(settings, target, warnings);
  return { settings, warnings };
}

/** Entries install recorded that are no longer in the settings file. */
export function missingEntries(settings: JsonObject, target: InstalledTarget): InstalledEntry[] {
  const hooks = settings.hooks;
  return target.entries.filter(entry => {
    const groups = isObject(hooks) ? hooks[entry.event] : undefined;
    return (
      !Array.isArray(groups) || !groups.some(group => groupHas(group, entry.matcher, entry.script))
    );
  });
}

/** Serializes in the file's own indent and line endings so the diff shows only real changes. */
export function formatSettings(settings: JsonObject, originalText?: string): string {
  const indent = /^([ \t]+)"/m.exec(originalText ?? '')?.[1] ?? '  ';
  const text = `${JSON.stringify(settings, null, indent)}\n`;
  return originalText?.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text;
}
