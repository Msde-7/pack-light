import type { SortMode } from './inventory-model';
import type { AppState, Store } from './store';

export type MotionPref = 'system' | 'reduce' | 'full';

export interface Prefs {
  bare: boolean;
  motion: MotionPref;
  sort: SortMode;
  dismissedTips: string[];
}

const KEY = 'packlight.prefs';
/** Tip ids are per epoch, so old ones pile up. Keep the newest few hundred. */
const MAX_DISMISSED = 300;

export const DEFAULT_PREFS: Prefs = {
  bare: false,
  motion: 'system',
  sort: 'weight',
  dismissedTips: [],
};

export function isMotion(value: unknown): value is MotionPref {
  return value === 'system' || value === 'reduce' || value === 'full';
}

export function isSort(value: unknown): value is SortMode {
  return value === 'weight' || value === 'recent' || value === 'kind';
}

export function parsePrefs(raw: string | null): Prefs {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? '');
  } catch {
    return DEFAULT_PREFS;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFS;
  const record: Record<string, unknown> = { ...value };
  return {
    bare: typeof record.bare === 'boolean' ? record.bare : DEFAULT_PREFS.bare,
    motion: isMotion(record.motion) ? record.motion : DEFAULT_PREFS.motion,
    sort: isSort(record.sort) ? record.sort : DEFAULT_PREFS.sort,
    dismissedTips: Array.isArray(record.dismissedTips)
      ? record.dismissedTips.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

export function loadPrefs(): Prefs {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Saves the prefs whenever one of them changes. */
export function persistPrefs(store: Store<AppState>): void {
  store.subscribe((state, previous) => {
    const { bare, motion, sort, dismissedTips } = state;
    const changed =
      bare !== previous.bare ||
      motion !== previous.motion ||
      sort !== previous.sort ||
      dismissedTips !== previous.dismissedTips;
    if (!changed) return;
    const prefs: Prefs = { bare, motion, sort, dismissedTips: dismissedTips.slice(-MAX_DISMISSED) };
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // Private windows and blocked storage just lose the prefs on reload.
    }
  });
}
