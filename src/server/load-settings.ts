import { parseClaudeWindowEnv, parseConfig } from '../core/config';
import { paths } from '../core/paths';
import { readJsonFile } from '../core/store';
import type { WindowSettings } from '../core/window';

/** Reads the user config and Claude Code's window settings. Read only, never writes. */
export function loadWindowSettings(env: NodeJS.ProcessEnv = process.env): WindowSettings {
  return {
    config: parseConfig(readJsonFile(paths.config())),
    claude: parseClaudeWindowEnv(readJsonFile(paths.userSettings()), env),
  };
}
