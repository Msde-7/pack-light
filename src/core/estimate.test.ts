import { describe, expect, it } from 'vitest';
import { displayPath, kindOf, summarizeFailure, summarizeTool, weightOf } from './estimate';

describe('weightOf', () => {
  it.each([
    [0, 'pebble'],
    [499, 'pebble'],
    [500, 'book'],
    [1999, 'book'],
    [2000, 'brick'],
    [8000, 'anvil'],
  ] as const)('%i tokens is a %s', (tokens, weight) => {
    expect(weightOf(tokens)).toBe(weight);
  });
});

describe('kindOf', () => {
  it('maps tool names to item kinds', () => {
    expect(kindOf('Read')).toBe('file_read');
    expect(kindOf('Glob')).toBe('search');
    expect(kindOf('PowerShell')).toBe('bash_output');
    expect(kindOf('WebSearch')).toBe('web');
    expect(kindOf('mcp__github__get_issue')).toBe('mcp');
    expect(kindOf('Agent')).toBe('subagent_report');
    expect(kindOf('MultiEdit')).toBe('edit');
    expect(kindOf('TodoWrite')).toBe('other');
  });
});

describe('displayPath', () => {
  it('shortens paths inside cwd and normalizes separators', () => {
    expect(displayPath('C:\\repo\\src\\a.ts', 'C:\\repo')).toBe('src/a.ts');
    expect(displayPath('c:\\Repo\\src\\a.ts', 'C:\\repo')).toBe('src/a.ts');
    expect(displayPath('/home/u/repo/src/a.ts', '/home/u/repo/')).toBe('src/a.ts');
    expect(displayPath('/elsewhere/a.ts', '/home/u/repo')).toBe('/elsewhere/a.ts');
    expect(displayPath('/home/u/repository/a.ts', '/home/u/repo')).toBe('/home/u/repository/a.ts');
  });
});

describe('summarizeTool', () => {
  it('sizes a text Read from file content plus the line gutter', () => {
    const summary = summarizeTool({
      toolName: 'Read',
      toolUseId: 't1',
      cwd: '/repo',
      input: { file_path: '/repo/src/auth.ts', offset: 40, limit: 19 },
      response: {
        type: 'text',
        file: { filePath: '/repo/src/auth.ts', content: 'x'.repeat(4000), numLines: 100 },
      },
    });
    expect(summary).toMatchObject({
      kind: 'file_read',
      label: 'src/auth.ts',
      path: '/repo/src/auth.ts',
      range: '40-58',
    });
    expect(summary.tokens).toBeGreaterThanOrEqual(1150);
    expect(summary.tokens).toBeLessThan(1200);
  });

  it('sizes an image Read from its dimensions, not the base64 payload', () => {
    const summary = summarizeTool({
      toolName: 'Read',
      toolUseId: 't2',
      input: { file_path: '/a.png' },
      response: {
        type: 'image',
        file: {
          base64: 'A'.repeat(500_000),
          dimensions: { displayWidth: 750, displayHeight: 100 },
        },
      },
    });
    expect(summary.tokens).toBeLessThan(200);
  });

  it('never counts the original file that Edit reports back', () => {
    const summary = summarizeTool({
      toolName: 'Edit',
      toolUseId: 't3',
      cwd: '/repo',
      input: { file_path: '/repo/a.ts', old_string: 'aaaa', new_string: 'bbbb' },
      response: { filePath: '/repo/a.ts', originalFile: 'z'.repeat(400_000) },
    });
    expect(summary.tokens).toBeLessThan(50);
    expect(summary.label).toBe('edit: a.ts');
  });

  it('caps persisted Bash output at the preview size', () => {
    const summary = summarizeTool({
      toolName: 'Bash',
      toolUseId: 't4',
      input: { command: 'npm test' },
      response: { stdout: 'y'.repeat(200_000), stderr: '', persistedOutputPath: '/tmp/out.txt' },
    });
    expect(summary.tokens).toBeLessThan(700);
    expect(summary.label).toBe('npm test');
  });

  it('prefers exact transcript result length when known', () => {
    const summary = summarizeTool({
      toolName: 'Grep',
      toolUseId: 't5',
      input: { pattern: 'refreshToken' },
      response: { content: 'q'.repeat(100_000) },
      resultChars: 400,
    });
    expect(summary.tokens).toBeLessThan(150);
    expect(summary.label).toBe('grep: refreshToken');
  });

  it('labels MCP tools by server and tool and reads their content array', () => {
    const summary = summarizeTool({
      toolName: 'mcp__github__get_issue',
      toolUseId: 't6',
      input: { number: 1 },
      response: { content: [{ type: 'text', text: 'm'.repeat(4000) }] },
    });
    expect(summary.label).toBe('github: get_issue');
    expect(summary.tokens).toBeGreaterThanOrEqual(1000);
  });

  it('clips long labels to one line', () => {
    const summary = summarizeTool({
      toolName: 'Bash',
      toolUseId: 't7',
      input: { command: `echo ${'long '.repeat(40)}\nsecond line` },
      response: { stdout: '', stderr: '' },
    });
    expect(summary.label.length).toBeLessThanOrEqual(60);
    expect(summary.label).not.toContain('\n');
  });

  it('sizes failures from the error text', () => {
    const summary = summarizeFailure({
      toolName: 'Bash',
      toolUseId: 't8',
      input: { command: 'npm test' },
      error: `Exit code 1\n${'e'.repeat(4000)}`,
    });
    expect(summary.tokens).toBeGreaterThan(1000);
  });
});
