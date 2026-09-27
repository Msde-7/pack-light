import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeJsonAtomic, writePins, writeRepack } from '../core/store';
import { TOKEN_HEADER } from '../core/protocol';

const HOOKS_SRC = fileURLToPath(new URL('.', import.meta.url));
const SECRET = 'SECRET-TOOL-OUTPUT-4f2a';
const TOKEN = 'test-token';
/** Node startup on Windows is slow and CI machines vary, so assertions leave headroom. */
const FAST_MS = 1000;

let outDir: string;
let home: string;
const timings = new Map<string, number[]>();

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

interface RunOptions {
  args?: string[];
  /** Feeds stdin from a file, the way a shell redirect does, instead of a pipe. */
  stdinFile?: boolean;
}

function runHook(name: string, input: unknown, options: RunOptions = {}): Promise<Run> {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  let stdinFd: number | undefined;
  if (options.stdinFile === true) {
    const file = join(home, `stdin-${name}.json`);
    writeFileSync(file, text);
    stdinFd = openSync(file, 'r');
  }
  return new Promise(resolve => {
    const started = performance.now();
    const child = spawn(process.execPath, [join(outDir, `${name}.js`), ...(options.args ?? [])], {
      env: { ...process.env, PACK_LIGHT_HOME: home },
      stdio: [stdinFd ?? 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', code => {
      if (stdinFd !== undefined) closeSync(stdinFd);
      const ms = Math.round(performance.now() - started);
      timings.set(name, [...(timings.get(name) ?? []), ms]);
      resolve({ code, stdout, stderr, ms });
    });
    child.stdin?.end(text);
  });
}

interface Received {
  token: string | undefined;
  body: string;
}

let server: Server | undefined;
let received: Received[];

function startServer(respond: boolean): Promise<void> {
  received = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const token = req.headers[TOKEN_HEADER];
      received.push({ token: typeof token === 'string' ? token : undefined, body });
      if (respond) res.end('{}');
    });
  });
  return new Promise(resolve => {
    server!.listen(0, '127.0.0.1', () => {
      const { port } = server!.address() as AddressInfo;
      writeJsonAtomic(join(home, 'server.json'), { port, token: TOKEN, pid: 1, startedAt: 1 });
      resolve();
    });
  });
}

function stopServer(): Promise<void> {
  const current = server;
  server = undefined;
  if (current === undefined) return Promise.resolve();
  current.closeAllConnections();
  return new Promise(resolve =>
    current.close(() => {
      resolve();
    }),
  );
}

function events(): Record<string, unknown>[] {
  return received.map(entry => JSON.parse(entry.body) as Record<string, unknown>);
}

const base = {
  session_id: 'sess-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
};

const INPUTS: Record<string, Record<string, unknown>> = {
  'session-start': {
    ...base,
    hook_event_name: 'SessionStart',
    source: 'startup',
    model: 'claude-opus-5[1m]',
  },
  'user-prompt-submit': {
    ...base,
    hook_event_name: 'UserPromptSubmit',
    prompt: `please ${SECRET}`,
  },
  'post-tool-use': {
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_use_id: 'toolu_1',
    tool_input: { file_path: '/repo/src/a.ts' },
    tool_response: {
      type: 'text',
      file: { filePath: '/repo/src/a.ts', content: SECRET.repeat(100), numLines: 3 },
    },
  },
  'post-tool-use-failure': {
    ...base,
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    tool_use_id: 'toolu_2',
    tool_input: { command: 'npm test' },
    error: `Exit code 1\n${SECRET}`,
    is_interrupt: false,
  },
  'subagent-start': {
    ...base,
    hook_event_name: 'SubagentStart',
    agent_id: 'a1',
    agent_type: 'Explore',
  },
  'subagent-stop': {
    ...base,
    hook_event_name: 'SubagentStop',
    agent_id: 'a1',
    agent_type: 'Explore',
    agent_transcript_path: '/tmp/a1.jsonl',
    last_assistant_message: SECRET,
  },
  'instructions-loaded': {
    ...base,
    hook_event_name: 'InstructionsLoaded',
    file_path: fileURLToPath(import.meta.url),
    load_reason: 'session_start',
  },
  notification: {
    ...base,
    hook_event_name: 'Notification',
    notification_type: 'permission_prompt',
    message: SECRET,
  },
  stop: { ...base, hook_event_name: 'Stop', last_assistant_message: SECRET },
  'pre-compact': {
    ...base,
    hook_event_name: 'PreCompact',
    trigger: 'manual',
    custom_instructions: SECRET,
  },
  'post-compact': {
    ...base,
    hook_event_name: 'PostCompact',
    trigger: 'auto',
    compact_summary: `Worked on src/a.ts. ${SECRET}`,
  },
  'session-end': { ...base, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' },
};

const OBSERVERS = Object.keys(INPUTS).filter(name => !['user-prompt-submit'].includes(name));

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'packlight-hooks-'));
  const entries = readdirSync(HOOKS_SRC)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.startsWith('_'))
    .map(file => join(HOOKS_SRC, file));
  await build({
    entryPoints: entries,
    outdir: outDir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    minify: true,
    logLevel: 'warning',
  });
  writeFileSync(join(outDir, 'package.json'), '{"type":"module"}\n');
}, 30_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
  const report = [...timings].map(([name, ms]) => `${name} ${ms.join('/')}ms`).join(', ');
  console.warn(`hook wall times ${report}`);
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'packlight-hookhome-'));
});

