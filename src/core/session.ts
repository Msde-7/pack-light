import { displayPath, tokensFromChars, weightOf } from './estimate';
import { baseName, normalizePath, stableItemId } from './ids';
import { analyze } from './insights';
import type { CompactTrigger, HookEvent, SceneCue, ToolSummary } from './protocol';
import type { TranscriptFact, SubagentLaunch } from './transcript';
import type {
  Companion,
  Item,
  ItemKind,
  Pin,
  RepackEntry,
  SessionPhase,
  SessionState,
} from './types';
import { resolveWindow, type WindowSettings } from './window';

/** Status before pins and the repack queue are laid on top. */
type BaseStatus = 'carried' | 'dropped' | 'sewn_in' | 'repacked';

interface ItemMeta {
  base: BaseStatus;
  /** Transcript record holding the item's content, checked against preserved messages. */
  uuid?: string;
  toolTokens: number;
  reportTokens: number;
  /** Sizes from the transcript are exact and beat hook estimates. */
  exact: boolean;
  reportExact: boolean;
}

interface PendingCompact {
  at: number;
  trigger: CompactTrigger;
  mentionedPinIds: string[];
}

interface CompactionMeta {
  source: 'boundary' | 'hook';
  hookMatched: boolean;
}

interface TranscriptPrompt {
  at: number;
  turn: number;
  claimed: boolean;
}

/** SessionState plus the bookkeeping the reducer needs. Plain data, safe to structuredClone. */
export interface SessionModel {
  state: SessionState;
  settings: WindowSettings;
  meta: Record<string, ItemMeta>;
  index: Record<string, number>;
  firstReads: Record<string, string>;
  statusLineWindow?: number;
  lastStatusLineAt: number;
  /** First usage of the session, roughly the system prompt and tools that return after compaction. */
  baselineTokens?: number;
  transcriptPrompts: number;
  lastTranscriptPrompt?: TranscriptPrompt;
  compactingSince?: number;
  campUntil: number;
  pendingCompact?: PendingCompact;
  compactionMeta: CompactionMeta[];
  waiting: boolean;
  ended: boolean;
  repackQueue: string[];
  /** agentId to the toolUseId of the Agent call that launched it. */
  agentToolUse: Record<string, string>;
}

export interface Update {
  model: SessionModel;
  cues: SceneCue[];
}

export interface SessionInit {
  sessionId: string;
  cwd?: string;
  transcriptPath?: string;
  at: number;
}

const WALK_MS = 4000;
const CAMP_MIN_MS = 3500;
/** How long a PostCompact hook waits for the transcript boundary before dropping blind. */
const BOUNDARY_WAIT_MS = 5000;
const HOOK_MATCH_MS = 180_000;
const PROMPT_MATCH_MS = 15_000;
const COMPACTING_MAX_MS = 10 * 60_000;
const HAT_COUNT = 6;
const WAITING_NOTIFICATIONS = new Set([
  'permission_prompt',
  'idle_prompt',
  'elicitation',
  'elicitation_dialog',
  'agent_needs_input',
]);

interface Ctx {
  m: SessionModel;
  cues: SceneCue[];
  now: number;
}

function titleOf(cwd: string, sessionId: string): string {
  return cwd === '' ? sessionId.slice(0, 8) : baseName(cwd) || cwd;
}

export function createSession(init: SessionInit, settings: WindowSettings): SessionModel {
  const cwd = init.cwd ?? '';
  const size = resolveWindow(undefined, settings);
  return {
    state: {
      sessionId: init.sessionId,
      cwd,
      transcriptPath: init.transcriptPath ?? '',
      title: titleOf(cwd, init.sessionId),
      windowTokens: size.windowTokens,
      compactAtTokens: size.compactAtTokens,
      contextTokens: 0,
      contextSource: 'estimate',
      fill: 0,
      windowFill: 0,
      phase: 'idle',
      turn: 0,
      epoch: 0,
      startedAt: init.at,
      updatedAt: init.at,
      items: [],
      subagents: {},
      compactions: [],
      pins: [],
      tips: [],
    },
    settings,
    meta: {},
    index: {},
    firstReads: {},
    lastStatusLineAt: 0,
    transcriptPrompts: 0,
    campUntil: 0,
    compactionMeta: [],
    waiting: false,
    ended: false,
    repackQueue: [],
    agentToolUse: {},
  };
}

