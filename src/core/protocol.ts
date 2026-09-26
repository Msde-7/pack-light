import type { ItemKind, SessionState } from './types';

/** Size and label of one tool call. Built by the estimator, never carries tool output. */
export interface ToolSummary {
  toolUseId: string;
  toolName: string;
  kind: ItemKind;
  label: string;
  path?: string;
  range?: string;
  tokens: number;
}

interface Envelope {
  v: 1;
  sessionId: string;
  transcriptPath: string;
  cwd: string;
  agentId?: string;
  agentType?: string;
  at: number;
}

export const SESSION_SOURCES = ['startup', 'resume', 'clear', 'compact', 'fork'] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];
export type CompactTrigger = 'manual' | 'auto';

/** Body of POST /events. Hooks build these from hook input and send nothing else. */
export type HookEvent = Envelope &
  (
    | { event: 'SessionStart'; source: SessionSource; model?: string }
    | { event: 'UserPromptSubmit'; promptChars: number; repackedIds: string[] }
    | { event: 'PostToolUse'; tool: ToolSummary }
    | { event: 'PostToolUseFailure'; tool: ToolSummary; interrupted: boolean }
    | { event: 'SubagentStart' }
    | { event: 'SubagentStop'; reportChars: number; agentTranscriptPath?: string }
    | { event: 'InstructionsLoaded'; filePath: string; loadReason: string; chars: number }
    | { event: 'Notification'; notificationType: string }
    | { event: 'Stop' }
    | { event: 'PreCompact'; trigger: CompactTrigger }
    | { event: 'PostCompact'; trigger: CompactTrigger; mentionedPinIds: string[] }
    | { event: 'SessionEnd'; reason: string }
    | { event: 'StatusLine'; windowTokens: number; contextTokens: number; model?: string }
  );

/** One-shot visual cues for the scene, sent alongside state updates. */
export type SceneCue =
  | { cue: 'item_added'; itemId: string; duplicate: boolean }
  | { cue: 'camp'; compactionIndex: number }
  | { cue: 'repacked'; itemIds: string[] }
  | { cue: 'pinned'; itemId: string }
  | { cue: 'cheer' }
  | { cue: 'companion_joined'; agentId: string }
  | { cue: 'companion_returned'; agentId: string };

/** Server-sent events on GET /api/stream. The SSE event name is the `type` field. */
export type ServerMessage =
  | { type: 'snapshot'; sessions: SessionState[] }
  | { type: 'session'; session: SessionState }
  | { type: 'removed'; sessionId: string }
  | { type: 'cue'; sessionId: string; cue: SceneCue };

/** Contents of ~/.pack-light/server.json. */
export interface ServerInfo {
  port: number;
  token: string;
  pid: number;
  startedAt: number;
}

export const TOKEN_HEADER = 'x-pack-light-token';

/**
 * HTTP API served on 127.0.0.1. Every route needs the token, as the TOKEN_HEADER header or,
 * for EventSource which cannot set headers, a `token` query parameter.
 *
 *   GET    /api/health                              { ok: true, version: string }
 *   POST   /events                                  HookEvent
 *   GET    /api/stream                              text/event-stream of ServerMessage
 *   GET    /api/sessions                            SessionState[]
 *   PUT    /api/sessions/:id/pins/:itemId           PinRequest, creates or updates a pin
 *   DELETE /api/sessions/:id/pins/:itemId           unpin
 *   PUT    /api/sessions/:id/pins-order             { itemIds: string[] }, Keep List order
 *   POST   /api/sessions/:id/repack                 { itemIds: string[] }
 *   GET    /api/sessions/:id/items/:itemId/excerpt  ?start=&end= reads lines of a file item from disk
 */
export interface PinRequest {
  note?: string;
  snippet?: string;
}

export interface ExcerptResponse {
  path: string;
  start: number;
  end: number;
  totalLines: number;
  text: string;
}
