import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getArray, getNumber, getString, parseJson } from './json';
import { paths } from './paths';
import type { ServerInfo } from './protocol';
import type { Pin, RepackEntry } from './types';

/** Parsed contents of a JSON file, or undefined when it is missing or not JSON. */
export function readJsonFile(file: string): unknown {
  try {
    return parseJson(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Writes through a temp file and a rename, so readers never see a half-written file. A `mode`
 * marks the file private, and a folder it creates is private too.
 */
export function writeTextAtomic(file: string, text: string, mode?: number): void {
  const secret = mode !== undefined;
  mkdirSync(dirname(file), { recursive: true, ...(secret ? { mode: 0o700 } : {}) });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, text, secret ? { mode } : {});
  try {
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function writeJsonAtomic(file: string, data: unknown, mode = 0o600): void {
  writeTextAtomic(file, `${JSON.stringify(data, null, 2)}\n`, mode);
}

/** Port and token of the running app, or undefined when it has not been started. */
export function readServerInfo(): ServerInfo | undefined {
  const raw = readJsonFile(paths.serverInfo());
  const port = getNumber(raw, 'port');
  const token = getString(raw, 'token');
  const pid = getNumber(raw, 'pid');
  const startedAt = getNumber(raw, 'startedAt');
  if (port === undefined || token === undefined || pid === undefined || startedAt === undefined) {
    return undefined;
  }
  return { port, token, pid, startedAt };
}

/** Pins and repack entries share these two required fields, the rest is optional. */
function hasItemLabel(value: unknown): value is Pin & RepackEntry {
  return getString(value, 'itemId') !== undefined && getString(value, 'label') !== undefined;
}

function entriesIn(file: string, key: string): (Pin & RepackEntry)[] {
  return (getArray(readJsonFile(file), key) ?? []).filter(hasItemLabel);
}

/** Pins in Keep List order, highest priority first. */
export function readPins(sessionId: string): Pin[] {
  return entriesIn(paths.pins(sessionId), 'pins');
}

export function writePins(sessionId: string, pins: readonly Pin[]): void {
  writeJsonAtomic(paths.pins(sessionId), { v: 1, pins });
}

export function readRepack(sessionId: string): RepackEntry[] {
  return entriesIn(paths.repack(sessionId), 'entries');
}

export function writeRepack(sessionId: string, entries: readonly RepackEntry[]): void {
  writeJsonAtomic(paths.repack(sessionId), { v: 1, entries });
}

/**
 * Takes the whole repack queue exactly once. Renaming the file first means two concurrent
 * prompts cannot both inject it, and a crash after the rename loses the queue rather than
 * repeating it.
 */
export function claimRepack(sessionId: string): RepackEntry[] {
  const file = paths.repack(sessionId);
  const claimed = `${file}.${process.pid}.claimed`;
  try {
    renameSync(file, claimed);
  } catch {
    return [];
  }
  try {
    return entriesIn(claimed, 'entries');
  } finally {
    rmSync(claimed, { force: true });
  }
}