// Items -----------------------------------------------------------------------------------

function itemById(ctx: Ctx, id: string): Item | undefined {
  const position = ctx.m.index[id];
  return position === undefined ? undefined : ctx.m.state.items[position];
}

function resize(ctx: Ctx, item: Item): void {
  const meta = ctx.m.meta[item.id];
  if (!meta) return;
  item.tokensEst = meta.toolTokens + meta.reportTokens;
  item.weight = weightOf(item.tokensEst, ctx.m.settings.config.weights);
}

interface NewItem {
  key: string;
  kind: ItemKind;
  label: string;
  path?: string;
  range?: string;
  tokens: number;
  at: number;
  base: BaseStatus;
  uuid?: string;
  exact: boolean;
  agentId?: string;
  failed?: boolean;
}

function duplicateKey(item: Item): string | undefined {
  if (item.kind !== 'file_read' || item.path === undefined) return undefined;
  return `${item.agentId ?? ''}|${item.epoch}|${normalizePath(item.path)}|${item.range ?? ''}`;
}

function markDuplicate(ctx: Ctx, item: Item): void {
  const key = duplicateKey(item);
  if (key === undefined) return;
  const first = ctx.m.firstReads[key];
  if (first === undefined) ctx.m.firstReads[key] = item.id;
  else item.duplicateOf = first;
}

function addItem(ctx: Ctx, spec: NewItem): Item {
  const { state } = ctx.m;
  const id = stableItemId(state.sessionId, spec.key);
  const item: Item = {
    id,
    sessionId: state.sessionId,
    kind: spec.kind,
    label: spec.label,
    tokensEst: 0,
    weight: 'pebble',
    turn: state.turn,
    addedAt: spec.at,
    epoch: state.epoch,
    status: spec.base,
    ...(spec.path === undefined ? {} : { path: spec.path }),
    ...(spec.range === undefined ? {} : { range: spec.range }),
    ...(spec.agentId === undefined ? {} : { agentId: spec.agentId }),
    ...(spec.failed === true ? { failed: true } : {}),
  };
  ctx.m.meta[id] = {
    base: spec.base,
    toolTokens: spec.tokens,
    reportTokens: 0,
    exact: spec.exact,
    reportExact: false,
    ...(spec.uuid === undefined || spec.uuid === '' ? {} : { uuid: spec.uuid }),
  };
  resize(ctx, item);
  markDuplicate(ctx, item);
  ctx.m.index[id] = state.items.length;
  state.items.push(item);
  if (spec.agentId !== undefined) {
    ensureCompanion(ctx, spec.agentId, undefined).items.push(id);
  }
  ctx.cues.push({ cue: 'item_added', itemId: id, duplicate: item.duplicateOf !== undefined });
  return item;
}

/** Updates the item under `key`, or creates it. */
function upsert(ctx: Ctx, spec: NewItem, update: (item: Item, meta: ItemMeta) => void): Item {
  const existing = itemById(ctx, stableItemId(ctx.m.state.sessionId, spec.key));
  if (!existing) return addItem(ctx, spec);
  const meta = ctx.m.meta[existing.id];
  if (meta) update(existing, meta);
  resize(ctx, existing);
  return existing;
}

// Companions ------------------------------------------------------------------------------

function ensureCompanion(ctx: Ctx, agentId: string, agentType: string | undefined): Companion {
  const { subagents } = ctx.m.state;
  const existing = subagents[agentId];
  if (existing) {
    if (agentType !== undefined && agentType !== '') existing.agentType = agentType;
    return existing;
  }
  const companion: Companion = {
    agentId,
    agentType: agentType === undefined || agentType === '' ? 'agent' : agentType,
    status: 'active',
    items: [],
    hat: Object.keys(subagents).length % HAT_COUNT,
  };
  subagents[agentId] = companion;
  ctx.cues.push({ cue: 'companion_joined', agentId });
  return companion;
}

function returnCompanion(ctx: Ctx, companion: Companion): void {
  if (companion.status === 'returned') return;
  companion.status = 'returned';
  ctx.cues.push({ cue: 'companion_returned', agentId: companion.agentId });
}

