import { getNumber, getString, isObject, jsonLength, stringArray, type JsonObject } from './json';
import type { ToolSummary } from './protocol';
import type { ItemKind, WeightClass } from './types';

export interface WeightThresholds {
  book: number;
  brick: number;
  anvil: number;
}

export const DEFAULT_WEIGHTS: WeightThresholds = { book: 500, brick: 2000, anvil: 8000 };

const CHARS_PER_TOKEN = 4;
/** Read results reach Claude with a line-number gutter on every line. */
const READ_GUTTER_CHARS = 6;
/** Oversized Bash output is persisted to disk and Claude sees only a preview. */
const PERSISTED_PREVIEW_CHARS = 2200;
const IMAGE_PIXELS_PER_TOKEN = 750;
const IMAGE_FALLBACK_TOKENS = 1600;
const RESULT_ENVELOPE_CHARS = 80;
const LABEL_MAX = 60;

export function tokensFromChars(chars: number): number {
  return Math.round(Math.max(0, chars) / CHARS_PER_TOKEN);
}

export function weightOf(tokens: number, t: WeightThresholds = DEFAULT_WEIGHTS): WeightClass {
  if (tokens >= t.anvil) return 'anvil';
  if (tokens >= t.brick) return 'brick';
  if (tokens >= t.book) return 'book';
  return 'pebble';
}

export function kindOf(toolName: string): ItemKind {
  if (toolName.startsWith('mcp__')) return 'mcp';
  switch (toolName) {
    case 'Read':
    case 'NotebookRead':
      return 'file_read';
    case 'Grep':
    case 'Glob':
    case 'LS':
      return 'search';
    case 'Bash':
    case 'PowerShell':
      return 'bash_output';
    case 'WebFetch':
    case 'WebSearch':
      return 'web';
    case 'Agent':
    case 'Task':
      return 'subagent_report';
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'edit';
    default:
      return 'other';
  }
}

function len(value: string | undefined): number {
  return value?.length ?? 0;
}

/** Text length of an MCP or Agent style content array, `[{ type: 'text', text }]`. */
function contentArrayChars(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined;
  let total = 0;
  for (const part of value) {
    if (isObject(part) && typeof part.text === 'string') total += part.text.length;
    else total += jsonLength(part);
  }
  return total;
}

function imageTokens(file: JsonObject): number {
  const dims = file.dimensions;
  const width = getNumber(dims, 'displayWidth') ?? getNumber(dims, 'originalWidth');
  const height = getNumber(dims, 'displayHeight') ?? getNumber(dims, 'originalHeight');
  if (width === undefined || height === undefined) return IMAGE_FALLBACK_TOKENS;
  return Math.ceil((width * height) / IMAGE_PIXELS_PER_TOKEN);
}

/** Characters the tool call's own input adds to context, since the tool_use block stays in the conversation. */
function inputChars(toolName: string, input: unknown): number {
  switch (toolName) {
    case 'Write':
      return len(getString(input, 'content')) + len(getString(input, 'file_path'));
    case 'Edit':
      return len(getString(input, 'old_string')) + len(getString(input, 'new_string'));
    default:
      return jsonLength(input);
  }
}

/** Characters of the tool result as Claude sees it, from the structured tool_response. */
function responseChars(toolName: string, response: unknown): number {
  if (typeof response === 'string') return response.length;
  if (!isObject(response)) return jsonLength(response);

  switch (toolName) {
    case 'Read': {
      const file = response.file;
      if (!isObject(file)) return jsonLength(response);
      if (typeof file.base64 === 'string') return imageTokens(file) * CHARS_PER_TOKEN;
      const lines = getNumber(file, 'numLines') ?? 0;
      return len(getString(file, 'content')) + lines * READ_GUTTER_CHARS;
    }
    case 'Grep': {
      const content = getString(response, 'content');
      if (content !== undefined) return content.length;
      return filenamesChars(response.filenames);
    }
    case 'Glob':
      return filenamesChars(response.filenames);
    case 'Bash':
    case 'PowerShell': {
      const output = len(getString(response, 'stdout')) + len(getString(response, 'stderr'));
      if (typeof response.persistedOutputPath === 'string') {
        return Math.min(output, PERSISTED_PREVIEW_CHARS);
      }
      return output;
    }
    case 'WebFetch':
      return len(getString(response, 'result'));
    case 'WebSearch':
      return jsonLength(response.results);
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return RESULT_ENVELOPE_CHARS;
    default:
      return contentArrayChars(response.content) ?? jsonLength(response);
  }
}

