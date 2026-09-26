import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Path of a synthetic transcript under fixtures/, for tests. */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url));
}

export function readFixture(name: string): string {
  return readFileSync(fixturePath(name), 'utf8');
}