function agentForToolUse(ctx: Ctx, toolUseId: string): string | undefined {
  for (const [agentId, id] of Object.entries(ctx.m.agentToolUse)) {
    if (id === toolUseId) return agentId;
  }
  return undefined;
}

function noteLaunch(ctx: Ctx, tool: ToolSummary, launch: SubagentLaunch): void {
  if (launch.agentId === undefined) return;
  ctx.m.agentToolUse[launch.agentId] = tool.toolUseId;
  const companion = ensureCompanion(ctx, launch.agentId, launch.agentType);
  companion.description ??= tool.label;
  if (!launch.async) returnCompanion(ctx, companion);
}

// Tools and reports -----------------------------------------------------------------------

interface ToolSource {
  from: 'hook' | 'transcript';
  at: number;
  failed: boolean;
  uuid?: string;
  agentId?: string;
}

function applyTool(ctx: Ctx, tool: ToolSummary, source: ToolSource): Item {
  const spec: NewItem = {
    key: `tool:${tool.toolUseId}`,
    kind: tool.kind,
    label: tool.label,
    tokens: tool.tokens,
    at: source.at,
    base: 'carried',
    exact: source.from === 'transcript',
    failed: source.failed,
    ...(tool.path === undefined ? {} : { path: tool.path }),
    ...(tool.range === undefined ? {} : { range: tool.range }),
    ...(source.uuid === undefined ? {} : { uuid: source.uuid }),
    ...(source.agentId === undefined ? {} : { agentId: source.agentId }),
  };
  const item = upsert(ctx, spec, (existing, meta) => {
    if (source.failed) existing.failed = true;
    if (source.from === 'transcript') {
      meta.toolTokens = tool.tokens;
      meta.exact = true;
      if (source.uuid !== undefined && source.uuid !== '') meta.uuid = source.uuid;
    } else if (!meta.exact) {
      meta.toolTokens = tool.tokens;
    }
  });
  const last = ctx.m.state.lastToolAt;
  if (last === undefined || source.at > last) ctx.m.state.lastToolAt = source.at;
  return item;
}

function setReport(ctx: Ctx, item: Item, tokens: number, exact: boolean): void {
  const meta = ctx.m.meta[item.id];
  if (!meta || (meta.reportExact && !exact)) return;
  meta.reportTokens = tokens;
  meta.reportExact = exact;
  resize(ctx, item);
}

function applyReport(ctx: Ctx, fact: Extract<TranscriptFact, { fact: 'report' }>): void {
  const tokens = tokensFromChars(fact.chars);
  const { toolUseId } = fact;
  if (toolUseId === undefined) {
    addItem(ctx, {
      key: `notice:${fact.uuid}`,
      kind: 'other',
      label: 'task update',
      tokens,
      at: fact.at,
      base: 'carried',
      exact: true,
      uuid: fact.uuid,
    });
    return;
  }
  const toolItem = itemById(ctx, stableItemId(ctx.m.state.sessionId, `tool:${toolUseId}`));
  const item =
    toolItem ??
    addItem(ctx, {
      key: `report:${toolUseId}`,
      kind: 'subagent_report',
      label: 'subagent report',
      tokens: 0,
      at: fact.at,
      base: 'carried',
      exact: true,
      uuid: fact.uuid,
    });
  setReport(ctx, item, tokens, true);
  const agentId = agentForToolUse(ctx, toolUseId);
  const companion = agentId === undefined ? undefined : ctx.m.state.subagents[agentId];
  if (!companion) return;
  companion.reportTokens = tokens;
  returnCompanion(ctx, companion);
}

// Prompts ---------------------------------------------------------------------------------

function promptSpec(turn: number, chars: number, at: number, uuid?: string): NewItem {
  return {
    key: `prompt:${turn}`,
    kind: 'user_prompt',
    label: `prompt ${turn}`,
    tokens: tokensFromChars(chars),
    at,
    base: 'carried',
    exact: uuid !== undefined,
    ...(uuid === undefined ? {} : { uuid }),
  };
}

