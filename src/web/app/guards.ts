import type { ExcerptResponse, SceneCue, ServerMessage } from '../../core/protocol';
import type { Compaction, Companion, Item, Pin, SessionState, TrailTip } from '../../core/types';
import { BARE_TIP_TEXT, KIND_LABEL, PHASE_LABEL, SOURCE_LABEL, STATUS_LABEL } from './format';
import { WEIGHT_ORDER } from './inventory-model';

type Check = (value: unknown) => boolean;
type Guard<T> = (value: unknown) => value is T;

const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStr = (value: unknown): value is string => typeof value === 'string';
const isNum = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isBool = (value: unknown): value is boolean => typeof value === 'boolean';
const opt =
  (check: Check): Check =>
  value =>
    value === undefined || check(value);
const oneOf =
  (values: readonly unknown[]): Check =>
  value =>
    values.includes(value);
/** The label tables are typed over every member of a union, so their keys list its values. */
const keyOf = (record: object): Check => oneOf(Object.keys(record));

function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(guard);
}

/** Needs a check for every field of T, so a new field fails to compile until it is checked. */
function shape<T>(fields: { [K in keyof T]-?: Check }): Guard<T> {
  const checks: [string, Check][] = Object.entries(fields);
  return (value): value is T => isObj(value) && checks.every(([key, check]) => check(value[key]));
}

/** A tagged union, checked by the variant its tag names. */
function union<T extends Record<D, string>, D extends string>(
  tag: D,
  variants: Record<T[D], Check>,
): Guard<T> {
  const byTag = new Map<unknown, Check>(Object.entries<Check>(variants));
  return (value): value is T => isObj(value) && (byTag.get(value[tag])?.(value) ?? false);
}

const isStrArray = arrayOf(isStr);

export const isItem = shape<Item>({
  id: isStr,
  sessionId: isStr,
  agentId: opt(isStr),
  kind: keyOf(KIND_LABEL),
  label: isStr,
  path: opt(isStr),
  range: opt(isStr),
  tokensEst: isNum,
  weight: keyOf(WEIGHT_ORDER),
  turn: isNum,
  addedAt: isNum,
  epoch: isNum,
  status: keyOf(STATUS_LABEL),
  failed: opt(isBool),
  duplicateOf: opt(isStr),
  note: opt(isStr),
  pinnedSnippet: opt(isStr),
  mentionedInSummary: opt(isBool),
  stale: opt(isBool),
});

const isCompanion = shape<Companion>({
  agentId: isStr,
  agentType: isStr,
  description: opt(isStr),
  status: oneOf(['active', 'returned']),
  items: isStrArray,
  reportTokens: opt(isNum),
  contextTokens: opt(isNum),
  hat: isNum,
});

const isCompaction = shape<Compaction>({
  at: isNum,
  trigger: oneOf(['manual', 'auto']),
  before: isNum,
  after: opt(isNum),
  droppedIds: isStrArray,
});

const isPin = shape<Pin>({
  itemId: isStr,
  kind: keyOf(KIND_LABEL),
  label: isStr,
  path: opt(isStr),
  range: opt(isStr),
  note: opt(isStr),
  snippet: opt(isStr),
  pinnedAt: isNum,
});

const isTip = shape<TrailTip>({
  id: isStr,
  kind: keyOf(BARE_TIP_TEXT),
  text: isStr,
  itemIds: isStrArray,
  wastedTokens: opt(isNum),
});

export const isSessionState = shape<SessionState>({
  sessionId: isStr,
  cwd: isStr,
  transcriptPath: isStr,
  title: isStr,
  model: opt(isStr),
  windowTokens: isNum,
  compactAtTokens: isNum,
  contextTokens: isNum,
  contextSource: keyOf(SOURCE_LABEL),
  fill: isNum,
  windowFill: isNum,
  phase: keyOf(PHASE_LABEL),
  turn: isNum,
  epoch: isNum,
  lastToolAt: opt(isNum),
  startedAt: isNum,
  updatedAt: isNum,
  items: arrayOf(isItem),
  subagents: value => isObj(value) && Object.values(value).every(isCompanion),
  compactions: arrayOf(isCompaction),
  pins: arrayOf(isPin),
  tips: arrayOf(isTip),
});

export const isSessionList = arrayOf(isSessionState);

const isCue = union<SceneCue, 'cue'>('cue', {
  item_added: shape({ itemId: isStr, duplicate: isBool }),
  camp: shape({ compactionIndex: isNum }),
  repacked: shape({ itemIds: isStrArray }),
  pinned: shape({ itemId: isStr }),
  cheer: isObj,
  companion_joined: shape({ agentId: isStr }),
  companion_returned: shape({ agentId: isStr }),
});

export const isServerMessage = union<ServerMessage, 'type'>('type', {
  snapshot: shape({ sessions: isSessionList }),
  session: shape({ session: isSessionState }),
  removed: shape({ sessionId: isStr }),
  cue: shape({ sessionId: isStr, cue: isCue }),
});

export const isExcerpt = shape<ExcerptResponse>({
  path: isStr,
  start: isNum,
  end: isNum,
  totalLines: isNum,
  text: isStr,
});
