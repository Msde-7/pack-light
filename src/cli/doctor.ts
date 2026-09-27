import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { plural } from '../core/format';
import { paths } from '../core/paths';
import { readSettings } from './_files';
import type { InstalledTarget } from './_installed';
import { readInstalled } from './_installed';
import { callServer } from './_server';
import { missingEntries } from './_settings';

const MIN_NODE_MAJOR = 20;

export interface Check {
  level: 'ok' | 'warn' | 'fail';
  text: string;
  fix?: string;
}

const ok = (text: string): Check => ({ level: 'ok', text });
const warn = (text: string, fix: string): Check => ({ level: 'warn', text, fix });
const fail = (text: string, fix: string): Check => ({ level: 'fail', text, fix });

function checkNodeVersion(): Check {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= MIN_NODE_MAJOR
    ? ok(`Node ${process.versions.node}`)
    : fail(`Node ${process.versions.node} is too old`, `Install Node ${MIN_NODE_MAJOR} or newer.`);
}

/** Hooks run as `node <script>` without a shell, so node itself must be on PATH. */
function findOnPath(command: string): string | undefined {
  const names = process.platform === 'win32' ? [`${command}.exe`] : [command];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    const hit = names.map(name => join(dir, name)).find(candidate => existsSync(candidate));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function checkNodeOnPath(): Check {
  const found = findOnPath('node');
  return found === undefined
    ? fail(
        '`node` is not on PATH, so hooks cannot start',
        'Add the folder that holds node to PATH.',
      )
    : ok(`node found at ${found}`);
}

function checkTarget(target: InstalledTarget): Check[] {
  let settings;
  try {
    settings = readSettings(target.settingsPath);
  } catch (error) {
    return [
      fail(
        error instanceof Error ? error.message : String(error),
        'Fix the JSON, then run `packlight install`.',
      ),
    ];
  }
  const missing = missingEntries(settings.settings, target);
  const checks = [
    missing.length === 0
      ? ok(`${target.entries.length} hooks installed in ${target.settingsPath}`)
      : fail(
          `${missing.length} hooks are missing from ${target.settingsPath}`,
          'Run `packlight install` again.',
        ),
  ];
  const scripts = [...new Set(target.entries.map(entry => entry.script))];
  const gone = scripts.filter(script => !existsSync(script));
  checks.push(
    gone.length === 0
      ? ok('Hook scripts are in place')
      : fail(
          `${gone.length} hook scripts are missing, such as ${gone[0] ?? ''}`,
          'Run `packlight install` again.',
        ),
  );
  if (target.statusLine !== undefined) {
    checks.push(
      isDeepStrictEqual(settings.settings.statusLine, target.statusLine.ours)
        ? ok('Status line shows backpack fill')
        : warn(
            'The status line was changed after install',
            'Run `packlight install --statusline` to wrap it again.',
          ),
    );
  }
  return checks;
}

function checkInstall(): Check[] {
  const installed = readInstalled();
  if (installed === undefined || installed.targets.length === 0) {
    return [fail('Hooks are not installed', 'Run `packlight install`.')];
  }
  return installed.targets.flatMap(checkTarget);
}

async function checkServer(): Promise<Check> {
  const reply = await callServer('GET', '/api/health');
  if (reply === undefined) {
    return warn('Pack Light is not running', 'Run `packlight` to start it.');
  }
  return reply.status === 200
    ? ok('Pack Light is running')
    : warn(`Pack Light answered with status ${reply.status}`, 'Restart it with `packlight`.');
}

function checkTranscripts(): Check {
  const dir = paths.projects();
  try {
    readdirSync(dir);
    return ok(`Transcripts are readable in ${dir}`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return warn(`No transcripts yet in ${dir}`, 'Run a Claude Code session, then check again.');
    }
    return fail(`Cannot read transcripts in ${dir}`, 'Check the folder permissions.');
  }
}

function checkPinsWritable(): Check {
  const dir = paths.sessions();
  const probe = join(dir, `.doctor-${process.pid}.tmp`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
    return ok(`Pins folder is writable at ${dir}`);
  } catch {
    return fail(`Cannot write pins in ${dir}`, 'Check the folder permissions.');
  }
}

export async function runChecks(): Promise<Check[]> {
  return [
    checkNodeVersion(),
    checkNodeOnPath(),
    ...checkInstall(),
    await checkServer(),
    checkTranscripts(),
    checkPinsWritable(),
  ];
}

const MARKS: Record<Check['level'], string> = { ok: '✓', warn: '!', fail: '✗' };

function formatCheck(check: Check): string {
  const line = `${MARKS[check.level]} ${check.text}`;
  return check.fix === undefined ? line : `${line}\n    ${check.fix}`;
}

export async function run(_args: readonly string[]): Promise<number> {
  const checks = await runChecks();
  checks.forEach(check => {
    console.log(formatCheck(check));
  });
  const failed = checks.filter(check => check.level === 'fail').length;
  console.log(failed === 0 ? '\nAll good.' : `\n${plural(failed, 'problem')} to fix.`);
  return failed === 0 ? 0 : 1;
}