function transcriptPrompt(ctx: Ctx, fact: Extract<TranscriptFact, { fact: 'prompt' }>): void {
  const { m } = ctx;
  const count = ++m.transcriptPrompts;
  if (count > m.state.turn) m.state.turn = count;
  const spec = promptSpec(count, fact.chars, fact.at, fact.uuid);
  upsert(ctx, spec, (_item, meta) => {
    meta.toolTokens = spec.tokens;
    meta.exact = true;
    if (fact.uuid !== '') meta.uuid = fact.uuid;
  });
  const claimed = m.lastTranscriptPrompt?.turn === count && m.lastTranscriptPrompt.claimed;
  m.lastTranscriptPrompt = { at: fact.at, turn: count, claimed };
}

/** The hook usually beats the transcript, but when it does not, merge into the parsed prompt. */
function hookPrompt(ctx: Ctx, chars: number, at: number): void {
  const { m } = ctx;
  const last = m.lastTranscriptPrompt;
  if (
    last &&
    !last.claimed &&
    last.turn === m.state.turn &&
    Math.abs(at - last.at) < PROMPT_MATCH_MS
  ) {
    last.claimed = true;
    return;
  }
  m.state.turn += 1;
  m.lastTranscriptPrompt = { at, turn: m.state.turn, claimed: true };
  addItem(ctx, promptSpec(m.state.turn, chars, at));
}

// Sewn-in things --------------------------------------------------------------------------

function applyInstructions(ctx: Ctx, path: string, chars: number, at: number, exact: boolean) {
  const tokens = tokensFromChars(chars);
  const { state } = ctx.m;
  upsert(
    ctx,
    {
      key: `instructions:${normalizePath(path)}`,
      kind: 'instructions',
      label: displayPath(path, state.cwd),
      path,
      tokens,
      at,
      base: 'sewn_in',
      exact,
    },
    (item, meta) => {
      item.epoch = state.epoch;
      if (exact || !meta.exact) meta.toolTokens = tokens;
      meta.exact ||= exact;
    },
  );
}

interface SewnSpec {
  key: string;
  kind: ItemKind;
  label: string;
  chars: number;
  at: number;
  path?: string;
}

function sewnIn(ctx: Ctx, spec: SewnSpec): void {
  const { state } = ctx.m;
  const tokens = tokensFromChars(spec.chars);
  const item: NewItem = {
    key: spec.key,
    kind: spec.kind,
    label: spec.label,
    tokens,
    at: spec.at,
    base: 'sewn_in',
    exact: true,
    ...(spec.path === undefined ? {} : { path: spec.path }),
  };
  upsert(ctx, item, (existing, meta) => {
    existing.epoch = state.epoch;
    existing.turn = state.turn;
    meta.toolTokens = tokens;
    meta.base = 'sewn_in';
  });
}

function latestRead(ctx: Ctx, path: string): Item | undefined {
  const target = normalizePath(path);
  return ctx.m.state.items.findLast(
    item =>
      item.kind === 'file_read' &&
      item.agentId === undefined &&
      item.path !== undefined &&
      normalizePath(item.path) === target,
  );
}

/** A file Claude Code re-read after compaction. The last read of it survives, sewn in. */
function restoreFile(ctx: Ctx, path: string, chars: number, at: number): void {
  const { state } = ctx.m;
  const read = latestRead(ctx, path);
  const meta = read ? ctx.m.meta[read.id] : undefined;
  if (!read || !meta) {
    const key = `restored:${state.epoch}:${normalizePath(path)}`;
    sewnIn(ctx, { key, kind: 'file_read', label: displayPath(path, state.cwd), path, chars, at });
    return;
  }
  meta.base = 'sewn_in';
  meta.toolTokens = tokensFromChars(chars);
  meta.reportTokens = 0;
  read.epoch = state.epoch;
  delete read.duplicateOf;
  resize(ctx, read);
  const last = state.compactions[state.compactions.length - 1];
  if (last) last.droppedIds = last.droppedIds.filter(id => id !== read.id);
}

