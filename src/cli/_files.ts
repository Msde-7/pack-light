import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isObject, parseJson, type JsonObject } from '../core/json';
import { paths } from '../core/paths';

export interface SettingsFile {
  path: string;
  /** Undefined when the file does not exist yet. */
  text?: string;
  settings: JsonObject;
}

/** Reads a Claude Code settings file. Throws a friendly error when it is not a JSON object. */
export function readSettings(path: string): SettingsFile {
  if (!existsSync(path)) return { path, settings: {} };
  const text = readFileSync(path, 'utf8');
  const settings = parseJson(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (!isObject(settings)) {
    throw new Error(`${path} is not valid JSON, so it was left untouched. Fix it and try again.`);
  }
  return { path, text, settings };
}

/** Copies the file into the backups folder and returns the copy's path. */
export function backupFile(file: string, label: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(paths.backups(), `${label}-${stamp}-${basename(file)}`);
  mkdirSync(paths.backups(), { recursive: true, mode: 0o700 });
  copyFileSync(file, target);
  return target;
}
