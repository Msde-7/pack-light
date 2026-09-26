import { homedir } from 'node:os';
import { join } from 'node:path';

/** Root data directory. PACK_LIGHT_HOME overrides it for tests and the demo. */
function backpackHome(): string {
  return process.env.PACK_LIGHT_HOME ?? join(homedir(), '.pack-light');
}

function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
}

/** Session ids come from Claude Code, but they still become path segments, so keep them tame. */
export function safeSessionId(sessionId: string): string {
  const cleaned = sessionId.replace(/[^A-Za-z0-9_-]/g, '');
  if (cleaned.length === 0) throw new Error('Invalid session id');
  return cleaned.slice(0, 128);
}

export const paths = {
  serverInfo: (): string => join(backpackHome(), 'server.json'),
  installed: (): string => join(backpackHome(), 'installed.json'),
  config: (): string => join(backpackHome(), 'config.json'),
  hooksDir: (): string => join(backpackHome(), 'hooks'),
  backups: (): string => join(backpackHome(), 'backups'),
  sessions: (): string => join(backpackHome(), 'sessions'),
  sessionDir: (sessionId: string): string => join(paths.sessions(), safeSessionId(sessionId)),
  pins: (sessionId: string): string => join(paths.sessionDir(sessionId), 'pins.json'),
  repack: (sessionId: string): string => join(paths.sessionDir(sessionId), 'repack.json'),
  userSettings: (): string => join(claudeHome(), 'settings.json'),
  projects: (): string => join(claudeHome(), 'projects'),
};
