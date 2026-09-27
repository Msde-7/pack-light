import { statSync } from 'node:fs';
import { getString } from '../core/json';
import { runObserver } from './_shared';

function sizeOf(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

runObserver(({ input, envelope }) => {
  const filePath = getString(input, 'file_path');
  if (filePath === undefined) return undefined;
  return {
    ...envelope,
    event: 'InstructionsLoaded',
    filePath,
    loadReason: getString(input, 'load_reason') ?? '',
    chars: sizeOf(filePath),
  };
});
