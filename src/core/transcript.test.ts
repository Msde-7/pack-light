import { describe, expect, it } from 'vitest';
import { readFixture } from './fixtures';
import { createTranscriptReader, parseTranscript, type TranscriptFact } from './transcript';

const text = readFixture('trail.jsonl');
const facts = parseTranscript(text);

function only<K extends TranscriptFact['fact']>(kind: K) {
  return facts.filter((f): f is Extract<TranscriptFact, { fact: K }> => f.fact === kind);
}

describe('parseTranscript', () => {
  it('skips synthetic usage and takes context as input plus both cache fields', () => {
    const usage = only('usage');
    expect(usage.every(u => u.model === 'claude-opus-5')).toBe(true);
    expect(usage.at(-1)?.contextTokens).toBe(65_002);
    expect(usage.some(u => u.contextTokens === 0)).toBe(false);
  });

  it('pairs tool calls with results and sizes them from the tool_result content', () => {
    const tools = only('tool');
    expect(tools.map(t => t.tool.toolName)).toEqual([
      'Read',
      'Read',
      'Edit',
      'Bash',
      'Agent',
      'Grep',
    ]);
    const bash = tools.find(t => t.tool.toolName === 'Bash');
    expect(bash?.tool.tokens).toBe(7512);
    expect(tools.find(t => t.tool.toolName === 'Edit')?.failed).toBe(true);
    expect(tools.find(t => t.tool.toolName === 'Agent')?.launch).toEqual({
      async: true,
      agentId: 'a0fixture01',
      agentType: 'Explore',
    });
  });

  it('links task notifications to the Agent call', () => {
    expect(only('report')).toEqual([
      expect.objectContaining({ toolUseId: 'toolu_agent', taskId: 'a0fixture01' }),
    ]);
  });

  it('reads the boundary, the summary and the restored attachments', () => {
    const [boundary] = only('boundary');
    expect(boundary?.trigger).toBe('auto');
    expect(boundary?.preTokens).toBe(970_502);
    expect(boundary?.preservedUuids).toHaveLength(2);
    expect(only('summary')[0]?.chars).toBe(12_000);
    expect(only('attached').map(a => [a.kind, a.afterCompact])).toEqual([
      ['file', true],
      ['file_reference', true],
      ['skill', true],
    ]);
    expect(only('model')[0]?.modelId).toBe('claude-opus-5[1m]');
    expect(only('prompt')).toHaveLength(3);
    expect(only('instructions')).toHaveLength(2);
  });

  it('keeps no content, only sizes and labels', () => {
    expect(JSON.stringify(facts)).not.toMatch(/lorem|PASS test|const token/);
  });

  it('gives the same facts however the text is chunked, and holds a partial last line', () => {
    const reader = createTranscriptReader();
    const chunked: TranscriptFact[] = [];
    for (let i = 0; i < text.length; i += 777) chunked.push(...reader.feed(text.slice(i, i + 777)));
    chunked.push(...reader.end());
    expect(chunked).toEqual(facts);
  });

  it('parses a trailing line once it completes', () => {
    const reader = createTranscriptReader();
    const line = JSON.stringify({
      type: 'attachment',
      uuid: 'u',
      attachment: { type: 'model', identity: { modelId: 'm' } },
    });
    expect(reader.feed(line.slice(0, 20))).toEqual([]);
    expect(reader.feed(`${line.slice(20)}\n`)).toEqual([expect.objectContaining({ modelId: 'm' })]);
  });

  it('ignores junk lines and unknown record types', () => {
    expect(parseTranscript('not json\n{"type":"frame-link"}\n[1,2]\n')).toEqual([]);
  });

  it('parses a 50 MB transcript in a couple of seconds', () => {
    const lines = text.split('\n').slice(0, -1);
    const block = `${lines.join('\n')}\n`;
    const big = block.repeat(Math.ceil(50_000_000 / block.length));
    const started = performance.now();
    const reader = createTranscriptReader();
    let count = 0;
    for (let i = 0; i < big.length; i += 4_000_000) {
      count += reader.feed(big.slice(i, i + 4_000_000)).length;
    }
    const elapsed = performance.now() - started;
    expect(count).toBeGreaterThan(10_000);
    expect(elapsed).toBeLessThan(3000);
  });
});

describe('summary matching', () => {
  it('hands the summary to the matcher and keeps only the pin ids it returns', () => {
    const seen: string[] = [];
    const facts = parseTranscript(readFixture('trail.jsonl'), summary => {
      seen.push(summary);
      return ['pin-1'];
    });
    const summary = facts.find(fact => fact.fact === 'summary');
    expect(seen).toHaveLength(1);
    expect(summary).toMatchObject({ mentionedPinIds: ['pin-1'] });
    expect(JSON.stringify(facts)).not.toContain(seen[0]!.slice(0, 40));
  });
});
