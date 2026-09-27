import { describe, expect, it } from 'vitest';
import { browserCommand } from '../server/open-browser';
import { parseStartArgs } from './start';

describe('parseStartArgs', () => {
  it('reads --port and --no-open in either form', () => {
    expect(parseStartArgs([])).toEqual({ open: true });
    expect(parseStartArgs(['--port', '4000', '--no-open'])).toEqual({ port: 4000, open: false });
    expect(parseStartArgs(['--port=0'])).toEqual({ port: 0, open: true });
  });

  it('explains bad input', () => {
    expect(parseStartArgs(['--port', 'x'])).toBe('The port must be 0 to 65535.');
    expect(parseStartArgs(['--port'])).toBe('The port must be 0 to 65535.');
    expect(parseStartArgs(['--wat'])).toBe('Unknown option "--wat".');
  });
});

describe('browserCommand', () => {
  const url = 'http://127.0.0.1:5000/#token=abc';

  it('uses start with an empty title on Windows, open on macOS and xdg-open elsewhere', () => {
    expect(browserCommand(url, 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '""', `"${url}"`],
      verbatim: true,
    });
    expect(browserCommand(url, 'darwin').command).toBe('open');
    expect(browserCommand(url, 'linux').command).toBe('xdg-open');
  });
});
