import { readdirSync, rmSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { plural } from '../core/format';
import { paths } from '../core/paths';
import { readPins } from '../core/store';
import type { Pin } from '../core/types';
import type { Approver } from './_prompt';
import { approver } from './_prompt';
import { callServer } from './_server';

const USAGE = 'Usage  packlight pins list|clear [--session ID] [--yes]';

interface SessionPins {
  sessionId: string;
  pins: Pin[];
}

function sessionIds(): string[] {
  try {
    return readdirSync(paths.sessions(), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

function pinnedSessions(only?: string): SessionPins[] {
  const ids = only === undefined ? sessionIds() : [only];
  return ids
    .map(sessionId => ({ sessionId, pins: readPins(sessionId) }))
    .filter(session => session.pins.length > 0);
}

function formatPin(pin: Pin): string {
  const note = pin.note === undefined || pin.note === '' ? '' : `  (${pin.note})`;
  const snippet = pin.snippet === undefined ? '' : '  [excerpt]';
  return `  ★ ${pin.label}${note}${snippet}`;
}

export function listPins(only?: string): number {
  const sessions = pinnedSessions(only);
  if (sessions.length === 0) {
    console.log('No pins yet.');
    return 0;
  }
  for (const session of sessions) {
    console.log(`Session ${session.sessionId}, ${plural(session.pins.length, 'pin')}`);
    session.pins.forEach(pin => {
      console.log(formatPin(pin));
    });
  }
  return 0;
}

/** A running app keeps pins in memory and would write them back, so it is told first. */
async function unpinOnServer(session: SessionPins): Promise<void> {
  for (const pin of session.pins) {
    const id = encodeURIComponent(session.sessionId);
    await callServer('DELETE', `/api/sessions/${id}/pins/${encodeURIComponent(pin.itemId)}`);
  }
}

export async function clearPins(only: string | undefined, approve: Approver): Promise<number> {
  const sessions = pinnedSessions(only);
  const count = sessions.reduce((sum, session) => sum + session.pins.length, 0);
  if (count === 0) {
    console.log('No pins to clear.');
    return 0;
  }
  const question = `Clear ${plural(count, 'pin')} across ${plural(sessions.length, 'session')}?`;
  if (only === undefined && !(await approve(question))) {
    console.log('Nothing was changed.');
    return 1;
  }
  for (const session of sessions) {
    await unpinOnServer(session);
    rmSync(paths.pins(session.sessionId), { force: true });
  }
  console.log(`Cleared ${plural(count, 'pin')}.`);
  return 0;
}

export async function run(args: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      session: { type: 'string' },
      yes: { type: 'boolean', short: 'y', default: false },
    },
  });
  const [action] = positionals;
  if (action === 'list') return listPins(values.session);
  if (action === 'clear') {
    return clearPins(values.session, approver(values.yes, 'packlight pins clear --yes'));
  }
  console.error(USAGE);
  return 1;
}