function applyAttached(ctx: Ctx, fact: Extract<TranscriptFact, { fact: 'attached' }>): void {
  const { state } = ctx.m;
  const { chars } = fact;
  if (fact.kind === 'skill') {
    const label = `skill ${fact.label}`;
    sewnIn(ctx, { key: `skill:${fact.label}`, kind: 'instructions', label, chars, at: fact.at });
    return;
  }
  const path = fact.path ?? fact.label;
  if (fact.kind === 'file_reference') {
    if (!fact.afterCompact) return;
    const key = `ref:${state.epoch}:${normalizePath(path)}`;
    const label = `${displayPath(path, state.cwd)} (name only)`;
    sewnIn(ctx, { key, kind: 'file_read', label, path, chars, at: fact.at });
    return;
  }
  if (fact.afterCompact) {
    restoreFile(ctx, path, fact.chars, fact.at);
    return;
  }
  addItem(ctx, {
    key: `attached:${fact.uuid}:${normalizePath(path)}`,
    kind: 'file_read',
    label: displayPath(path, state.cwd),
    path,
    tokens: tokensFromChars(chars),
    at: fact.at,
    base: 'carried',
    exact: true,
    uuid: fact.uuid,
  });
}

// Compaction ------------------------------------------------------------------------------

interface CompactOptions {
  at: number;
  trigger: CompactTrigger;
  before: number;
  preserved: ReadonlySet<string>;
  source: CompactionMeta['source'];
  hookMatched: boolean;
  mentionedPinIds?: readonly string[];
}

function applyMentions(ctx: Ctx, mentioned: readonly string[]): void {
  const said = new Set(mentioned);
  for (const pin of ctx.m.state.pins) {
    const item = itemById(ctx, pin.itemId);
    if (item) item.mentionedInSummary = said.has(pin.itemId);
  }
}

function isDropCandidate(ctx: Ctx, item: Item, opts: CompactOptions, pinned: Set<string>) {
  const meta = ctx.m.meta[item.id];
  if (!meta || item.agentId !== undefined) return false;
  if (meta.base !== 'carried' && meta.base !== 'repacked') return false;
  if (pinned.has(item.id)) return false;
  return meta.uuid === undefined || !opts.preserved.has(meta.uuid);
}

/** Dropped means before the boundary, not preserved, not pinned, not sewn in. */
function compact(ctx: Ctx, opts: CompactOptions): void {
  const { m } = ctx;
  const { state } = m;
  const epoch = state.epoch + 1;
  const pinned = new Set(state.pins.map(pin => pin.itemId));
  const droppedIds: string[] = [];
  for (const item of state.items) {
    if (item.addedAt > opts.at) {
      item.epoch = Math.max(item.epoch, epoch);
      continue;
    }
    if (!isDropCandidate(ctx, item, opts, pinned)) continue;
    const meta = m.meta[item.id];
    if (meta) meta.base = 'dropped';
    droppedIds.push(item.id);
  }
  state.epoch = epoch;
  state.compactions.push({ at: opts.at, trigger: opts.trigger, before: opts.before, droppedIds });
  m.compactionMeta.push({ source: opts.source, hookMatched: opts.hookMatched });
  delete m.compactingSince;
  m.campUntil = Math.max(m.campUntil, opts.at + CAMP_MIN_MS);
  if (opts.mentionedPinIds) applyMentions(ctx, opts.mentionedPinIds);
  ctx.cues.push({ cue: 'camp', compactionIndex: state.compactions.length - 1 });
}

/** A blind drop happened because the boundary was late, so put preserved items back now. */
function upgradeBlindCompaction(ctx: Ctx, fact: BoundaryFact): boolean {
  const { m } = ctx;
  const index = m.state.compactions.length - 1;
  const last = m.state.compactions[index];
  const meta = m.compactionMeta[index];
  if (!last || meta?.source !== 'hook' || Math.abs(fact.at - last.at) > HOOK_MATCH_MS) {
    return false;
  }
  meta.source = 'boundary';
  const preserved = new Set(fact.preservedUuids);
  last.droppedIds = last.droppedIds.filter(id => {
    const itemMeta = m.meta[id];
    if (itemMeta?.uuid === undefined || !preserved.has(itemMeta.uuid)) return true;
    itemMeta.base = 'carried';
    return false;
  });
  if (fact.preTokens !== undefined) last.before = fact.preTokens;
  return true;
}

type BoundaryFact = Extract<TranscriptFact, { fact: 'boundary' }>;

