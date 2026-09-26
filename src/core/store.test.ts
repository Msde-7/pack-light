import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { paths, safeSessionId } from './paths';
import { claimRepack, readPins, readRepack, writePins, writeRepack } from './store';
import type { Pin } from './types';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'packlight-store-'));
  process.env.PACK_LIGHT_HOME = home;
});

afterEach(() => {
  delete process.env.PACK_LIGHT_HOME;
  rmSync(home, { recursive: true, force: true });
});

const pin: Pin = {
  itemId: 'i1',
  kind: 'file_read',
  label: 'src/a.ts',
  note: 'the bug',
  pinnedAt: 1,
};

describe('pins', () => {
  it('round-trips in order and leaves no temp files', () => {
    writePins('s1', [pin, { ...pin, itemId: 'i2', label: 'src/b.ts' }]);
    expect(readPins('s1').map(p => p.itemId)).toEqual(['i1', 'i2']);
    expect(readdirSync(paths.sessionDir('s1'))).toEqual(['pins.json']);
  });

  it('returns nothing for missing or corrupt files', () => {
    expect(readPins('missing')).toEqual([]);
    writePins('s2', [pin]);
    writeFileSync(paths.pins('s2'), '{not json');
    expect(readPins('s2')).toEqual([]);
  });

  it('drops malformed entries', () => {
    writePins('s2', []);
    writeFileSync(paths.pins('s2'), JSON.stringify({ v: 1, pins: [pin, { itemId: 3 }, null] }));
    expect(readPins('s2')).toHaveLength(1);
  });
});

describe('repack', () => {
  it('is claimed exactly once', () => {
    writeRepack('s1', [{ itemId: 'i1', kind: 'file_read', label: 'src/a.ts' }]);
    expect(readRepack('s1')).toHaveLength(1);
    expect(claimRepack('s1')).toHaveLength(1);
    expect(claimRepack('s1')).toEqual([]);
    expect(existsSync(paths.repack('s1'))).toBe(false);
  });
});

describe('safeSessionId', () => {
  it('strips path tricks', () => {
    expect(safeSessionId('../../etc')).toBe('etc');
    expect(() => safeSessionId('../..')).toThrow();
  });
});
