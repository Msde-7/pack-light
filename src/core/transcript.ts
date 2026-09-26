import type { CompactTrigger, ToolSummary } from './protocol';
import { summarizeTool, tokensFromChars } from './estimate';
import {
  getArray,
  getBoolean,
  getNumber,
  getObject,
  getString,
  isObject,
  jsonLength,
  parseJson,
  stringArray,
  type JsonObject,
} from './json';

/** Launch details of an Agent or Task call, used to follow the subagent as a companion. */
export interface SubagentLaunch {
  agentId?: string;
  agentType?: string;
  async: boolean;
}

interface FactBase {
  /** Source record uuid, so compaction can honor preserved messages. */
  uuid: string;
  at: number;
  agentId?: string;
}

/**
 * Content-free facts read from a transcript. They carry sizes, labels and ids, never the text
 * of prompts, tool output or summaries.
 */
export type TranscriptFact =
  | (FactBase & { fact: 'meta'; sessionId: string; cwd: string })
  | (FactBase & { fact: 'model'; modelId: string })
  | (FactBase & { fact: 'usage'; contextTokens: number; model?: string })
  | (FactBase & { fact: 'prompt'; chars: number })
  | (FactBase & { fact: 'tool'; tool: ToolSummary; failed: boolean; launch?: SubagentLaunch })
  | (FactBase & { fact: 'report'; chars: number; toolUseId?: string; taskId?: string })
  | (FactBase & { fact: 'instructions'; path: string; chars: number })
  | (FactBase & {
      fact: 'boundary';
      trigger: CompactTrigger;
      preTokens?: number;
      postTokens?: number;
      preservedUuids: string[];
    })
  | (FactBase & { fact: 'summary'; chars: number; mentionedPinIds?: string[] })
  | (FactBase & {
      fact: 'attached';
      kind: 'file' | 'file_reference' | 'skill';
      label: string;
      path?: string;
      chars: number;
      /** True when Claude Code restored it right after a compaction boundary. */
      afterCompact: boolean;
    });

/**
 * Returns the pin ids a compaction summary names. The summary text goes no further than this
 * call, so facts stay free of content.
 */
export type SummaryMatcher = (summary: string) => string[];

export interface TranscriptReader {
  /** Takes the next chunk of text. A partial last line waits for the rest. */
  feed(text: string): TranscriptFact[];
  /** Parses a trailing line with no newline, for one-shot reads of a finished file. */
  end(): TranscriptFact[];
}

const IMAGE_PART_CHARS = 1600 * 4;
const SYNTHETIC_MODEL = '<synthetic>';

interface PendingTool {
  base: ToolSummary;
  agentType?: string;
}

interface ReaderState {
  buffer: string;
  pending: Map<string, PendingTool>;
  metaSent: boolean;
  /** Set by a compact boundary and cleared by the next real turn, marks restored attachments. */
  afterBoundary: boolean;
  matchSummary?: SummaryMatcher;
}

function timeOf(record: JsonObject): number {
  const parsed = Date.parse(getString(record, 'timestamp') ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function base(record: JsonObject): FactBase {
  const agentId = getString(record, 'agentId');
  return {
    uuid: getString(record, 'uuid') ?? '',
    at: timeOf(record),
    ...(agentId === undefined ? {} : { agentId }),
  };
}

/** Characters of a content value as Claude sees it, a string or an array of parts. */
function contentChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    const type = getString(part, 'type');
    if (type === 'text') total += getString(part, 'text')?.length ?? 0;
    else if (type === 'image') total += IMAGE_PART_CHARS;
    else total += jsonLength(part);
  }
  return total;
}

function summaryText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => getString(part, 'text') ?? '').join('\n');
}

function renderedChars(record: JsonObject): number | undefined {
  const rendered = getArray(record, 'rendered');
  if (!rendered) return undefined;
  return rendered.reduce<number>((sum, part) => sum + (getString(part, 'content')?.length ?? 0), 0);
}

function onUsage(record: JsonObject, message: JsonObject): TranscriptFact | undefined {
  const model = getString(message, 'model');
  if (model === SYNTHETIC_MODEL) return undefined;
  const usage = getObject(message, 'usage');
  if (!usage) return undefined;
  const contextTokens =
    (getNumber(usage, 'input_tokens') ?? 0) +
    (getNumber(usage, 'cache_creation_input_tokens') ?? 0) +
    (getNumber(usage, 'cache_read_input_tokens') ?? 0);
  return { fact: 'usage', ...base(record), contextTokens, ...(model ? { model } : {}) };
}