function applyBoundary(ctx: Ctx, fact: BoundaryFact): void {
  const { m } = ctx;
  if (upgradeBlindCompaction(ctx, fact)) return;
  const pending = m.pendingCompact;
  delete m.pendingCompact;
  compact(ctx, {
    at: fact.at,
    trigger: fact.trigger,
    before: fact.preTokens ?? m.state.contextTokens,
    preserved: new Set(fact.preservedUuids),
    source: 'boundary',
    hookMatched: pending !== undefined,
    ...(pending ? { mentionedPinIds: pending.mentionedPinIds } : {}),
  });
  // postTokens leaves out the system prompt and tools, so add the session's opening size back.
  if (fact.postTokens !== undefined && fact.at > m.lastStatusLineAt) {
    m.state.contextTokens = (m.baselineTokens ?? 0) + fact.postTokens;
    m.state.contextSource = 'estimate';
  }
}

function postCompact(ctx: Ctx, trigger: CompactTrigger, mentioned: string[], at: number): void {
  const { m } = ctx;
  const index = m.state.compactions.length - 1;
  const last = m.state.compactions[index];
  const meta = m.compactionMeta[index];
  if (last && meta && !meta.hookMatched && at >= last.at && at - last.at < HOOK_MATCH_MS) {
    meta.hookMatched = true;
    applyMentions(ctx, mentioned);
    delete m.compactingSince;
    return;
  }
  m.pendingCompact = { at, trigger, mentionedPinIds: mentioned };
  m.campUntil = Math.max(m.campUntil, at + CAMP_MIN_MS);
}

function expirePending(ctx: Ctx): boolean {
  const { m } = ctx;
  const pending = m.pendingCompact;
  if (!pending || ctx.now - pending.at < BOUNDARY_WAIT_MS) return false;
  delete m.pendingCompact;
  compact(ctx, {
    at: pending.at,
    trigger: pending.trigger,
    before: m.state.contextTokens,
    preserved: new Set(),
    source: 'hook',
    hookMatched: true,
    mentionedPinIds: pending.mentionedPinIds,
  });
  return true;
}

// Usage and model -------------------------------------------------------------------------

function setModel(ctx: Ctx, modelId: string | undefined, bare: boolean): void {
  if (modelId === undefined || modelId === '') return;
  const current = ctx.m.state.model;
  if (bare && current?.replace(/\[[^\]]*\]$/, '') === modelId) return;
  ctx.m.state.model = modelId;
}

function applyUsage(ctx: Ctx, fact: Extract<TranscriptFact, { fact: 'usage' }>): void {
  const { m } = ctx;
  if (fact.agentId !== undefined) {
    const companion = m.state.subagents[fact.agentId];
    if (companion) companion.contextTokens = fact.contextTokens;
    return;
  }
  setModel(ctx, fact.model, true);
  m.baselineTokens ??= fact.contextTokens;
  if (fact.at <= m.lastStatusLineAt) return;
  m.state.contextTokens = fact.contextTokens;
  m.state.contextSource = 'transcript';
  const last = m.state.compactions[m.state.compactions.length - 1];
  if (last && last.after === undefined && fact.at >= last.at) last.after = fact.contextTokens;
}

// Facts and events ------------------------------------------------------------------------

function applyMeta(ctx: Ctx, cwd: string): void {
  const { state } = ctx.m;
  if (state.cwd !== '' || cwd === '') return;
  state.cwd = cwd;
  state.title = titleOf(cwd, state.sessionId);
}

