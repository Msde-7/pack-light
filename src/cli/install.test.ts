import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paths } from '../core/paths';
import { readPins, writePins } from '../core/store';
import { runChecks } from './doctor';
import { readInstalled } from './_installed';
import { install, projectSettingsPath } from './install';
import { clearPins, listPins } from './pins';
import { REQUIRED_SCRIPTS } from './_settings';
import { uninstall } from './uninstall';

let root: string;
let sourceDir: string;
let log: string[];

const yes = (): Promise<boolean> => Promise.resolve(true);
const no = (): Promise<boolean> => Promise.resolve(false);

const ORIGINAL = `${JSON.stringify(
  {
    model: 'opus',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] },
    statusLine: { type: 'command', command: 'my-status' },
  },
  null,
  2,
)}\n`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'packlight-install-'));
  process.env.PACK_LIGHT_HOME = join(root, 'pack-light');
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude');
  sourceDir = join(root, 'dist-hooks');
  mkdirSync(sourceDir);
  for (const name of REQUIRED_SCRIPTS) writeFileSync(join(sourceDir, name), `// ${name}\n`);
  mkdirSync(process.env.CLAUDE_CONFIG_DIR);
  writeFileSync(paths.userSettings(), ORIGINAL);
  log = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    log.push(args.join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    log.push(args.join(' '));
  });
});

afterEach(() => {
  delete process.env.PACK_LIGHT_HOME;
  delete process.env.CLAUDE_CONFIG_DIR;
  rmSync(root, { recursive: true, force: true });
});

function userInstall(statusline = false, approve = yes): Promise<number> {
  return install({ settingsPath: paths.userSettings(), sourceDir, statusline, approve });
}

describe('install and uninstall', () => {
  it('installs, backs up, and records what it added', async () => {
    expect(await userInstall()).toBe(0);
    const settings = readFileSync(paths.userSettings(), 'utf8');
    expect(settings).toContain('"args": [');
    expect(settings).toContain('echo done');
    expect(readdirSync(paths.backups())).toHaveLength(1);
    expect(readdirSync(paths.hooksDir()).sort()).toEqual(
      [...REQUIRED_SCRIPTS, 'package.json'].sort(),
    );
    expect(readInstalled()?.targets).toHaveLength(1);
    expect(log.join('\n')).toContain('+ ');
  });

  it('changes nothing on a second run and says so', async () => {
    await userInstall();
    const first = readFileSync(paths.userSettings(), 'utf8');
    log = [];
    expect(await userInstall()).toBe(0);
    expect(readFileSync(paths.userSettings(), 'utf8')).toBe(first);
    expect(readdirSync(paths.backups())).toHaveLength(1);
    expect(log.join('\n')).toContain('already installed');
  });

  it('uninstalls back to the exact original file, twice safely', async () => {
    await userInstall(true);
    expect(readFileSync(paths.userSettings(), 'utf8')).toContain('statusline.js');
    expect(await uninstall(yes)).toBe(0);
    expect(readFileSync(paths.userSettings(), 'utf8')).toBe(ORIGINAL);
    expect(existsSync(paths.hooksDir())).toBe(false);
    expect(existsSync(paths.installed())).toBe(false);
    expect(await uninstall(yes)).toBe(0);
    expect(log.join('\n')).toContain('not installed');
  });

  it('changes nothing when the user declines', async () => {
    expect(await userInstall(false, no)).toBe(1);
    expect(readFileSync(paths.userSettings(), 'utf8')).toBe(ORIGINAL);
    expect(existsSync(paths.installed())).toBe(false);
  });

  it('refuses without built hook scripts', async () => {
    rmSync(join(sourceDir, 'stop.js'));
    expect(await userInstall()).toBe(1);
    expect(readFileSync(paths.userSettings(), 'utf8')).toBe(ORIGINAL);
  });

  it('refuses to touch a settings file that is not JSON', async () => {
    writeFileSync(paths.userSettings(), '{ nope');
    await expect(userInstall()).rejects.toThrow('not valid JSON');
    expect(readFileSync(paths.userSettings(), 'utf8')).toBe('{ nope');
  });

  it('installs into a project settings file and removes both targets', async () => {
    const project = join(root, 'repo');
    mkdirSync(project);
    const settingsPath = projectSettingsPath(project);
    expect(await install({ settingsPath, sourceDir, statusline: false, approve: yes })).toBe(0);
    await userInstall();
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toHaveProperty('hooks.SessionStart');
    expect(readInstalled()?.targets).toHaveLength(2);
    expect(await uninstall(yes)).toBe(0);
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({});
    expect(readFileSync(paths.userSettings(), 'utf8')).toBe(ORIGINAL);
  });
});

describe('doctor', () => {
  it('finds nothing to fail after install, and warns when the app is not running', async () => {
    await userInstall();
    const checks = await runChecks();
    expect(checks.filter(check => check.level === 'fail')).toEqual([]);
    expect(checks.find(check => check.text.includes('not running'))?.level).toBe('warn');
  });

  it('fails when hooks are not installed or were removed by hand', async () => {
    expect((await runChecks()).some(check => check.level === 'fail')).toBe(true);
    await userInstall();
    writeFileSync(paths.userSettings(), '{}');
    const failed = (await runChecks()).filter(check => check.level === 'fail');
    expect(failed.map(check => check.text).join()).toContain('missing');
  });
});

describe('pins', () => {
  const pin = {
    itemId: 'i1',
    kind: 'file_read' as const,
    label: 'src/a.ts',
    note: 'bug',
    pinnedAt: 1,
  };

  it('lists pins per session', () => {
    writePins('s1', [pin]);
    expect(listPins()).toBe(0);
    expect(log).toEqual(['Session s1, 1 pin', '  ★ src/a.ts  (bug)']);
  });

  it('clears one session without asking and all sessions only after asking', async () => {
    writePins('s1', [pin]);
    writePins('s2', [pin]);
    expect(await clearPins('s1', no)).toBe(0);
    expect(readPins('s1')).toEqual([]);
    expect(await clearPins(undefined, no)).toBe(1);
    expect(readPins('s2')).toHaveLength(1);
    expect(await clearPins(undefined, yes)).toBe(0);
    expect(readPins('s2')).toEqual([]);
  });
});