function rememberToolUses(state: ReaderState, record: JsonObject, content: unknown[]): void {
  const cwd = getString(record, 'cwd');
  for (const block of content) {
    if (getString(block, 'type') !== 'tool_use') continue;
    const id = getString(block, 'id');
    const name = getString(block, 'name');
    if (id === undefined || name === undefined) continue;
    const input = isObject(block) ? block.input : undefined;
    const summary = summarizeTool({
      toolName: name,
      toolUseId: id,
      input,
      resultChars: 0,
      ...(cwd === undefined ? {} : { cwd }),
    });
    const agentType = getString(input, 'subagent_type');
    state.pending.set(id, { base: summary, ...(agentType === undefined ? {} : { agentType }) });
  }
}

function onAssistant(state: ReaderState, record: JsonObject): TranscriptFact[] {
  const message = getObject(record, 'message');
  if (!message) return [];
  state.afterBoundary = false;
  const content = getArray(message, 'content');
  if (content) rememberToolUses(state, record, content);
  const usage = onUsage(record, message);
  return usage ? [usage] : [];
}

function launchOf(pending: PendingTool | undefined, result: unknown): SubagentLaunch | undefined {
  if (pending?.base.kind !== 'subagent_report') return undefined;
  const agentId = getString(result, 'agentId');
  return {
    async:
      getBoolean(result, 'isAsync') === true || getString(result, 'status') === 'async_launched',
    ...(agentId === undefined ? {} : { agentId }),
    ...(pending.agentType === undefined ? {} : { agentType: pending.agentType }),
  };
}

function toolFact(
  state: ReaderState,
  record: JsonObject,
  block: unknown,
  structured: unknown,
): TranscriptFact | undefined {
  const toolUseId = getString(block, 'tool_use_id');
  if (toolUseId === undefined) return undefined;
  const pending = state.pending.get(toolUseId);
  state.pending.delete(toolUseId);
  const resultChars = contentChars(isObject(block) ? block.content : undefined);
  const baseTool: ToolSummary = pending?.base ?? {
    toolUseId,
    toolName: 'Tool',
    kind: 'other',
    label: 'tool result',
    tokens: 0,
  };
  const tool: ToolSummary = { ...baseTool, tokens: baseTool.tokens + tokensFromChars(resultChars) };
  const launch = launchOf(pending, structured);
  return {
    fact: 'tool',
    ...base(record),
    tool,
    failed: getBoolean(block, 'is_error') === true,
    ...(launch ? { launch } : {}),
  };
}

function tagValue(text: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text);
  const value = match?.[1]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function onTaskNotification(record: JsonObject, content: unknown): TranscriptFact {
  const text = typeof content === 'string' ? content : '';
  const toolUseId = tagValue(text, 'tool-use-id');
  const taskId = tagValue(text, 'task-id');
  return {
    fact: 'report',
    ...base(record),
    chars: contentChars(content),
    ...(toolUseId === undefined ? {} : { toolUseId }),
    ...(taskId === undefined ? {} : { taskId }),
  };
}

function isHumanPrompt(record: JsonObject, content: unknown): boolean {
  if (getBoolean(record, 'isMeta') === true) return false;
  if (getBoolean(record, 'isVisibleInTranscriptOnly') === true) return false;
  if ('toolUseResult' in record || 'interruptedMessageId' in record) return false;
  const origin = getString(getObject(record, 'origin'), 'kind');
  if (origin !== undefined) return origin === 'human';
  return typeof content === 'string' && !content.startsWith('<');
}

function onUser(state: ReaderState, record: JsonObject): TranscriptFact[] {
  const message = getObject(record, 'message');
  if (!message) return [];
  const content = message.content;
  if (getBoolean(record, 'isCompactSummary') === true) {
    const mentioned = state.matchSummary?.(summaryText(content));
    return [
      {
        fact: 'summary',
        ...base(record),
        chars: contentChars(content),
        ...(mentioned === undefined ? {} : { mentionedPinIds: mentioned }),
      },
    ];
  }
  if (getString(getObject(record, 'origin'), 'kind') === 'task-notification') {
    return [onTaskNotification(record, content)];
  }
  if (Array.isArray(content) && content.some(b => getString(b, 'type') === 'tool_result')) {
    const structured = record.toolUseResult;
    return content.flatMap(block => {
      if (getString(block, 'type') !== 'tool_result') return [];
      const fact = toolFact(state, record, block, structured);
      return fact ? [fact] : [];
    });
  }
  if (!isHumanPrompt(record, content)) return [];
  state.afterBoundary = false;
  return [{ fact: 'prompt', ...base(record), chars: contentChars(content) }];
}