function applyFact(ctx: Ctx, fact: TranscriptFact): void {
  switch (fact.fact) {
    case 'meta':
      applyMeta(ctx, fact.cwd);
      return;
    case 'model':
      setModel(ctx, fact.modelId, false);
      return;
    case 'usage':
      applyUsage(ctx, fact);
      return;
    case 'prompt':
      if (fact.agentId === undefined) transcriptPrompt(ctx, fact);
      return;
    case 'tool':
      applyTool(ctx, fact.tool, {
        from: 'transcript',
        at: fact.at,
        failed: fact.failed,
        uuid: fact.uuid,
        ...(fact.agentId === undefined ? {} : { agentId: fact.agentId }),
      });
      if (fact.launch) noteLaunch(ctx, fact.tool, fact.launch);
      return;
    case 'report':
      applyReport(ctx, fact);
      return;
    case 'instructions':
      applyInstructions(ctx, fact.path, fact.chars, fact.at, true);
      return;
    case 'boundary':
      applyBoundary(ctx, fact);
      return;
    case 'summary':
      sewnIn(ctx, {
        key: 'field-notes',
        kind: 'other',
        label: 'Field Notes',
        chars: fact.chars,
        at: fact.at,
      });
      if (fact.mentionedPinIds) applyMentions(ctx, fact.mentionedPinIds);
      return;
    case 'attached':
      applyAttached(ctx, fact);
      return;
  }
}

function markRepacked(ctx: Ctx, ids: readonly string[]): void {
  const { m } = ctx;
  const done: string[] = [];
  for (const id of ids) {
    const item = itemById(ctx, id);
    const meta = m.meta[id];
    if (!item || meta?.base !== 'dropped') continue;
    meta.base = 'repacked';
    item.epoch = m.state.epoch;
    done.push(id);
  }
  m.repackQueue = m.repackQueue.filter(id => !ids.includes(id));
  if (done.length > 0) ctx.cues.push({ cue: 'repacked', itemIds: done });
}

function adoptEnvelope(ctx: Ctx, event: HookEvent): void {
  const { state } = ctx.m;
  applyMeta(ctx, event.cwd);
  if (state.transcriptPath === '' && event.transcriptPath !== '') {
    state.transcriptPath = event.transcriptPath;
  }
}

function applyHook(ctx: Ctx, event: HookEvent): void {
  const { m } = ctx;
  adoptEnvelope(ctx, event);
  if (event.event !== 'Notification' && event.event !== 'StatusLine') m.waiting = false;
  switch (event.event) {
    case 'SessionStart':
      m.ended = false;
      setModel(ctx, event.model, false);
      return;
    case 'UserPromptSubmit':
      hookPrompt(ctx, event.promptChars, event.at);
      markRepacked(ctx, event.repackedIds);
      return;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      applyTool(ctx, event.tool, {
        from: 'hook',
        at: event.at,
        failed: event.event === 'PostToolUseFailure',
        ...(event.agentId === undefined ? {} : { agentId: event.agentId }),
      });
      return;
    case 'SubagentStart':
      if (event.agentId === undefined || !event.agentType) return;
      ensureCompanion(ctx, event.agentId, event.agentType);
      return;
    case 'SubagentStop':
      subagentStop(ctx, event);
      return;
    case 'InstructionsLoaded':
      applyInstructions(ctx, event.filePath, event.chars, event.at, false);
      return;
    case 'Notification':
      if (WAITING_NOTIFICATIONS.has(event.notificationType)) m.waiting = true;
      return;
    case 'Stop':
      ctx.cues.push({ cue: 'cheer' });
      return;
    case 'PreCompact':
      m.compactingSince = event.at;
      m.campUntil = Math.max(m.campUntil, event.at + CAMP_MIN_MS);
      return;
    case 'PostCompact':
      postCompact(ctx, event.trigger, event.mentionedPinIds, event.at);
      return;
    case 'SessionEnd':
      m.ended = true;
      return;
    case 'StatusLine':
      statusLine(ctx, event);
      return;
  }
}

function subagentStop(ctx: Ctx, event: Extract<HookEvent, { event: 'SubagentStop' }>): void {
  if (event.agentId === undefined || !event.agentType) return;
  const companion = ensureCompanion(ctx, event.agentId, event.agentType);
  const tokens = tokensFromChars(event.reportChars);
  const toolUseId = ctx.m.agentToolUse[event.agentId];
  const item =
    toolUseId === undefined
      ? undefined
      : itemById(ctx, stableItemId(ctx.m.state.sessionId, `tool:${toolUseId}`));
  const exactKnown = item !== undefined && ctx.m.meta[item.id]?.reportExact === true;
  if (!exactKnown && tokens > 0) {
    companion.reportTokens = tokens;
    if (item) setReport(ctx, item, tokens, false);
  }
  returnCompanion(ctx, companion);
}

