import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../core/config';
import { fixturePath } from '../core/fixtures';
import { paths } from '../core/paths';
import { writePins } from '../core/store';
import { TOKEN_HEADER, type HookEvent } from '../core/protocol';
import type { SessionState } from '../core/types';
import { startServer, type PackLightServer } from './index';

let home: string;
let server: PackLightServer;
let base: string;
let token: string;
let sourceFile: string;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'packlight-server-'));
  process.env.PACK_LIGHT_HOME = join(home, 'data');
  const web = join(home, 'web');
  mkdirSync(web);
  writeFileSync(join(web, 'index.html'), '<!doctype html><script src="app.js"></script>');
  writeFileSync(join(web, 'app.js'), 'console.log(1)');
  writeFileSync(join(home, 'secret.txt'), 'nope');
  sourceFile = join(home, 'code.ts');
  writeFileSync(sourceFile, Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n'));
  server = await startServer({
    webRoot: web,
    discoverMinutes: 0,
    tickMs: 50,
    settings: { config: DEFAULT_CONFIG, claude: { disable1m: false } },
  });
  base = `http://127.0.0.1:${server.info.port}`;
  token = server.info.token;
});

afterAll(async () => {
  await server.close();
  delete process.env.PACK_LIGHT_HOME;
  rmSync(home, { recursive: true, force: true });
});

function api(path: string, init: { method?: string; body?: string } = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { [TOKEN_HEADER]: token, 'content-type': 'application/json' },
  });
}

function raw(path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.info.port, path, headers }, res => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

function hookEvent(sessionId: string, body: Record<string, unknown>): HookEvent {
  return {
    v: 1,
    sessionId,
    transcriptPath: '',
    cwd: home,
    at: Date.now(),
    ...body,
  } as HookEvent;
}

async function post(sessionId: string, body: Record<string, unknown>): Promise<number> {
  const response = await api('/events', {
    method: 'POST',
    body: JSON.stringify(hookEvent(sessionId, body)),
  });
  return response.status;
}

async function sessions(): Promise<SessionState[]> {
  return (await (await api('/api/sessions')).json()) as SessionState[];
}

async function waitFor<T>(
  read: () => Promise<T | undefined> | T | undefined,
  ms = 1000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error('timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function session(id: string): Promise<SessionState | undefined> {
  return (await sessions()).find(s => s.sessionId === id);
}

const readTool = (id: string, path: string) => ({
  event: 'PostToolUse',
  tool: { toolUseId: id, toolName: 'Read', kind: 'file_read', label: 'code.ts', path, tokens: 900 },
});

describe('auth and host checks', () => {
  it('needs the token, by header or query', async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(401);
    const wrong = await fetch(`${base}/api/health`, { headers: { [TOKEN_HEADER]: 'x' } });
    expect(wrong.status).toBe(401);
    const good = await api('/api/health');
    expect(await good.json()).toMatchObject({ ok: true });
    expect((await fetch(`${base}/api/health?token=${token}`)).status).toBe(200);
  });

  it('rejects foreign Host and Origin headers', async () => {
    const port = server.info.port;
    expect(await raw('/api/health', { host: `evil.test:${port}`, [TOKEN_HEADER]: token })).toBe(
      403,
    );
    expect(await raw('/', { host: `127.0.0.1:${port + 1}` })).toBe(403);
    expect(await raw('/api/health', { host: `localhost:${port}`, [TOKEN_HEADER]: token })).toBe(
      200,
    );
    const origin = { host: `127.0.0.1:${port}`, origin: 'http://evil.test', [TOKEN_HEADER]: token };
    expect(await raw('/api/health', origin)).toBe(403);
  });

  it('rejects malformed events', async () => {
    const response = await api('/events', { method: 'POST', body: '{"v":1,"event":"Stop"}' });
    expect(response.status).toBe(400);
  });
});

describe('static files', () => {
  it('serves the app with a strict CSP and no token in the HTML', async () => {
    const page = await fetch(`${base}/`);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await page.text()).not.toContain(token);
    const script = await fetch(`${base}/app.js`);
    expect(script.headers.get('content-type')).toContain('text/javascript');
  });

  it('refuses to leave the web root', async () => {
    const host = { host: `127.0.0.1:${server.info.port}` };
    expect(await raw('/%2e%2e/secret.txt', host)).toBe(404);
    expect(await raw('/..%5csecret.txt', host)).toBe(404);
    expect(await raw('/.hidden', host)).toBe(404);
  });
});

