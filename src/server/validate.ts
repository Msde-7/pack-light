import {
  getArray,
  getBoolean,
  getNumber,
  getString,
  isObject,
  type JsonObject,
} from '../core/json';
import {
  SESSION_SOURCES,
  type CompactTrigger,
  type HookEvent,
  type PinRequest,
  type ToolSummary,
} from '../core/protocol';
import { ITEM_KINDS, LIMITS } from '../core/types';

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_TEXT = 2048;
const MAX_IDS = 500;

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find(option => option === value);
}

function text(raw: unknown, key: string, max = MAX_TEXT): string | undefined {
  const value = getString(raw, key);
  return value === undefined || value.length > max ? undefined : value;
}

function count(raw: unknown, key: string): number | undefined {
  const value = getNumber(raw, key);
  return value === undefined || value < 0 ? undefined : Math.round(value);
}

export function parseIdList(raw: unknown, key = 'itemIds'): string[] | undefined {
  const list = getArray(raw, key);
  if (!list || list.length > MAX_IDS) return undefined;
  const ids = list.filter((v): v is string => typeof v === 'string' && v.length <= 128);
  return ids.length === list.length ? ids : undefined;
}

function parseTool(raw: unknown): ToolSummary | undefined {
  const toolUseId = text(raw, 'toolUseId', 256);
  const toolName = text(raw, 'toolName', 256);
  const kind = oneOf(getString(raw, 'kind'), ITEM_KINDS);
  const label = text(raw, 'label', 512);
  const tokens = count(raw, 'tokens');
  if (!toolUseId || !toolName || !kind || label === undefined || tokens === undefined) {
    return undefined;
  }
  const path = text(raw, 'path');
  const range = text(raw, 'range', 64);
  return {
    toolUseId,
    toolName,
    kind,
    label,
    tokens,
    ...(path === undefined ? {} : { path }),
    ...(range === undefined ? {} : { range }),
  };
}

function trigger(raw: JsonObject): CompactTrigger | undefined {
  return oneOf(getString(raw, 'trigger'), ['manual', 'auto'] as const);
}

type Envelope = Pick<HookEvent, 'v' | 'sessionId' | 'transcriptPath' | 'cwd' | 'at'> & {
  agentId?: string;
  agentType?: string;
};

function parseEnvelope(raw: JsonObject): Envelope | undefined {
  const sessionId = getString(raw, 'sessionId');
  const transcriptPath = text(raw, 'transcriptPath') ?? '';
  const cwd = text(raw, 'cwd') ?? '';
  const at = getNumber(raw, 'at');
  if (raw.v !== 1 || sessionId === undefined || !SESSION_ID.test(sessionId) || at === undefined) {
    return undefined;
  }
  const agentId = text(raw, 'agentId', 128);
  const agentType = text(raw, 'agentType', 128);
  return {
    v: 1,
    sessionId,
    transcriptPath,
    cwd,
    at,
    ...(agentId === undefined ? {} : { agentId }),
    ...(agentType === undefined ? {} : { agentType }),
  };
}

type Body = HookEvent extends infer E
  ? E extends HookEvent
    ? Omit<E, keyof Envelope>
    : never
  : never;

function parseBody(raw: JsonObject): Body | undefined {
  switch (getString(raw, 'event') ?? '') {
    case 'SessionStart': {
      const source = oneOf(getString(raw, 'source'), SESSION_SOURCES);
      const model = text(raw, 'model', 128);
      if (!source) return undefined;
      return { event: 'SessionStart', source, ...(model === undefined ? {} : { model }) };
    }
    case 'UserPromptSubmit': {
      const promptChars = count(raw, 'promptChars');
      const repackedIds = parseIdList(raw, 'repackedIds') ?? [];
      return promptChars === undefined
        ? undefined
        : { event: 'UserPromptSubmit', promptChars, repackedIds };
    }
    case 'PostToolUse': {
      const tool = parseTool(raw.tool);
      return tool ? { event: 'PostToolUse', tool } : undefined;
    }
    case 'PostToolUseFailure': {
      const tool = parseTool(raw.tool);
      const interrupted = getBoolean(raw, 'interrupted') ?? false;
      return tool ? { event: 'PostToolUseFailure', tool, interrupted } : undefined;
    }
    case 'SubagentStart':
      return { event: 'SubagentStart' };
    case 'SubagentStop': {
      const agentTranscriptPath = text(raw, 'agentTranscriptPath');
      return {
        event: 'SubagentStop',
        reportChars: count(raw, 'reportChars') ?? 0,
        ...(agentTranscriptPath === undefined ? {} : { agentTranscriptPath }),
      };
    }
    case 'InstructionsLoaded': {
      const filePath = text(raw, 'filePath');
      const loadReason = text(raw, 'loadReason', 64) ?? '';
      const chars = count(raw, 'chars') ?? 0;
      return filePath ? { event: 'InstructionsLoaded', filePath, loadReason, chars } : undefined;
    }
    case 'Notification': {
      const notificationType = text(raw, 'notificationType', 64);
      return notificationType === undefined
        ? undefined
        : { event: 'Notification', notificationType };
    }
    case 'Stop':
      return { event: 'Stop' };
    case 'PreCompact': {
      const t = trigger(raw);
      return t ? { event: 'PreCompact', trigger: t } : undefined;
    }
    case 'PostCompact': {
      const t = trigger(raw);
      const mentionedPinIds = parseIdList(raw, 'mentionedPinIds') ?? [];
      return t ? { event: 'PostCompact', trigger: t, mentionedPinIds } : undefined;
    }
    case 'SessionEnd':
      return { event: 'SessionEnd', reason: text(raw, 'reason', 64) ?? 'other' };
    case 'StatusLine': {
      const windowTokens = count(raw, 'windowTokens');
      const contextTokens = count(raw, 'contextTokens');
      const model = text(raw, 'model', 128);
      if (windowTokens === undefined || contextTokens === undefined) return undefined;
      return {
        event: 'StatusLine',
        windowTokens,
        contextTokens,
        ...(model === undefined ? {} : { model }),
      };
    }
    default:
      return undefined;
  }
}

/** Narrows a POST /events body. Anything malformed is rejected whole. */
export function parseHookEvent(raw: unknown): HookEvent | undefined {
  if (!isObject(raw)) return undefined;
  const envelope = parseEnvelope(raw);
  const body = envelope ? parseBody(raw) : undefined;
  if (!envelope || !body) return undefined;
  return { ...envelope, ...body };
}

export type PinRequestResult = { ok: true; value: PinRequest } | { ok: false; error: string };

function optionalText(raw: unknown, key: string): string | undefined | null {
  if (!isObject(raw)) return undefined;
  const value = raw[key];
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : null;
}

export function parsePinRequest(raw: unknown): PinRequestResult {
  if (raw !== undefined && !isObject(raw)) return { ok: false, error: 'Expected an object.' };
  const note = optionalText(raw, 'note');
  const snippet = optionalText(raw, 'snippet');
  if (note === null || snippet === null) {
    return { ok: false, error: 'Notes and snippets are text.' };
  }
  if (note !== undefined && note.length > LIMITS.noteChars) {
    return { ok: false, error: `Notes hold up to ${LIMITS.noteChars} characters.` };
  }
  if (snippet !== undefined && snippet.length > LIMITS.snippetChars) {
    return { ok: false, error: `Snippets hold up to ${LIMITS.snippetChars} characters.` };
  }
  return {
    ok: true,
    value: {
      ...(note === undefined || note.trim() === '' ? {} : { note }),
      ...(snippet === undefined || snippet === '' ? {} : { snippet }),
    },
  };
}
