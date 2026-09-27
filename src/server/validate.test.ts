import { describe, expect, it } from 'vitest';
import { parseHookEvent, parsePinRequest } from './validate';

const envelope = { v: 1, sessionId: 'abc-123', transcriptPath: '/t.jsonl', cwd: '/w', at: 5 };

describe('parseHookEvent', () => {
  it('accepts well-formed events and drops unknown fields', () => {
    const event = parseHookEvent({
      ...envelope,
      event: 'PostToolUse',
      tool: {
        toolUseId: 't',
        toolName: 'Read',
        kind: 'file_read',
        label: 'a',
        tokens: 3,
        extra: 1,
      },
      stray: 'x',
    });
    expect(event).toEqual({
      ...envelope,
      event: 'PostToolUse',
      tool: { toolUseId: 't', toolName: 'Read', kind: 'file_read', label: 'a', tokens: 3 },
    });
  });

  it('rejects bad envelopes, unknown events and bad payloads', () => {
    expect(parseHookEvent({ ...envelope, sessionId: '../x', event: 'Stop' })).toBeUndefined();
    expect(parseHookEvent({ ...envelope, v: 2, event: 'Stop' })).toBeUndefined();
    expect(parseHookEvent({ ...envelope, event: 'Nope' })).toBeUndefined();
    expect(
      parseHookEvent({ ...envelope, event: 'PreCompact', trigger: 'sometimes' }),
    ).toBeUndefined();
    const badKind = { toolUseId: 't', toolName: 'X', kind: 'weird', label: 'a', tokens: 1 };
    expect(parseHookEvent({ ...envelope, event: 'PostToolUse', tool: badKind })).toBeUndefined();
    expect(parseHookEvent('Stop')).toBeUndefined();
  });

  it('fills safe defaults for optional parts', () => {
    expect(parseHookEvent({ ...envelope, event: 'PostCompact', trigger: 'auto' })).toMatchObject({
      mentionedPinIds: [],
    });
    expect(parseHookEvent({ ...envelope, event: 'SubagentStop', agentId: 'a1' })).toMatchObject({
      reportChars: 0,
      agentId: 'a1',
    });
  });
});

describe('parsePinRequest', () => {
  it('enforces the note and snippet limits', () => {
    expect(parsePinRequest({ note: 'n'.repeat(280) }).ok).toBe(true);
    expect(parsePinRequest({ note: 'n'.repeat(281) }).ok).toBe(false);
    expect(parsePinRequest({ snippet: 's'.repeat(1501) }).ok).toBe(false);
    expect(parsePinRequest({ note: 5 }).ok).toBe(false);
    expect(parsePinRequest(undefined)).toEqual({ ok: true, value: {} });
    expect(parsePinRequest({ note: '  ' })).toEqual({ ok: true, value: {} });
  });
});