function filenamesChars(value: unknown): number {
  return stringArray(value).reduce((sum, name) => sum + name.length + 1, 0);
}

export function displayPath(path: string, cwd?: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (cwd === undefined || cwd === '') return normalized;
  const base = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const caseless = /^[A-Za-z]:/.test(base);
  const head = normalized.slice(0, base.length + 1);
  const matches = caseless ? head.toLowerCase() === `${base}/`.toLowerCase() : head === `${base}/`;
  return matches ? normalized.slice(base.length + 1) : normalized;
}

function clip(text: string, max = LABEL_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function readRange(input: unknown): string | undefined {
  const offset = getNumber(input, 'offset');
  const limit = getNumber(input, 'limit');
  if (offset === undefined && limit === undefined) return undefined;
  const start = offset ?? 1;
  return limit === undefined ? `${start}-` : `${start}-${start + limit - 1}`;
}

function hostAndPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url;
  }
}

interface Labelled {
  label: string;
  path?: string;
  range?: string;
}

function labelFor(toolName: string, input: unknown, cwd?: string): Labelled {
  const filePath = getString(input, 'file_path') ?? getString(input, 'notebook_path');
  switch (toolName) {
    case 'Read':
    case 'NotebookRead': {
      if (filePath === undefined) return { label: toolName };
      const range = readRange(input);
      return {
        label: clip(displayPath(filePath, cwd)),
        path: filePath,
        ...(range === undefined ? {} : { range }),
      };
    }
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return filePath === undefined
        ? { label: toolName }
        : {
            label: clip(`${toolName.toLowerCase()}: ${displayPath(filePath, cwd)}`),
            path: filePath,
          };
    case 'Grep':
      return { label: clip(`grep: ${getString(input, 'pattern') ?? ''}`) };
    case 'Glob':
      return { label: clip(`glob: ${getString(input, 'pattern') ?? ''}`) };
    case 'LS':
      return { label: clip(`ls: ${displayPath(getString(input, 'path') ?? '.', cwd)}`) };
    case 'Bash':
    case 'PowerShell':
      return { label: clip(getString(input, 'command') ?? toolName) };
    case 'WebFetch':
      return { label: clip(hostAndPath(getString(input, 'url') ?? 'web page')) };
    case 'WebSearch':
      return { label: clip(`search: ${getString(input, 'query') ?? ''}`) };
    case 'Agent':
    case 'Task':
      return {
        label: clip(
          getString(input, 'description') ?? getString(input, 'subagent_type') ?? 'subagent',
        ),
      };
    default: {
      if (toolName.startsWith('mcp__')) {
        const [, server = 'mcp', tool = ''] = toolName.split('__');
        return { label: clip(`${server}: ${tool}`) };
      }
      return { label: toolName };
    }
  }
}

export interface ToolCall {
  toolName: string;
  toolUseId: string;
  input: unknown;
  /** Structured result, the hook's tool_response or the transcript's toolUseResult. */
  response?: unknown;
  /**
   * Exact characters of the tool_result block, when known from the transcript.
   * Preferred over the structured response because it is what Claude actually saw.
   */
  resultChars?: number;
  cwd?: string;
}

export function summarizeTool(call: ToolCall): ToolSummary {
  const result = call.resultChars ?? responseChars(call.toolName, call.response);
  const chars = inputChars(call.toolName, call.input) + result;
  return {
    toolUseId: call.toolUseId,
    toolName: call.toolName,
    kind: kindOf(call.toolName),
    ...labelFor(call.toolName, call.input, call.cwd),
    tokens: tokensFromChars(chars),
  };
}

export function summarizeFailure(
  call: Omit<ToolCall, 'response'> & { error: string },
): ToolSummary {
  return summarizeTool({ ...call, resultChars: call.resultChars ?? call.error.length });
}
