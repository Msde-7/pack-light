export const ITEM_KINDS = [
  'file_read',
  'search',
  'bash_output',
  'web',
  'mcp',
  'subagent_report',
  'edit',
  'user_prompt',
  'instructions',
  'other',
] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export type WeightClass = 'pebble' | 'book' | 'brick' | 'anvil';

export type ItemStatus =
  'carried' | 'pinned' | 'dropped' | 'sewn_in' | 'repack_queued' | 'repacked';

export interface Item {
  /** Stable across rebuilds, derived from the session id and the tool_use_id or a synthetic key. */
  id: string;
  sessionId: string;
  agentId?: string;
  kind: ItemKind;
  label: string;
  path?: string;
  /** Line range for partial file reads, such as "40-58". */
  range?: string;
  tokensEst: number;
  weight: WeightClass;
  turn: number;
  addedAt: number;
  /** Compaction epoch the item was added in. Epoch 0 is the start of the session. */
  epoch: number;
  status: ItemStatus;
  failed?: boolean;
  duplicateOf?: string;
  note?: string;
  pinnedSnippet?: string;
  /** Set after a compaction when the item is pinned. True when the summary names it. */
  mentionedInSummary?: boolean;
  /** Old and never referenced again, a candidate to let go. */
  stale?: boolean;
}

export type SessionPhase = 'walking' | 'waiting_for_user' | 'idle' | 'camping' | 'done';

export interface Companion {
  agentId: string;
  agentType: string;
  description?: string;
  status: 'active' | 'returned';
  items: string[];
  reportTokens?: number;
  contextTokens?: number;
  /** Index into the companion hat palette, stable per agent. */
  hat: number;
}

export interface Compaction {
  at: number;
  trigger: 'manual' | 'auto';
  before: number;
  after?: number;
  droppedIds: string[];
}

/** Where contextTokens came from, in order of trust. */
export type ContextSource = 'statusline' | 'transcript' | 'estimate';

export interface SessionState {
  sessionId: string;
  cwd: string;
  transcriptPath: string;
  /** Short display name, the basename of cwd. */
  title: string;
  model?: string;
  windowTokens: number;
  /** Token count at which auto compaction fires. */
  compactAtTokens: number;
  contextTokens: number;
  contextSource: ContextSource;
  /** contextTokens / compactAtTokens, clamped to 0..1. Drives the hiker and pack. */
  fill: number;
  /** contextTokens / windowTokens, shown as the raw window percent. */
  windowFill: number;
  phase: SessionPhase;
  turn: number;
  epoch: number;
  lastToolAt?: number;
  startedAt: number;
  updatedAt: number;
  items: Item[];
  subagents: Record<string, Companion>;
  compactions: Compaction[];
  /** The Keep List, highest priority first. */
  pins: Pin[];
  tips: TrailTip[];
}

export type TipKind =
  'carried_twice' | 'anvil' | 'loud_command' | 'heavy_research' | 'stale_load' | 'camp_soon';

export interface TrailTip {
  /** Stable per kind, item and epoch, so a dismissed tip stays dismissed. */
  id: string;
  kind: TipKind;
  text: string;
  itemIds: string[];
  wastedTokens?: number;
}

/** A pin as persisted in pins.json. Holds no tool output, only what the user chose to keep. */
export interface Pin {
  itemId: string;
  kind: ItemKind;
  label: string;
  path?: string;
  range?: string;
  note?: string;
  snippet?: string;
  pinnedAt: number;
}

/** A dropped item the user asked to bring back on the next prompt. */
export interface RepackEntry {
  itemId: string;
  kind: ItemKind;
  label: string;
  path?: string;
  note?: string;
}

export const LIMITS = {
  noteChars: 280,
  snippetChars: 1500,
  injectionChars: 9000,
  compactCommandChars: 1000,
} as const;
