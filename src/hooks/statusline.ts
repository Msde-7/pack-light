import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { findTarget, readInstalled } from '../cli/_installed';
import { compactNumber, formatTokens, percent } from '../core/format';
import {
  getNumber,
  getObject,
  getString,
  isObject,
  parseJson,
  type JsonObject,
} from '../core/json';
import type { HookEvent } from '../core/protocol';
import { envelopeOf, postEvent, readStdin, runHook, writeOut } from './_shared';

/** Stays inside the hook's hard exit so a slow wrapped status line still prints nothing broken. */
const ORIGINAL_TIMEOUT_MS = 2500;

interface Usage {
  windowTokens: number;
  contextTokens?: number;
  model?: string;
}

function currentTokens(window: JsonObject): number | undefined {
  const usage = getObject(window, 'current_usage');
  if (usage) {
    return (
      (getNumber(usage, 'input_tokens') ?? 0) +
      (getNumber(usage, 'cache_creation_input_tokens') ?? 0) +
      (getNumber(usage, 'cache_read_input_tokens') ?? 0)
    );
  }
  const used = getNumber(window, 'used_percentage');
  const size = getNumber(window, 'context_window_size');
  return used === undefined || size === undefined ? undefined : (used / 100) * size;
}

function usageOf(input: JsonObject): Usage | undefined {
  const window = getObject(input, 'context_window');
  if (!window) return undefined;
  const windowTokens = getNumber(window, 'context_window_size');
  if (windowTokens === undefined || windowTokens <= 0) return undefined;
  const contextTokens = currentTokens(window);
  const model = getString(getObject(input, 'model'), 'id');
  return {
    windowTokens,
    ...(contextTokens === undefined ? {} : { contextTokens: Math.round(contextTokens) }),
    ...(model === undefined ? {} : { model }),
  };
}

function eventOf(input: JsonObject, usage: Usage | undefined): HookEvent | undefined {
  const envelope = envelopeOf(input);
  if (envelope === undefined || usage?.contextTokens === undefined) return undefined;
  return {
    ...envelope,
    event: 'StatusLine',
    windowTokens: usage.windowTokens,
    contextTokens: usage.contextTokens,
    ...(usage.model === undefined ? {} : { model: usage.model }),
  };
}

function ownLine(usage: Usage | undefined): string {
  if (usage?.contextTokens === undefined) return 'packlight';
  const { contextTokens, windowTokens } = usage;
  return `packlight ${percent(contextTokens / windowTokens)} ${formatTokens(contextTokens)}/${compactNumber(windowTokens)}`;
}

/** The settings file this status line was installed into arrives as the first argument. */
function originalCommand(): string | undefined {
  const settingsPath = process.argv[2];
  if (settingsPath === undefined) return undefined;
  const original = findTarget(readInstalled(), settingsPath)?.statusLine?.original;
  return getString(original, 'command');
}

/** Claude Code runs status lines through Git Bash on Windows when it can, so prefer it too. */
function shellFor(command: string): { file: string; args: string[]; shell: boolean } {
  const bash = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (process.platform === 'win32' && bash !== undefined && existsSync(bash)) {
    return { file: bash, args: ['-c', command], shell: false };
  }
  return { file: command, args: [], shell: true };
}

function runOriginal(command: string, stdin: string): Promise<string | undefined> {
  return new Promise(resolve => {
    const shell = shellFor(command);
    const child = spawn(shell.file, shell.args, {
      shell: shell.shell,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), ORIGINAL_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdin);
  });
}

runHook(async () => {
  const text = await readStdin();
  const parsed = parseJson(text);
  const input = isObject(parsed) ? parsed : {};
  const usage = usageOf(input);
  const event = eventOf(input, usage);
  const command = originalCommand();
  const [line] = await Promise.all([
    command === undefined ? ownLine(usage) : runOriginal(command, text),
    event === undefined ? undefined : postEvent(event),
  ]);
  await writeOut(line ?? ownLine(usage));
});