afterEach(async () => {
  await stopServer();
  rmSync(home, { recursive: true, force: true });
});

describe('without a server', () => {
  it.each(OBSERVERS)('%s exits 0 fast and prints nothing', async name => {
    const run = await runHook(name, INPUTS[name]);
    expect(run).toMatchObject({ code: 0, stdout: '', stderr: '' });
    expect(run.ms).toBeLessThan(FAST_MS);
  });

  it.each(['post-tool-use', 'session-start', 'user-prompt-submit', 'statusline'])(
    '%s survives garbage input',
    async name => {
      for (const input of ['', 'not json', '[]', '{"session_id": 3}', '{"session_id":"../../x"}']) {
        const run = await runHook(name, input);
        expect(run.code).toBe(0);
        expect(run.stderr).toBe('');
        if (name !== 'statusline') expect(run.stdout).toBe('');
      }
    },
  );

  it('session-start prints valid pin context after compaction', async () => {
    writePinsIn(home);
    const run = await runHook('session-start', { ...INPUTS['session-start'], source: 'compact' });
    expect(run.code).toBe(0);
    const output = JSON.parse(run.stdout) as { hookSpecificOutput: Record<string, unknown> };
    expect(Object.keys(output)).toEqual(['hookSpecificOutput']);
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
    const context = output.hookSpecificOutput.additionalContext;
    expect(typeof context).toBe('string');
    expect(context).toContain('File src/a.ts was read before compaction. User note: keep this');
    expect(run.ms).toBeLessThan(FAST_MS);
  });

  it('session-start prints nothing after compaction without pins, or on startup', async () => {
    expect(
      (await runHook('session-start', { ...INPUTS['session-start'], source: 'compact' })).stdout,
    ).toBe('');
    writePinsIn(home);
    expect((await runHook('session-start', INPUTS['session-start'])).stdout).toBe('');
  });

  it('user-prompt-submit injects the repack queue exactly once', async () => {
    withHome(home, () => {
      writeRepack('sess-1', [
        { itemId: 'i9', kind: 'file_read', label: 'src/x.ts', note: 'the parser' },
      ]);
    });
    const first = await runHook('user-prompt-submit', INPUTS['user-prompt-submit']);
    const output = JSON.parse(first.stdout) as { hookSpecificOutput: Record<string, unknown> };
    expect(output.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(output.hookSpecificOutput.additionalContext).toContain('file src/x.ts');
    expect(existsSync(join(home, 'sessions', 'sess-1', 'repack.json'))).toBe(false);
    const second = await runHook('user-prompt-submit', INPUTS['user-prompt-submit']);
    expect(second).toMatchObject({ code: 0, stdout: '' });
  });
});

function withHome(dir: string, body: () => void): void {
  const previous = process.env.PACK_LIGHT_HOME;
  process.env.PACK_LIGHT_HOME = dir;
  try {
    body();
  } finally {
    if (previous === undefined) delete process.env.PACK_LIGHT_HOME;
    else process.env.PACK_LIGHT_HOME = previous;
  }
}

function writePinsIn(dir: string): void {
  withHome(dir, () => {
    writePins('sess-1', [
      {
        itemId: 'pin-a',
        kind: 'file_read',
        label: 'src/a.ts',
        path: '/repo/src/a.ts',
        note: 'keep this',
        pinnedAt: 1,
      },
      {
        itemId: 'pin-b',
        kind: 'file_read',
        label: 'src/zzz.ts',
        path: '/repo/src/zzz.ts',
        pinnedAt: 2,
      },
    ]);
  });
}

describe('with a server', () => {
  beforeEach(() => startServer(true));

  it.each(Object.keys(INPUTS))(
    '%s posts its event with the token and no raw content',
    async name => {
      const run = await runHook(name, INPUTS[name]);
      expect(run).toMatchObject({ code: 0, stderr: '' });
      expect(received).toHaveLength(1);
      expect(received[0]?.token).toBe(TOKEN);
      expect(received[0]?.body).not.toContain(SECRET);
      const [event] = events();
      expect(event).toMatchObject({
        v: 1,
        sessionId: 'sess-1',
        cwd: '/repo',
        transcriptPath: '/tmp/t.jsonl',
      });
      expect(event?.event).toBe(INPUTS[name]?.hook_event_name);
    },
  );

  it('post-tool-use sends a size and label', async () => {
    await runHook('post-tool-use', INPUTS['post-tool-use']);
    expect(events()[0]).toMatchObject({
      event: 'PostToolUse',
      tool: { toolUseId: 'toolu_1', toolName: 'Read', kind: 'file_read', label: 'src/a.ts' },
    });
    const tool = events()[0]?.tool as { tokens: number };
    expect(tool.tokens).toBeGreaterThan(500);
  });

  it('user-prompt-submit sends the prompt length and repacked ids', async () => {
    withHome(home, () => {
      writeRepack('sess-1', [{ itemId: 'i9', kind: 'file_read', label: 'src/x.ts' }]);
    });
    await runHook('user-prompt-submit', INPUTS['user-prompt-submit']);
    expect(events()[0]).toMatchObject({
      promptChars: `please ${SECRET}`.length,
      repackedIds: ['i9'],
    });
  });

  it('post-compact sends only the pins the summary mentions', async () => {
    writePinsIn(home);
    await runHook('post-compact', INPUTS['post-compact']);
    expect(events()[0]).toMatchObject({
      event: 'PostCompact',
      trigger: 'auto',
      mentionedPinIds: ['pin-a'],
    });
  });

  it('subagent-stop ignores internal agents with an empty type', async () => {
    await runHook('subagent-stop', { ...INPUTS['subagent-stop'], agent_type: '' });
    expect(received).toEqual([]);
  });

  it('subagent-stop and instructions-loaded send sizes', async () => {
    await runHook('subagent-stop', INPUTS['subagent-stop']);
    await runHook('instructions-loaded', INPUTS['instructions-loaded']);
    expect(events()[0]).toMatchObject({
      reportChars: SECRET.length,
      agentTranscriptPath: '/tmp/a1.jsonl',
    });
    expect(events()[1]).toMatchObject({ loadReason: 'session_start' });
    expect(events()[1]?.chars).toBeGreaterThan(1000);
  });
});

describe('with a server that never answers', () => {
  beforeEach(() => startServer(false));

  it.each(['post-tool-use', 'user-prompt-submit', 'stop'])(
    '%s gives up after the network timeout',
    async name => {
      const run = await runHook(name, INPUTS[name]);
      expect(run).toMatchObject({ code: 0, stderr: '' });
      expect(received).toHaveLength(1);
      expect(run.ms).toBeLessThan(300 + FAST_MS);
    },
  );

  it('session-start after compaction prints pins and finishes quickly', async () => {
    writePinsIn(home);
    const run = await runHook('session-start', { ...INPUTS['session-start'], source: 'compact' });
    expect(run.stdout).toContain('additionalContext');
    expect(run.ms).toBeLessThan(50 + FAST_MS);
  });
});

describe('statusline', () => {
  const statusInput = {
    ...base,
    model: { id: 'claude-opus-5[1m]', display_name: 'Opus' },
    context_window: {
      context_window_size: 1_000_000,
      used_percentage: 14,
      current_usage: {
        input_tokens: 2000,
        cache_creation_input_tokens: 40_000,
        cache_read_input_tokens: 100_000,
      },
    },
  };

  it('prints a short line and posts the usage', async () => {
    await startServer(true);
    const run = await runHook('statusline', statusInput);
    expect(run).toMatchObject({ code: 0, stdout: 'packlight 14% ≈142K/1M' });
    expect(events()[0]).toMatchObject({
      event: 'StatusLine',
      windowTokens: 1_000_000,
      contextTokens: 142_000,
      model: 'claude-opus-5[1m]',
    });
  });

  it('works with stdin redirected from a file', async () => {
    const run = await runHook('statusline', statusInput, { stdinFile: true });
    expect(run).toMatchObject({ code: 0, stdout: 'packlight 14% ≈142K/1M' });
    writePinsIn(home);
    const compact = { ...INPUTS['session-start'], source: 'compact' };
    const started = await runHook('session-start', compact, { stdinFile: true });
    expect(started.stdout).toContain('additionalContext');
  });

  it('prints a plain name before the first response', async () => {
    const run = await runHook('statusline', {
      ...statusInput,
      context_window: { context_window_size: 200_000, used_percentage: null, current_usage: null },
    });
    expect(run.stdout).toBe('packlight');
  });

  it('runs the original status line with the same stdin', async () => {
    const settingsPath = join(home, 'settings.json');
    const echo =
      "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write('wrapped '+JSON.parse(s).session_id))";
    mkdirSync(home, { recursive: true });
    writeJsonAtomic(join(home, 'installed.json'), {
      v: 1,
      hooksDir: outDir,
      targets: [
        {
          settingsPath,
          entries: [],
          createdEvents: [],
          createdHooksKey: false,
          statusLine: {
            ours: { type: 'command', command: 'x' },
            original: { type: 'command', command: `node -e "${echo}"` },
          },
        },
      ],
    });
    const run = await runHook('statusline', statusInput, {
      args: [settingsPath.replace(/\\/g, '/')],
    });
    expect(run.code).toBe(0);
    expect(run.stdout.trim()).toBe('wrapped sess-1');
  });
});