function statusLine(ctx: Ctx, event: Extract<HookEvent, { event: 'StatusLine' }>): void {
  const { m } = ctx;
  if (event.windowTokens > 0) m.statusLineWindow = event.windowTokens;
  m.state.contextTokens = event.contextTokens;
  m.state.contextSource = 'statusline';
  m.lastStatusLineAt = event.at;
  setModel(ctx, event.model, false);
}

// Derived state ---------------------------------------------------------------------------

function derivePhase(m: SessionModel, now: number): SessionPhase {
  if (m.ended) return 'done';
  const compacting = m.compactingSince !== undefined && now - m.compactingSince < COMPACTING_MAX_MS;
  if (compacting || m.pendingCompact !== undefined || now < m.campUntil) return 'camping';
  if (m.waiting) return 'waiting_for_user';
  const last = m.state.lastToolAt;
  if (last !== undefined && now - last < WALK_MS) return 'walking';
  return 'idle';
}

function overlayStatuses(m: SessionModel): void {
  const pins = new Map<string, Pin>(m.state.pins.map(pin => [pin.itemId, pin]));
  const queued = new Set(m.repackQueue);
  for (const item of m.state.items) {
    const meta = m.meta[item.id];
    if (!meta) continue;
    const pin = pins.get(item.id);
    if (pin) {
      item.status = 'pinned';
      if (pin.note === undefined) delete item.note;
      else item.note = pin.note;
      if (pin.snippet === undefined) delete item.pinnedSnippet;
      else item.pinnedSnippet = pin.snippet;
      continue;
    }
    delete item.note;
    delete item.pinnedSnippet;
    item.status = queued.has(item.id) && meta.base === 'dropped' ? 'repack_queued' : meta.base;
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function finish(ctx: Ctx): Update {
  const { m, now } = ctx;
  const { state } = m;
  const size = resolveWindow(state.model, m.settings, m.statusLineWindow);
  state.windowTokens = size.windowTokens;
  state.compactAtTokens = size.compactAtTokens;
  state.fill = clamp01(state.contextTokens / size.compactAtTokens);
  state.windowFill = clamp01(state.contextTokens / size.windowTokens);
  overlayStatuses(m);
  const insights = analyze(state);
  for (const item of state.items) {
    if (insights.staleIds.has(item.id)) item.stale = true;
    else delete item.stale;
  }
  state.tips = insights.tips;
  state.phase = derivePhase(m, now);
  state.updatedAt = now;
  return { model: m, cues: ctx.cues };
}

function draft(model: SessionModel, now: number): Ctx {
  return { m: structuredClone(model), cues: [], now };
}

export function applyFacts(model: SessionModel, facts: readonly TranscriptFact[], now: number) {
  const ctx = draft(model, now);
  for (const fact of facts) applyFact(ctx, fact);
  return finish(ctx);
}

export function applyEvent(model: SessionModel, event: HookEvent, now: number): Update {
  const ctx = draft(model, now);
  applyHook(ctx, event);
  return finish(ctx);
}

/** Lays the Keep List from pins.json over the items. */
export function applyPins(model: SessionModel, pins: readonly Pin[], now: number): Update {
  const ctx = draft(model, now);
  const before = new Set(model.state.pins.map(pin => pin.itemId));
  ctx.m.state.pins = pins.map(pin => ({ ...pin }));
  for (const pin of pins) {
    if (!before.has(pin.itemId)) ctx.cues.push({ cue: 'pinned', itemId: pin.itemId });
  }
  return finish(ctx);
}

export function applyRepackQueue(
  model: SessionModel,
  entries: readonly RepackEntry[],
  now: number,
): Update {
  const ctx = draft(model, now);
  ctx.m.repackQueue = entries.map(entry => entry.itemId);
  return finish(ctx);
}

/** Re-evaluates timers. Returns the same model object when nothing changed. */
export function refresh(model: SessionModel, now: number): Update {
  const expired =
    model.pendingCompact !== undefined && now - model.pendingCompact.at >= BOUNDARY_WAIT_MS;
  if (!expired && derivePhase(model, now) === model.state.phase) {
    return { model, cues: [] };
  }
  const ctx = draft(model, now);
  expirePending(ctx);
  return finish(ctx);
}
