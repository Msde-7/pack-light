import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOKEN_HEADER } from '../core/protocol';
import { claimRepack } from '../core/store';
import { startServer, type PackLightServer } from '../server/index';
import { openBrowser } from '../server/open-browser';
import {
  API,
  demoSteps,
  TRAIL,
  type DemoAction,
  type DemoEventBody,
  type DemoSession,
} from './demo-script';

interface DemoArgs {
  open: boolean;
  loop: boolean;
  /** Leaves the pin and the repack to whoever is at the page. */
  interactive: boolean;
  speed: number;
  port?: number;
}

export function parseDemoArgs(args: readonly string[]): DemoArgs | string {
  const parsed: DemoArgs = { open: true, loop: false, interactive: false, speed: 1 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-open') parsed.open = false;
    else if (arg === '--loop') parsed.loop = true;
    else if (arg === '--interactive') parsed.interactive = true;
    else if (arg === '--speed' || arg === '--port') {
      const value = Number(args[++i]);
      if (!Number.isFinite(value) || value < 0) return `${arg} needs a number.`;
      if (arg === '--speed') parsed.speed = value || 1;
      else parsed.port = value;
    } else return `Unknown option "${arg ?? ''}".`;
  }
  return parsed;
}

const SESSIONS: Record<string, DemoSession> = {
  [TRAIL.sessionId]: TRAIL,
  [API.sessionId]: API,
};

/**
 * A real session pairs PostCompact with a compaction boundary in its transcript. The demo has
 * no transcript, so it writes the two records the tailer looks for, with made-up content.
 */
function writeCompaction(transcriptPath: string, when: number): void {
  const at = new Date(when).toISOString();
  const records = [
    {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: `demo-boundary-${at}`,
      timestamp: at,
      compactMetadata: { trigger: 'auto', preTokens: 163_000, postTokens: 17_000 },
    },
    {
      type: 'user',
      isCompactSummary: true,
      uuid: `demo-summary-${at}`,
      timestamp: at,
      message: {
        role: 'user',
        content: 'The user is fixing a 401 on token refresh. src/auth/middleware.ts holds the bug.',
      },
    },
  ];
  appendFileSync(transcriptPath, records.map(record => `${JSON.stringify(record)}\n`).join(''));
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Plays one scripted action against the server, the way the hooks and the page would. */
export async function performStep(
  server: PackLightServer,
  home: string,
  action: DemoAction,
  at = Date.now(),
): Promise<void> {
  const session = SESSIONS[action.sessionId] ?? TRAIL;
  const base = `http://127.0.0.1:${server.info.port}/api/sessions/${session.sessionId}`;
  const headers = { [TOKEN_HEADER]: server.info.token, 'content-type': 'application/json' };
  const transcript = join(home, `${session.sessionId}.jsonl`);
  switch (action.type) {
    case 'event':
      if (action.body.event === 'PostCompact') writeCompaction(transcript, at);
      await server.ingest({
        v: 1,
        sessionId: session.sessionId,
        transcriptPath: transcript,
        cwd: session.cwd,
        at,
        ...claimed(action.body, session),
      });
      if (action.body.event === 'PostCompact') await server.hub.tick();
      return;
    case 'pin':
      await fetch(`${base}/pins/${action.itemId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ note: action.note }),
      });
      return;
    case 'repack':
      await fetch(`${base}/repack`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ itemIds: action.itemIds }),
      });
      return;
  }
}

/** Like the real hook, a prompt carries whatever repacks are queued, however they got there. */
function claimed(body: DemoEventBody, session: DemoSession): DemoEventBody {
  if (body.event !== 'UserPromptSubmit') return body;
  const repackedIds = claimRepack(session.sessionId).map(entry => entry.itemId);
  return { ...body, repackedIds };
}

export async function hike(
  server: PackLightServer,
  home: string,
  speed: number,
  interactive = false,
): Promise<void> {
  for (const step of demoSteps({ interactive })) {
    await sleep(step.wait / speed);
    await performStep(server, home, step.action);
  }
}

export async function run(args: readonly string[]): Promise<number> {
  const options = parseDemoArgs(args);
  if (typeof options === 'string') {
    console.error(options);
    return 1;
  }
  // The demo never touches real sessions, pins or the running app.
  const home = mkdtempSync(join(tmpdir(), 'pack-light-demo-'));
  process.env.PACK_LIGHT_HOME = home;
  const server = await startServer({
    discoverMinutes: 0,
    ...(options.port === undefined ? {} : { port: options.port }),
  });
  const cleanup = (): void => {
    rmSync(home, { recursive: true, force: true });
  };
  process.once('exit', cleanup);
  process.once('SIGINT', () => {
    void server.close().finally(() => process.exit(0));
  });

  console.log(`Demo trail is open at ${server.url}`);
  console.log('Everything here is made up. Press Ctrl+C to stop.');
  if (options.interactive) console.log('Pin src/auth/middleware.ts before camp, then repack.');
  if (options.open) openBrowser(server.url);

  await hike(server, home, options.speed, options.interactive);
  while (options.loop) {
    await sleep(4000 / options.speed);
    for (const id of Object.keys(SESSIONS)) {
      server.removeSession(id);
      rmSync(join(home, `${id}.jsonl`), { force: true });
    }
    rmSync(join(home, 'sessions'), { recursive: true, force: true });
    await hike(server, home, options.speed, options.interactive);
  }

  console.log('The demo hike is done. The page stays up until you press Ctrl+C.');
  return 0;
}
