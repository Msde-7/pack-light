import { request } from 'node:http';
import { getString, isObject, parseJson, type JsonObject } from '../core/json';
import { TOKEN_HEADER, type CompactTrigger, type HookEvent } from '../core/protocol';
import { readServerInfo } from '../core/store';

const NETWORK_TIMEOUT_MS = 300;
const STDIN_TIMEOUT_MS = 500;
/** Last resort so a stuck handle can never keep a hook alive. */
const HARD_EXIT_MS = 3000;

/** Resolves with whatever arrived when stdin ends or the timeout passes, whichever is first. */
export function readStdin(timeoutMs = STDIN_TIMEOUT_MS): Promise<string> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    const finish = (): void => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      // Destroy works for pipes and for file redirects, which have no unref.
      process.stdin.destroy();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.once('end', finish);
    process.stdin.once('error', finish);
  });
}

/** The fields every HookEvent shares. Undefined when the input lacks a session id. */
export function envelopeOf(input: JsonObject): Envelope | undefined {
  const sessionId = getString(input, 'session_id');
  if (sessionId === undefined || sessionId === '') return undefined;
  const agentId = getString(input, 'agent_id');
  const agentType = getString(input, 'agent_type');
  return {
    v: 1,
    sessionId,
    transcriptPath: getString(input, 'transcript_path') ?? '',
    cwd: getString(input, 'cwd') ?? '',
    ...(agentId === undefined ? {} : { agentId }),
    ...(agentType === undefined ? {} : { agentType }),
    at: Date.now(),
  };
}

export function triggerOf(input: JsonObject): CompactTrigger {
  return getString(input, 'trigger') === 'manual' ? 'manual' : 'auto';
}

/**
 * Sends the event to the local server. Never rejects, and gives up after the timeout. Uses
 * node:http rather than fetch because it loads faster, and hooks start on every event.
 */
export function postEvent(event: HookEvent, timeoutMs = NETWORK_TIMEOUT_MS): Promise<void> {
  const server = readServerInfo();
  if (server === undefined) return Promise.resolve();
  const body = JSON.stringify(event);
  return new Promise(resolve => {
    const req = request({
      host: '127.0.0.1',
      port: server.port,
      path: '/events',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        [TOKEN_HEADER]: server.token,
      },
    });
    const done = (): void => {
      clearTimeout(timer);
      req.destroy();
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    req.on('response', response => {
      response.resume();
      response.once('end', done);
      response.once('error', done);
    });
    req.on('error', done);
    req.end(body);
  });
}

/** Stdout reaches Claude, so only the sync hooks ever call this. */
export function writeOut(text: string): Promise<void> {
  return new Promise(resolve => {
    process.stdout.write(text, () => {
      resolve();
    });
  });
}

export function additionalContext(hookEventName: string, context: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: context } });
}

/** Runs a hook body fail-open. Whatever happens the process exits 0 and blocks nothing. */
export function runHook(body: () => Promise<void>): void {
  process.exitCode = 0;
  const quietExit = (): never => process.exit(0);
  process.on('uncaughtException', quietExit);
  process.on('unhandledRejection', quietExit);
  setTimeout(quietExit, HARD_EXIT_MS).unref();
  body().catch(() => undefined);
}

type Envelope = Omit<HookEvent, 'event'>;

interface HookInput {
  input: JsonObject;
  envelope: Envelope;
}

/** The hook's JSON input and its envelope, or undefined when it has no usable session id. */
export async function readHookInput(): Promise<HookInput | undefined> {
  const input = parseJson(await readStdin());
  if (!isObject(input)) return undefined;
  const envelope = envelopeOf(input);
  return envelope === undefined ? undefined : { input, envelope };
}

/** The common shape of an observational hook, which only builds an event and sends it. */
export function runObserver(build: (hook: HookInput) => HookEvent | undefined): void {
  runHook(async () => {
    const hook = await readHookInput();
    const event = hook === undefined ? undefined : build(hook);
    if (event !== undefined) await postEvent(event);
  });
}