function onBoundary(state: ReaderState, record: JsonObject): TranscriptFact[] {
  const meta = getObject(record, 'compactMetadata');
  state.afterBoundary = true;
  const preserved = getObject(meta, 'preservedMessages');
  const uuids = new Set([...stringArray(preserved?.uuids), ...stringArray(preserved?.allUuids)]);
  const preTokens = getNumber(meta, 'preTokens');
  const postTokens = getNumber(meta, 'postTokens');
  return [
    {
      fact: 'boundary',
      ...base(record),
      trigger: getString(meta, 'trigger') === 'manual' ? 'manual' : 'auto',
      preservedUuids: [...uuids],
      ...(preTokens === undefined ? {} : { preTokens }),
      ...(postTokens === undefined ? {} : { postTokens }),
    },
  ];
}

function instructionFacts(record: JsonObject, attachment: JsonObject): TranscriptFact[] {
  const files = getArray(attachment, 'files') ?? [];
  return files.flatMap(file => {
    const path = getString(file, 'path');
    if (path === undefined) return [];
    const chars = getString(file, 'content')?.length ?? 0;
    return [{ fact: 'instructions' as const, ...base(record), path, chars }];
  });
}

function fileAttachment(
  state: ReaderState,
  record: JsonObject,
  attachment: JsonObject,
  kind: 'file' | 'file_reference',
): TranscriptFact[] {
  const path = getString(attachment, 'filename');
  if (path === undefined) return [];
  const file = getObject(getObject(attachment, 'content'), 'file');
  const chars = renderedChars(record) ?? getString(file, 'content')?.length ?? 0;
  return [
    {
      fact: 'attached',
      ...base(record),
      kind,
      label: getString(attachment, 'displayPath') ?? path,
      path,
      chars,
      afterCompact: state.afterBoundary,
    },
  ];
}

function skillFacts(state: ReaderState, record: JsonObject, attachment: JsonObject) {
  const skills = getArray(attachment, 'skills') ?? [];
  return skills.flatMap(skill => {
    const name = getString(skill, 'name');
    if (name === undefined) return [];
    const path = getString(skill, 'path');
    return [
      {
        fact: 'attached' as const,
        ...base(record),
        kind: 'skill' as const,
        label: name,
        chars: getString(skill, 'content')?.length ?? 0,
        afterCompact: state.afterBoundary,
        ...(path === undefined ? {} : { path }),
      },
    ];
  });
}

function onAttachment(state: ReaderState, record: JsonObject): TranscriptFact[] {
  const attachment = getObject(record, 'attachment');
  if (!attachment) return [];
  switch (getString(attachment, 'type') ?? '') {
    case 'model': {
      const modelId = getString(getObject(attachment, 'identity'), 'modelId');
      return modelId === undefined ? [] : [{ fact: 'model', ...base(record), modelId }];
    }
    case 'instructions':
      return instructionFacts(record, attachment);
    case 'file':
      return fileAttachment(state, record, attachment, 'file');
    case 'compact_file_reference':
      return fileAttachment(state, record, attachment, 'file_reference');
    case 'invoked_skills':
      return skillFacts(state, record, attachment);
    default:
      return [];
  }
}

function metaFact(state: ReaderState, record: JsonObject): TranscriptFact[] {
  if (state.metaSent) return [];
  const sessionId = getString(record, 'sessionId');
  const cwd = getString(record, 'cwd');
  if (sessionId === undefined || cwd === undefined) return [];
  state.metaSent = true;
  return [{ fact: 'meta', ...base(record), sessionId, cwd }];
}

function recordFacts(state: ReaderState, record: JsonObject): TranscriptFact[] {
  switch (getString(record, 'type') ?? '') {
    case 'assistant':
      return onAssistant(state, record);
    case 'user':
      return onUser(state, record);
    case 'attachment':
      return onAttachment(state, record);
    case 'system':
      return getString(record, 'subtype') === 'compact_boundary' ? onBoundary(state, record) : [];
    default:
      return [];
  }
}

function lineFacts(state: ReaderState, line: string): TranscriptFact[] {
  const record = parseJson(line.trim());
  if (!isObject(record)) return [];
  return [...metaFact(state, record), ...recordFacts(state, record)];
}

export function createTranscriptReader(matchSummary?: SummaryMatcher): TranscriptReader {
  const state: ReaderState = {
    buffer: '',
    pending: new Map(),
    metaSent: false,
    afterBoundary: false,
    ...(matchSummary === undefined ? {} : { matchSummary }),
  };
  return {
    feed(text) {
      const lines = (state.buffer + text).split('\n');
      state.buffer = lines.pop() ?? '';
      return lines.flatMap(line => lineFacts(state, line));
    },
    end() {
      const last = state.buffer;
      state.buffer = '';
      return lineFacts(state, last);
    },
  };
}

export function parseTranscript(text: string, matchSummary?: SummaryMatcher): TranscriptFact[] {
  const reader = createTranscriptReader(matchSummary);
  return [...reader.feed(text), ...reader.end()];
}
