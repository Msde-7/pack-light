import { baseName } from './ids';
import type { ItemKind, Pin, RepackEntry } from './types';
import { LIMITS } from './types';

const LABEL_MAX = 200;
const COMPACT_NOTE_MAX = 120;
const MIN_MENTION_CHARS = 4;
const SNIPPET_INDENT = '  ';

const PIN_HEADER =
  'Context carried over from before compaction (pinned by the user in Pack Light):';
const PIN_FOOTER = 'These files can be re-read if their current contents are needed.';
const REPACK_HEADER = 'Context the user asked to bring back:';
const COMPACT_PREFIX = '/compact Preserve: ';

const FILE_KINDS: ReadonlySet<ItemKind> = new Set(['file_read', 'edit', 'instructions']);

function isInvisible(code: number): boolean {
  if (code < 0x20) return code !== 0x0a && code !== 0x09;
  return (
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function stripInvisible(text: string): string {
  let out = '';
  for (const char of text) {
    if (!isInvisible(char.codePointAt(0) ?? 0)) out += char;
  }
  return out;
}

export interface SanitizeOptions {
  /** Keeps line breaks and indentation, for verbatim snippets. */
  keepNewlines?: boolean;
}

/**
 * Makes user text safe to inject. Control, bidi and zero-width characters go, since they can
 * hide text from the user. Whitespace collapses, except that snippets keep their lines.
 */
export function sanitize(text: string, options: SanitizeOptions = {}): string {
  const clean = stripInvisible(text.replace(/\r\n?/g, '\n'));
  if (options.keepNewlines !== true) return clean.replace(/\s+/g, ' ').trim();
  return clean
    .replace(/\t/g, '  ')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function oneLine(text: string | undefined, max: number): string {
  return text === undefined ? '' : clip(sanitize(text), max);
}

/** Backticks would break the inline code span the label sits in. */
function codeSpan(text: string): string {
  return `\`${text.replace(/`/g, "'")}\``;
}

function forwardSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

/** The item's name without the tool prefix the estimator adds, such as "edit: ". */
function subjectOf(entry: { kind: ItemKind; label: string; path?: string }): string {
  const label = entry.kind === 'edit' ? entry.label.replace(/^\w+: /, '') : entry.label;
  if (label.endsWith('…') && entry.path !== undefined) {
    return oneLine(forwardSlashes(entry.path), LABEL_MAX);
  }
  return oneLine(label, LABEL_MAX);
}

function webQuery(subject: string): string | undefined {
  return subject.startsWith('search: ') ? subject.slice('search: '.length) : undefined;
}

function linesPhrase(range: string | undefined): string {
  if (range === undefined) return '';
  const [start, end] = range.split('-');
  if (start === undefined || start === '') return '';
  return end === undefined || end === '' ? ` (from line ${start})` : ` (lines ${start}-${end})`;
}

function pinSentence(kind: ItemKind, subject: string, lines: string): string {
  switch (kind) {
    case 'file_read':
      return `File ${subject}${lines} was read before compaction.`;
    case 'edit':
      return `File ${subject} was edited before compaction.`;
    case 'bash_output':
      return `Command ${codeSpan(subject)} was run before compaction.`;
    case 'search':
      return `Search ${codeSpan(subject)} was run before compaction.`;
    case 'web': {
      const query = webQuery(subject);
      return query === undefined
        ? `Web page ${subject} was fetched before compaction.`
        : `Web search ${codeSpan(query)} was run before compaction.`;
    }
    case 'subagent_report':
      return `Subagent report "${subject}" was received before compaction.`;
    case 'mcp':
      return `Tool call ${subject} was made before compaction.`;
    case 'instructions':
      return `Instructions file ${subject} was loaded before compaction.`;
    case 'user_prompt':
      return `User prompt "${subject}" was sent before compaction.`;
    case 'other':
      return `Item ${subject} was in context before compaction.`;
  }
}

function excerptSource(kind: ItemKind, subject: string): string {
  if (kind === 'bash_output') return `the output of command ${codeSpan(subject)}`;
  if (kind === 'search') return `the results of search ${codeSpan(subject)}`;
  return subject;
}

function indent(snippet: string): string {
  return snippet
    .split('\n')
    .map(line => (line === '' ? '' : `${SNIPPET_INDENT}${line}`))
    .join('\n');
}

function pinBullet(pin: Pin): string | undefined {
  const subject = subjectOf(pin);
  const note = oneLine(pin.note, LIMITS.noteChars);
  const snippet = clip(sanitize(pin.snippet ?? '', { keepNewlines: true }), LIMITS.snippetChars);
  const noteText = note === '' ? '' : `User note: ${note}`;

  if (snippet !== '' && subject !== '') {
    const head = `Kept excerpt from ${excerptSource(pin.kind, subject)}${linesPhrase(pin.range)}`;
    const intro = noteText === '' ? `${head}:` : `${head}. ${noteText}`;
    return `- ${intro}\n${indent(snippet)}`;
  }
  if (subject === '') return noteText === '' ? undefined : `- ${noteText}`;
  const sentence = pinSentence(pin.kind, subject, linesPhrase(pin.range));
  return noteText === '' ? `- ${sentence}` : `- ${sentence} ${noteText}`;
}

function omittedLine(count: number, noun: string): string {
  return count === 1
    ? `1 lower-priority ${noun} was left out to stay under the size limit.`
    : `${count} lower-priority ${noun}s were left out to stay under the size limit.`;
}

interface Section<T> {
  entry: T;
  text: string;
}

interface Fitted<T> {
  text: string;
  included: T[];
}

/**
 * Keeps the longest prefix of sections that fits the budget, so trimming always removes the
 * lowest-priority entries first, and notes how many were left out.
 */
function fitPrefix<T>(
  sections: readonly Section<T>[],
  render: (kept: readonly Section<T>[], omitted: number) => string,
  budget: number,
): Fitted<T> | undefined {
  for (let count = sections.length; count > 0; count--) {
    const kept = sections.slice(0, count);
    const text = render(kept, sections.length - count);
    if (text.length <= budget) return { text, included: kept.map(section => section.entry) };
  }
  return undefined;
}

function sectionsOf<T>(entries: readonly T[], bullet: (entry: T) => string | undefined) {
  const sections: Section<T>[] = [];
  for (const entry of entries) {
    const text = bullet(entry);
    if (text !== undefined) sections.push({ entry, text });
  }
  return sections;
}

/** Pin injection with the entries that fit, highest priority first. */
export function packPins(pins: readonly Pin[]): Fitted<Pin> | undefined {
  const render = (kept: readonly Section<Pin>[], omitted: number): string => {
    const lines = [PIN_HEADER, ...kept.map(section => section.text)];
    if (omitted > 0) lines.push(omittedLine(omitted, 'pin'));
    if (kept.some(section => FILE_KINDS.has(section.entry.kind))) lines.push(PIN_FOOTER);
    return lines.join('\n');
  };
  return fitPrefix(sectionsOf(pins, pinBullet), render, LIMITS.injectionChars);
}

/** The SessionStart(compact) additionalContext, or undefined when there is nothing to carry. */
export function buildPinContext(pins: readonly Pin[]): string | undefined {
  return packPins(pins)?.text;
}

function repackPhrase(kind: ItemKind, subject: string): string {
  switch (kind) {
    case 'file_read':
      return `file ${subject} (read earlier in this session, can be re-read if needed)`;
    case 'edit':
      return `file ${subject} (edited earlier in this session, can be re-read if needed)`;
    case 'instructions':
      return `instructions file ${subject} (loaded earlier in this session, can be re-read if needed)`;
    case 'bash_output':
      return `command ${codeSpan(subject)} (run earlier in this session, can be run again if needed)`;
    case 'search':
      return `search ${codeSpan(subject)} (run earlier in this session, can be run again if needed)`;
    case 'web': {
      const query = webQuery(subject);
      return query === undefined
        ? `web page ${subject} (fetched earlier in this session, can be fetched again if needed)`
        : `web search ${codeSpan(query)} (run earlier in this session, can be run again if needed)`;
    }
    case 'subagent_report':
      return `subagent report "${subject}" (received earlier in this session)`;
    case 'mcp':
      return `tool call ${subject} (made earlier in this session)`;
    case 'user_prompt':
      return `user prompt "${subject}" (sent earlier in this session)`;
    case 'other':
      return `item ${subject} (from earlier in this session)`;
  }
}

function repackBullet(entry: RepackEntry): string | undefined {
  const subject = subjectOf(entry);
  const note = oneLine(entry.note, LIMITS.noteChars);
  if (subject === '') return note === '' ? undefined : `- note: ${note}`;
  const phrase = repackPhrase(entry.kind, subject);
  return note === '' ? `- ${phrase}` : `- ${phrase}; note: ${note}`;
}

/** Repack injection with the entries that fit, in queue order. */
export function packRepack(entries: readonly RepackEntry[]): Fitted<RepackEntry> | undefined {
  const render = (kept: readonly Section<RepackEntry>[], omitted: number): string => {
    const lines = [REPACK_HEADER, ...kept.map(section => section.text)];
    if (omitted > 0) lines.push(omittedLine(omitted, 'item'));
    return lines.join('\n');
  };
  return fitPrefix(sectionsOf(entries, repackBullet), render, LIMITS.injectionChars);
}

function compactPhrase(pin: Pin): string | undefined {
  const subject = subjectOf(pin);
  const note = oneLine(pin.note, COMPACT_NOTE_MAX);
  if (subject === '') return note === '' ? undefined : note;
  const lines = linesPhrase(pin.range);
  const base = pin.kind === 'bash_output' ? `output of ${codeSpan(subject)}` : `${subject}${lines}`;
  return note === '' ? base : `${base} (${note})`;
}

/** A one-line `/compact` command naming the pins, for the user to paste before a manual compaction. */
export function buildCompactCommand(pins: readonly Pin[]): string | undefined {
  const render = (kept: readonly Section<Pin>[]): string =>
    `${COMPACT_PREFIX}${kept.map(section => section.text).join(', ')}`;
  return fitPrefix(sectionsOf(pins, compactPhrase), render, LIMITS.compactCommandChars)?.text;
}

function mentionTokens(pin: Pin): string[] {
  const tokens: string[] = [];
  if (pin.path !== undefined && pin.path !== '') {
    const path = forwardSlashes(pin.path);
    tokens.push(path, baseName(path));
  }
  if (!pin.label.endsWith('…')) {
    const subject = subjectOf(pin);
    tokens.push(subject, webQuery(subject) ?? '');
    if (FILE_KINDS.has(pin.kind)) tokens.push(baseName(forwardSlashes(subject)));
  }
  const usable = tokens
    .map(token => token.toLowerCase().trim())
    .filter(token => token.length >= MIN_MENTION_CHARS);
  return [...new Set(usable)];
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[a-z0-9_]/.test(char);
}

/** True when the token appears in the text as a whole word, so "a.ts" does not match "data.ts". */
function containsToken(text: string, token: string): boolean {
  for (let at = text.indexOf(token); at !== -1; at = text.indexOf(token, at + 1)) {
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + token.length])) return true;
  }
  return false;
}

/** Ids of the pins the compaction summary names by path, file name or label. */
export function mentionedPinIds(pins: readonly Pin[], summary: string): string[] {
  const text = forwardSlashes(summary).toLowerCase();
  return pins
    .filter(pin => mentionTokens(pin).some(token => containsToken(text, token)))
    .map(pin => pin.itemId);
}