describe('events and stream', () => {
  it('sends a snapshot, then the session within 1 s of a tool call', async () => {
    const received: string[] = [];
    const controller = new AbortController();
    const stream = await fetch(`${base}/api/stream?token=${token}`, { signal: controller.signal });
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        received.push(decoder.decode(value));
      }
    })().catch(() => undefined);

    await waitFor(() => (received.join('').includes('event: snapshot') ? true : undefined));
    const started = Date.now();
    expect(await post('s-stream', readTool('t1', sourceFile))).toBe(204);
    await waitFor(() => (received.join('').includes('"cue":"item_added"') ? true : undefined));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(received.join('')).toContain('event: session');
    expect(received.join('')).not.toContain('line 1');
    controller.abort();
    await pump;
  });

  it('builds a session from its transcript when a hook names it', async () => {
    const transcript = join(home, 'trail.jsonl');
    writeFileSync(transcript, readFileSync(fixturePath('trail.jsonl')));
    const event = { event: 'SessionStart', source: 'startup', transcriptPath: transcript };
    await api('/events', {
      method: 'POST',
      body: JSON.stringify({ ...hookEvent('s-trail', event), transcriptPath: transcript }),
    });
    const state = await waitFor(async () => {
      const s = await session('s-trail');
      return s && s.items.length > 5 ? s : undefined;
    });
    expect(state.contextTokens).toBe(65_002);
    expect(state.compactions).toHaveLength(1);

    const resumed = {
      ...hookEvent('s-trail', { event: 'SessionStart', source: 'resume' }),
      transcriptPath: transcript,
    };
    await api('/events', { method: 'POST', body: JSON.stringify(resumed) });
    await new Promise(resolve => setTimeout(resolve, 150));
    const rebuilt = await session('s-trail');
    expect(rebuilt?.items.map(i => i.id)).toEqual(state.items.map(i => i.id));
  });

  it('follows a companion transcript for its own context size', async () => {
    const transcript = join(home, 'trail2.jsonl');
    writeFileSync(transcript, readFileSync(fixturePath('trail.jsonl')));
    const agentDir = join(home, 'trail2', 'subagents');
    mkdirSync(agentDir, { recursive: true });
    const usage = {
      input_tokens: 1,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 10_000,
    };
    const record = {
      type: 'assistant',
      agentId: 'a0fixture01',
      uuid: 'u',
      message: { model: 'claude-opus-5', usage },
    };
    writeFileSync(
      join(agentDir, 'agent-a0fixture01.jsonl'),
      `${JSON.stringify(record)}
`,
    );
    const event = { ...hookEvent('s-agents', { event: 'Stop' }), transcriptPath: transcript };
    await api('/events', { method: 'POST', body: JSON.stringify(event) });
    const companion = await waitFor(async () => {
      const found = (await session('s-agents'))?.subagents.a0fixture01;
      return found?.contextTokens === undefined ? undefined : found;
    });
    expect(companion.contextTokens).toBe(12_001);
  });
});

describe('pins and excerpts', () => {
  const id = 's-pins';
  let itemId: string;

  beforeAll(async () => {
    await post(id, readTool('p1', sourceFile));
    await post(id, {
      event: 'PostToolUse',
      tool: { toolUseId: 'p2', toolName: 'Bash', kind: 'bash_output', label: 'ls', tokens: 5 },
    });
    const state = await waitFor(async () => {
      const s = await session(id);
      return s?.items.length === 2 ? s : undefined;
    });
    itemId = state.items[0]!.id;
  });

  it('writes pins to disk and shows them in the session', async () => {
    const put = await api(`/api/sessions/${id}/pins/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ note: 'the bug lives here', snippet: 'line 1' }),
    });
    expect(put.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(paths.pins(id), 'utf8')) as { pins: unknown[] };
    expect(onDisk.pins).toEqual([expect.objectContaining({ itemId, note: 'the bug lives here' })]);
    const state = await session(id);
    expect(state?.items[0]).toMatchObject({ status: 'pinned', note: 'the bug lives here' });
    expect(state?.pins).toHaveLength(1);
  });

  it('validates notes and snippets', async () => {
    const long = await api(`/api/sessions/${id}/pins/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ note: 'x'.repeat(281) }),
    });
    expect(long.status).toBe(400);
    const bash = (await session(id))!.items[1]!.id;
    const snippet = await api(`/api/sessions/${id}/pins/${bash}`, {
      method: 'PUT',
      body: JSON.stringify({ snippet: 'x' }),
    });
    expect(snippet.status).toBe(400);
    const missing = await api(`/api/sessions/${id}/pins/nope`, { method: 'PUT', body: '{}' });
    expect(missing.status).toBe(404);
  });

  it('orders and removes pins', async () => {
    const bash = (await session(id))!.items[1]!.id;
    await api(`/api/sessions/${id}/pins/${bash}`, { method: 'PUT', body: '{}' });
    const order = await api(`/api/sessions/${id}/pins-order`, {
      method: 'PUT',
      body: JSON.stringify({ itemIds: [bash] }),
    });
    const { pins } = (await order.json()) as { pins: { itemId: string }[] };
    expect(pins.map(p => p.itemId)).toEqual([bash, itemId]);
    await api(`/api/sessions/${id}/pins/${bash}`, { method: 'DELETE' });
    expect((await session(id))?.pins.map(p => p.itemId)).toEqual([itemId]);
  });

  it('notices pins changed on disk by another process', async () => {
    writePins(id, []);
    const cleared = await waitFor(async () => {
      const s = await session(id);
      return s?.pins.length === 0 ? s : undefined;
    });
    expect(cleared.items[0]?.status).toBe('carried');
  });

  it('forgets a removed session', async () => {
    await server.ingest(hookEvent('s-gone', { event: 'Stop' }));
    expect(await session('s-gone')).toBeDefined();
    server.removeSession('s-gone');
    expect(await session('s-gone')).toBeUndefined();
  });

  it('only repacks dropped items', async () => {
    const response = await api(`/api/sessions/${id}/repack`, {
      method: 'POST',
      body: JSON.stringify({ itemIds: [itemId] }),
    });
    expect(response.status).toBe(400);
  });

  it('serves up to 200 lines of files this session read, and nothing else', async () => {
    const excerpt = await api(`/api/sessions/${id}/items/${itemId}/excerpt?start=10&end=900`);
    const body = (await excerpt.json()) as {
      start: number;
      end: number;
      text: string;
      totalLines: number;
    };
    expect(body).toMatchObject({ start: 10, end: 209, totalLines: 500 });
    expect(body.text.split('\n')[0]).toBe('line 10');
    const bash = (await session(id))!.items[1]!.id;
    expect((await api(`/api/sessions/${id}/items/${bash}/excerpt`)).status).toBe(400);
    expect((await api(`/api/sessions/${id}/items/unknown/excerpt`)).status).toBe(404);
    expect((await api(`/api/sessions/other/items/${itemId}/excerpt`)).status).toBe(404);
  });
});
