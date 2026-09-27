import { readFileSync } from 'node:fs';
import { compactNumber, formatTokens, percent, plural } from '../core/format';
import { paths } from '../core/paths';
import { inPack } from '../core/insights';
import { applyFacts, applyPins, createSession } from '../core/session';
import { readPins } from '../core/store';
import { parseTranscript } from '../core/transcript';
import type { Item, SessionState } from '../core/types';
import type { WindowSettings } from '../core/window';
import { findRecentTranscripts } from '../server/discover';
import { loadWindowSettings } from '../server/load-settings';
import { fetchSessions } from './_server';

const RECENT_MS = 2 * 60 * 60_000;
const MAX_SESSIONS = 8;
const TOP_ITEMS = 5;
const LABEL_WIDTH = 48;

const PHASE_WORDS: Record<SessionState['phase'], string> = {
  walking: 'walking',
  waiting_for_user: 'waiting for you',
  idle: 'resting',
  camping: 'camping',
  done: 'done',
};

function heaviest(state: SessionState): Item[] {
  return state.items
    .filter(inPack)
    .sort((a, b) => b.tokensEst - a.tokensEst)
    .slice(0, TOP_ITEMS);
}

function clip(text: string): string {
  return text.length > LABEL_WIDTH ? `${text.slice(0, LABEL_WIDTH - 1)}…` : text;
}

export function describeSession(state: SessionState): string {
  const lines = [
    `● ${state.title}  ${PHASE_WORDS[state.phase]}`,
    `  ${percent(state.fill)} to camp · ${percent(state.windowFill)} of window · ${formatTokens(state.contextTokens)} / ${compactNumber(state.windowTokens)} · ${state.model ?? 'model unknown'}`,
  ];
  const top = heaviest(state);
  if (top.length > 0) {
    lines.push('  Heaviest');
    top.forEach((item, i) => {
      lines.push(
        `    ${i + 1}. ${clip(item.label).padEnd(LABEL_WIDTH)}  ${formatTokens(item.tokensEst)}`,
      );
    });
  }
  const pins = state.pins.length;
  lines.push(`  ${pins === 0 ? 'No pins yet' : plural(pins, 'pin')}`);
  return lines.join('\n');
}

/** Builds a session straight from its transcript when no server is running. */
export function sessionFromTranscript(
  sessionId: string,
  transcriptPath: string,
  settings: WindowSettings,
  now: number,
): SessionState | undefined {
  let text: string;
  try {
    text = readFileSync(transcriptPath, 'utf8');
  } catch {
    return undefined;
  }
  const fresh = createSession({ sessionId, transcriptPath, at: now }, settings);
  const built = applyFacts(fresh, parseTranscript(text), now).model;
  return applyPins(built, readPins(sessionId), now).model.state;
}

function fromDisk(now: number): SessionState[] {
  const settings = loadWindowSettings();
  return findRecentTranscripts(paths.projects(), now - RECENT_MS)
    .slice(0, MAX_SESSIONS)
    .flatMap(found => sessionFromTranscript(found.sessionId, found.path, settings, now) ?? []);
}

export async function run(_args: readonly string[]): Promise<number> {
  const now = Date.now();
  const live = await fetchSessions();
  const newestFirst = live ? [...live].sort((a, b) => b.updatedAt - a.updatedAt) : fromDisk(now);
  const sessions = newestFirst
    .filter(state => state.items.length > 0 || state.contextTokens > 0)
    .slice(0, MAX_SESSIONS);
  if (sessions.length === 0) {
    console.log('No Claude Code sessions in the last 2 hours.');
    return 0;
  }
  const source = live ? 'from the running app' : 'read from transcripts';
  console.log(`${plural(sessions.length, 'session')}, ${source}\n`);
  console.log(sessions.map(describeSession).join('\n\n'));
  return 0;
}
