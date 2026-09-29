import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { paths } from '../core/paths';
import { command } from './_command';
import { lineDiff } from './_diff';
import { writeTextAtomic } from '../core/store';
import { backupFile, readSettings } from './_files';
import type { Installed, InstalledTarget } from './_installed';
import { findTarget, readInstalled, samePath, writeInstalled } from './_installed';
import type { Approver } from './_prompt';
import { approver } from './_prompt';
import { REQUIRED_SCRIPTS, addHooks, formatSettings, wrapStatusLine } from './_settings';

export interface InstallOptions {
  settingsPath: string;
  /** Folder holding the built hook scripts to copy from. */
  sourceDir: string;
  statusline: boolean;
  approve: Approver;
}

/** Hook bundles sit next to the running cli.js, which moves whenever npx refreshes its cache. */
function bundledHooksDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'hooks');
}

export function projectSettingsPath(cwd = process.cwd()): string {
  return join(resolve(cwd), '.claude', 'settings.json');
}

/** The bundles are ES modules, and the copied folder has no package.json of its own to say so. */
const MODULE_PACKAGE = `${JSON.stringify({ type: 'module' })}\n`;

type HookFiles = Map<string, Buffer>;

function hookFiles(sourceDir: string): HookFiles {
  const files: HookFiles = new Map();
  for (const name of readdirSync(sourceDir).filter(file => file.endsWith('.js'))) {
    files.set(name, readFileSync(join(sourceDir, name)));
  }
  files.set('package.json', Buffer.from(MODULE_PACKAGE));
  return files;
}

/** Files whose installed copy is missing or out of date. */
function staleFiles(files: HookFiles, hooksDir: string): HookFiles {
  const isCurrent = (name: string, bytes: Buffer): boolean => {
    const target = join(hooksDir, name);
    return existsSync(target) && readFileSync(target).equals(bytes);
  };
  return new Map([...files].filter(([name, bytes]) => !isCurrent(name, bytes)));
}

function writeHookFiles(hooksDir: string, files: HookFiles): void {
  mkdirSync(hooksDir, { recursive: true });
  for (const [name, bytes] of files) writeFileSync(join(hooksDir, name), bytes);
}

function withTarget(installed: Installed | undefined, target: InstalledTarget): Installed {
  const others = (installed?.targets ?? []).filter(
    existing => !samePath(existing.settingsPath, target.settingsPath),
  );
  return { v: 1, hooksDir: paths.hooksDir(), targets: [...others, target] };
}

export async function install(options: InstallOptions): Promise<number> {
  const missing = REQUIRED_SCRIPTS.filter(name => !existsSync(join(options.sourceDir, name)));
  if (missing.length > 0) {
    console.error(
      `Hook scripts are missing from ${options.sourceDir}. Run \`npm run build\` first.`,
    );
    return 1;
  }
  const hooksDir = paths.hooksDir();
  const file = readSettings(options.settingsPath);
  const installed = readInstalled();
  let merge = addHooks(file.settings, file.path, hooksDir, findTarget(installed, file.path));
  if (options.statusline) merge = wrapStatusLine(merge, hooksDir);

  const before = file.text ?? '';
  const after = formatSettings(merge.settings, file.text);
  const settingsChanged =
    file.text === undefined || !isDeepStrictEqual(file.settings, merge.settings);
  const stale = staleFiles(hookFiles(options.sourceDir), hooksDir);
  const nextInstalled = withTarget(installed, merge.target);

  if (!settingsChanged && stale.size === 0 && isDeepStrictEqual(installed, nextInstalled)) {
    console.log(`Pack Light is already installed in ${file.path}. Nothing to change.`);
    return 0;
  }
  if (settingsChanged) {
    console.log(`Pack Light will make these changes to ${file.path}\n`);
    console.log(lineDiff(before, after));
    console.log('');
    if (!(await options.approve('Apply these changes?'))) {
      console.log('Nothing was changed.');
      return 1;
    }
  }

  writeHookFiles(hooksDir, stale);
  if (settingsChanged) {
    const backup = file.text === undefined ? undefined : backupFile(file.path, 'settings');
    writeTextAtomic(file.path, after);
    if (backup !== undefined) console.log(`Backed up the old settings to ${backup}`);
  }
  writeInstalled(nextInstalled);
  console.log(`Installed ${merge.target.entries.length} hooks in ${file.path}.`);
  if (merge.target.statusLine !== undefined) console.log('The status line shows backpack fill.');
  console.log(`Start the app with \`${command()}\` and your sessions will show up as they run.`);
  return 0;
}

export async function run(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      project: { type: 'boolean', default: false },
      statusline: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
    },
  });
  const rerun = [
    command('install'),
    values.project ? '--project' : '',
    values.statusline ? '--statusline' : '',
    '--yes',
  ]
    .filter(part => part !== '')
    .join(' ');
  return install({
    settingsPath: values.project ? projectSettingsPath() : paths.userSettings(),
    sourceDir: bundledHooksDir(),
    statusline: values.statusline,
    approve: approver(values.yes, rerun),
  });
}
