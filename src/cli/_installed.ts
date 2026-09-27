import { rmSync } from 'node:fs';
import {
  getArray,
  getObject,
  getString,
  isObject,
  stringArray,
  type JsonObject,
} from '../core/json';
import { paths } from '../core/paths';
import { readJsonFile, writeJsonAtomic } from '../core/store';

/** One hook entry the installer added, identified by event, matcher and script. */
export interface InstalledEntry {
  event: string;
  matcher?: string;
  script: string;
}

interface InstalledStatusLine {
  /** The statusLine value the installer wrote. */
  ours: JsonObject;
  /** The statusLine that was there before, restored on uninstall. */
  original?: JsonObject;
}

/** Everything the installer changed in one settings file. */
export interface InstalledTarget {
  settingsPath: string;
  entries: InstalledEntry[];
  /** Event arrays the installer created, removed again once empty. */
  createdEvents: string[];
  createdHooksKey: boolean;
  statusLine?: InstalledStatusLine;
}

export interface Installed {
  v: 1;
  hooksDir: string;
  targets: InstalledTarget[];
}

function entryOf(value: unknown): InstalledEntry | undefined {
  const event = getString(value, 'event');
  const script = getString(value, 'script');
  if (event === undefined || script === undefined) return undefined;
  const matcher = getString(value, 'matcher');
  return matcher === undefined ? { event, script } : { event, matcher, script };
}

function statusLineOf(value: JsonObject | undefined): InstalledStatusLine | undefined {
  const ours = getObject(value, 'ours');
  if (ours === undefined) return undefined;
  const original = getObject(value, 'original');
  return original === undefined ? { ours } : { ours, original };
}

function targetOf(value: unknown): InstalledTarget | undefined {
  const settingsPath = getString(value, 'settingsPath');
  if (!isObject(value) || settingsPath === undefined) return undefined;
  const statusLine = statusLineOf(getObject(value, 'statusLine'));
  return {
    settingsPath,
    entries: (getArray(value, 'entries') ?? []).flatMap(entry => entryOf(entry) ?? []),
    createdEvents: stringArray(value.createdEvents),
    createdHooksKey: value.createdHooksKey === true,
    ...(statusLine === undefined ? {} : { statusLine }),
  };
}

export function readInstalled(): Installed | undefined {
  const data = readJsonFile(paths.installed());
  const hooksDir = getString(data, 'hooksDir');
  if (hooksDir === undefined) return undefined;
  const targets = (getArray(data, 'targets') ?? []).flatMap(target => targetOf(target) ?? []);
  return { v: 1, hooksDir, targets };
}

export function writeInstalled(installed: Installed): void {
  writeJsonAtomic(paths.installed(), installed);
}

export function removeInstalled(): void {
  rmSync(paths.installed(), { force: true });
}

/** Settings paths compare case-insensitively on Windows and regardless of slash direction. */
export function samePath(a: string, b: string): boolean {
  const norm = (path: string): string => {
    const slashed = path.replace(/\\/g, '/');
    return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
  };
  return norm(a) === norm(b);
}

export function findTarget(
  installed: Installed | undefined,
  settingsPath: string,
): InstalledTarget | undefined {
  return installed?.targets.find(target => samePath(target.settingsPath, settingsPath));
}
