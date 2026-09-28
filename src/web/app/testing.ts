import type { Item, SessionState } from '../../core/types';
import { DEFAULT_PREFS } from './prefs';
import type { AppState } from './store';

/** Synthetic builders for tests. Never real transcript data. */
export function makeItem(overrides: Partial<Item> & { id: string }): Item {
  return {
    sessionId: 's1',
    kind: 'file_read',
    label: `src/${overrides.id}.ts`,
    path: `/repo/src/${overrides.id}.ts`,
    tokensEst: 100,
    weight: 'pebble',
    turn: 1,
    addedAt: 1000,
    epoch: 0,
    status: 'carried',
    ...overrides,
  };
}

export function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 's1',
    cwd: '/repo',
    transcriptPath: '/home/me/.claude/projects/repo/s1.jsonl',
    title: 'repo',
    model: 'claude-test',
    windowTokens: 1_000_000,
    compactAtTokens: 967_000,
    contextTokens: 142_000,
    contextSource: 'transcript',
    fill: 0.147,
    windowFill: 0.142,
    phase: 'walking',
    turn: 5,
    epoch: 0,
    startedAt: 1,
    updatedAt: 2,
    items: [],
    subagents: {},
    compactions: [],
    pins: [],
    tips: [],
    ...overrides,
  };
}

export function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    ...DEFAULT_PREFS,
    connection: 'live',
    sessions: [],
    agent: undefined,
    highlightIds: [],
    lostSelection: [],
    ...overrides,
  };
}
