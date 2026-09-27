import { getBoolean, isObject, parseJson } from '../core/json';
import { TOKEN_HEADER, type ServerInfo } from '../core/protocol';
import { readServerInfo } from '../core/store';
import type { SessionState } from '../core/types';

const TIMEOUT_MS = 1000;

interface ServerReply {
  status: number;
  body: unknown;
}

/** Calls the running app. Undefined when it is not running or does not answer in time. */
export async function callServer(
  method: string,
  path: string,
  info = readServerInfo(),
): Promise<ServerReply | undefined> {
  if (info === undefined) return undefined;
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}${path}`, {
      method,
      headers: { [TOKEN_HEADER]: info.token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, body: parseJson(await response.text()) };
  } catch {
    return undefined;
  }
}

export async function isHealthy(info: ServerInfo): Promise<boolean> {
  const reply = await callServer('GET', '/api/health', info);
  return reply?.status === 200 && getBoolean(reply.body, 'ok') === true;
}

/** Sessions from the running app. It built them, so a shallow shape check is enough. */
export async function fetchSessions(): Promise<SessionState[] | undefined> {
  const reply = await callServer('GET', '/api/sessions');
  if (reply?.status !== 200 || !Array.isArray(reply.body)) return undefined;
  return reply.body.filter(isSessionState);
}

function isSessionState(value: unknown): value is SessionState {
  return (
    isObject(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.contextTokens === 'number' &&
    Array.isArray(value.items) &&
    Array.isArray(value.pins)
  );
}
