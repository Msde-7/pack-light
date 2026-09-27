import { rmSync } from 'node:fs';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { paths } from '../core/paths';
import { lineDiff } from './_diff';
import type { SettingsFile } from './_files';
import { writeTextAtomic } from '../core/store';
import { backupFile, readSettings } from './_files';
import { readInstalled, removeInstalled } from './_installed';
import type { Approver } from './_prompt';
import { approver } from './_prompt';
import { formatSettings, removeHooks } from './_settings';

interface Change {
  file: SettingsFile;
  after: string;
}

function removeLeftovers(): void {
  rmSync(paths.hooksDir(), { recursive: true, force: true });
  removeInstalled();
}

function applyChange(change: Change): void {
  const backup = backupFile(change.file.path, 'settings');
  writeTextAtomic(change.file.path, change.after);
  console.log(`Updated ${change.file.path} (backup at ${backup})`);
}

export async function uninstall(approve: Approver): Promise<number> {
  const installed = readInstalled();
  if (installed === undefined) {
    removeLeftovers();
    console.log('Pack Light is not installed. Nothing to remove.');
    return 0;
  }

  const changes: Change[] = [];
  const warnings: string[] = [];
  for (const target of installed.targets) {
    const file = readSettings(target.settingsPath);
    if (file.text === undefined) continue;
    const removal = removeHooks(file.settings, target);
    warnings.push(...removal.warnings.map(warning => `In ${file.path}, ${warning}`));
    if (!isDeepStrictEqual(removal.settings, file.settings)) {
      changes.push({ file, after: formatSettings(removal.settings, file.text) });
    }
  }

  for (const change of changes) {
    console.log(`Pack Light will make these changes to ${change.file.path}\n`);
    console.log(lineDiff(change.file.text ?? '', change.after));
    console.log('');
  }
  if (changes.length > 0 && !(await approve('Remove Pack Light?'))) {
    console.log('Nothing was changed.');
    return 1;
  }

  changes.forEach(applyChange);
  removeLeftovers();
  warnings.forEach(warning => {
    console.log(warning);
  });
  console.log('Pack Light is uninstalled. Your pins are still in the backpack folder.');
  return 0;
}

export async function run(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { yes: { type: 'boolean', short: 'y', default: false } },
  });
  return uninstall(approver(values.yes, 'packlight uninstall --yes'));
}
