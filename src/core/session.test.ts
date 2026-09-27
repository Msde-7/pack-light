import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { readFixture } from './fixtures';
import type { HookEvent, ToolSummary } from './protocol';
import {
  applyEvent,
  applyFacts,
  applyPins,
  applyRepackQueue,
  createSession,
  refresh,
  type SessionModel,
} from './session';
import { parseTranscript, type TranscriptFact } from './transcript';
import type { Item, Pin } from './types';
import type { WindowSettings } from './window';

const settings: WindowSettings = { config: DEFAULT_CONFIG, claude: { disable1m: false } };
const T0 = Date.parse('2026-09-01T10:00:00.000Z');
const LATER = T0 + 3_600_000;
const SID = 'fixture-session-1';

function fresh(): SessionModel {
  return createSession({ sessionId: SID, cwd: 'C:\\work\\demo-app', at: T0 }, settings);
}

type EventBody = HookEvent extends infer E
  ? E extends HookEvent
    ? Omit<E, 'v' | 'sessionId' | 'transcriptPath' | 'cwd' | 'at'>
    : never
  : never;

function event(body: EventBody, at: number): HookEvent {
  return {
    v: 1,
    sessionId: SID,
    transcriptPath: 'C:\\t.jsonl',
    cwd: 'C:\\work\\demo-app',
    at,
    ...body,
  };
}

function send(model: SessionModel, body: EventBody, at: number, now = at): SessionModel {
  return applyEvent(model, event(body, at), now).model;
}

function tool(toolUseId: string, over: Partial<ToolSummary> = {}): ToolSummary {
  return {
    toolUseId,
    toolName: 'Read',
    kind: 'file_read',
    label: 'src/a.ts',
    path: 'C:\\work\\demo-app\\src\\a.ts',
    tokens: 100,
    ...over,
  };
}

function byLabel(model: SessionModel, label: string): Item[] {
  return model.state.items.filter(item => item.label === label);
}

const fixtureFacts = parseTranscript(readFixture('trail.jsonl'));
const replayed = applyFacts(fresh(), fixtureFacts, LATER);

describe('replaying the fixture transcript', () => {
  const { state } = replayed.model;

  it('tracks model, window, context and turns', () => {
    expect(state.model).toBe('claude-opus-5[1m]');
    expect(state.windowTokens).toBe(1_000_000);
    expect(state.compactAtTokens).toBe(967_000);
    expect(state.contextTokens).toBe(65_002);
    expect(state.contextSource).toBe('transcript');
    expect(state.turn).toBe(3);
    expect(state.epoch).toBe(1);
  });

  it('drops what was before the boundary but keeps preserved, sewn-in and restored items', () => {
    expect(byLabel(replayed.model, 'grep: refreshToken')[0]?.status).toBe('carried');
    expect(byLabel(replayed.model, 'npm test')[0]?.status).toBe('dropped');
    expect(byLabel(replayed.model, 'CLAUDE.md')[0]?.status).toBe('sewn_in');
    const reads = byLabel(replayed.model, 'src/auth.ts');
    expect(reads.map(r => r.status)).toEqual(['dropped', 'sewn_in']);
    expect(byLabel(replayed.model, 'Field Notes')[0]).toMatchObject({
      status: 'sewn_in',
      tokensEst: 3000,
      epoch: 1,
    });
    expect(byLabel(replayed.model, 'src/old.ts (name only)')[0]?.status).toBe('sewn_in');
    expect(byLabel(replayed.model, 'skill deploy')[0]?.status).toBe('sewn_in');
  });

  it('records the compaction with before, after and the dropped ids', () => {
    const [compaction] = state.compactions;
    expect(compaction).toMatchObject({ trigger: 'auto', before: 970_502, after: 65_002 });
    const dropped = state.items.filter(item => item.status === 'dropped').map(item => item.id);
    expect(compaction?.droppedIds.sort()).toEqual(dropped.sort());
  });

  it('adds the async subagent report to the Agent item and returns the companion', () => {
    const agent = byLabel(replayed.model, 'Survey the API')[0];
    expect(agent?.kind).toBe('subagent_report');
    expect(agent?.tokensEst).toBeGreaterThan(560);
    expect(state.subagents.a0fixture01).toMatchObject({
      agentType: 'Explore',
      status: 'returned',
      reportTokens: 561,
      hat: 0,
    });
  });

  it('flags the failed edit and emits cues', () => {
    expect(byLabel(replayed.model, 'edit: src/auth.ts')[0]?.failed).toBe(true);
    expect(replayed.cues.filter(c => c.cue === 'camp')).toHaveLength(1);
    expect(replayed.cues.some(c => c.cue === 'item_added' && c.duplicate)).toBe(true);
  });

  it('rebuilds to the same item ids', () => {
    const again = applyFacts(fresh(), fixtureFacts, LATER).model.state.items.map(i => i.id);
    expect(again).toEqual(state.items.map(i => i.id));
  });
});

describe('hooks and transcript merge', () => {
  it('turns a hook item and its transcript record into one item, with the transcript size', () => {
    let model = send(fresh(), { event: 'PostToolUse', tool: tool('t1', { tokens: 999 }) }, T0);
    expect(model.state.items).toHaveLength(1);
    const fact: TranscriptFact = {
      fact: 'tool',
      uuid: 'u1',
      at: T0 + 100,
      tool: tool('t1', { tokens: 250 }),
      failed: false,
    };
    model = applyFacts(model, [fact], T0 + 200).model;
    expect(model.state.items).toHaveLength(1);
    expect(model.state.items[0]?.tokensEst).toBe(250);
    model = send(model, { event: 'PostToolUse', tool: tool('t1', { tokens: 999 }) }, T0 + 300);
    expect(model.state.items[0]?.tokensEst).toBe(250);
  });

  it('counts a prompt once whichever side arrives first', () => {
    let model = send(fresh(), { event: 'UserPromptSubmit', promptChars: 400, repackedIds: [] }, T0);
    model = applyFacts(model, [{ fact: 'prompt', uuid: 'p1', at: T0 + 50, chars: 40 }], T0).model;
    expect(model.state.turn).toBe(1);
    model = applyFacts(model, [{ fact: 'prompt', uuid: 'p2', at: T0 + 900, chars: 8 }], T0).model;
    model = send(model, { event: 'UserPromptSubmit', promptChars: 8, repackedIds: [] }, T0 + 950);
    expect(model.state.turn).toBe(2);
    expect(model.state.items.filter(i => i.kind === 'user_prompt')).toHaveLength(2);
  });

  it('marks repeated reads of the same range as duplicates of the first', () => {
    let model = fresh();
    for (const id of ['r1', 'r2', 'r3']) {
      model = send(model, { event: 'PostToolUse', tool: tool(id) }, T0);
    }
    model = send(model, { event: 'PostToolUse', tool: tool('r4', { range: '1-20' }) }, T0);
    const [first, second, third, ranged] = model.state.items;
    expect(first?.duplicateOf).toBeUndefined();
    expect(second?.duplicateOf).toBe(first?.id);
    expect(third?.duplicateOf).toBe(first?.id);
    expect(ranged?.duplicateOf).toBeUndefined();
    expect(model.state.tips.find(t => t.kind === 'carried_twice')?.wastedTokens).toBe(200);
  });
});

describe('pins and repack', () => {
  const pinFor = (item: Item, note?: string): Pin => ({
    itemId: item.id,
    kind: item.kind,
    label: item.label,
    pinnedAt: T0,
    ...(note === undefined ? {} : { note }),
  });

  it('overlays pins with notes in Keep List order and reverts on unpin', () => {
    let model = send(fresh(), { event: 'PostToolUse', tool: tool('a') }, T0);
    const item = model.state.items[0]!;
    const pinned = applyPins(model, [pinFor(item, 'the race')], T0);
    expect(pinned.cues).toContainEqual({ cue: 'pinned', itemId: item.id });
    model = pinned.model;
    expect(model.state.items[0]).toMatchObject({ status: 'pinned', note: 'the race' });
    model = applyPins(model, [], T0).model;
    expect(model.state.items[0]?.status).toBe('carried');
    expect(model.state.items[0]?.note).toBeUndefined();
  });

  it('keeps pinned items through compaction and queues dropped ones for repack', () => {
    let model = send(fresh(), { event: 'PostToolUse', tool: tool('keep') }, T0);
    model = send(
      model,
      { event: 'PostToolUse', tool: tool('lose', { label: 'b', path: 'b' }) },
      T0,
    );
    const [keep, lose] = model.state.items;
    model = applyPins(model, [pinFor(keep!)], T0).model;
    const boundary: TranscriptFact = {
      fact: 'boundary',
      uuid: 'b',
      at: T0 + 10,
      trigger: 'manual',
      preservedUuids: [],
    };
    model = applyFacts(model, [boundary], T0 + 10).model;
    expect(model.state.items.map(i => i.status)).toEqual(['pinned', 'dropped']);
    expect(model.state.compactions[0]?.droppedIds).toEqual([lose?.id]);

    model = applyRepackQueue(
      model,
      [{ itemId: lose!.id, kind: 'file_read', label: 'b' }],
      T0,
    ).model;
    expect(model.state.items[1]?.status).toBe('repack_queued');
    const repacked = applyEvent(
      model,
      event({ event: 'UserPromptSubmit', promptChars: 5, repackedIds: [lose!.id] }, T0 + 20),
      T0 + 20,
    );
    expect(repacked.cues).toContainEqual({ cue: 'repacked', itemIds: [lose!.id] });
    model = applyRepackQueue(repacked.model, [], T0 + 20).model;
    expect(model.state.items[1]?.status).toBe('repacked');
  });
});

describe('compaction from hooks', () => {
  function loaded(): SessionModel {
    const facts: TranscriptFact[] = [
      { fact: 'tool', uuid: 'keep-me', at: T0, tool: tool('a'), failed: false },
      {
        fact: 'tool',
        uuid: 'drop-me',
        at: T0,
        tool: tool('b', { path: 'b', label: 'b' }),
        failed: false,
      },
    ];
    return applyFacts(fresh(), facts, T0).model;
  }
  const boundary: TranscriptFact = {
    fact: 'boundary',
    uuid: 'bd',
    at: T0 + 1000,
    trigger: 'auto',
    preservedUuids: ['keep-me'],
  };

  it('camps on PostCompact and finishes when the boundary is parsed', () => {
    let model = loaded();
    model = applyPins(
      model,
      [{ itemId: model.state.items[0]!.id, kind: 'file_read', label: 'x', pinnedAt: T0 }],
      T0,
    ).model;
    const pinId = model.state.items[0]!.id;
    model = send(
      model,
      { event: 'PostCompact', trigger: 'auto', mentionedPinIds: [pinId] },
      T0 + 1200,
    );
    expect(model.state.phase).toBe('camping');
    expect(model.state.compactions).toHaveLength(0);
    model = applyFacts(model, [boundary], T0 + 1300).model;
    expect(model.state.items.map(i => i.status)).toEqual(['pinned', 'dropped']);
    expect(model.state.items[0]?.mentionedInSummary).toBe(true);
    expect(refresh(model, T0 + 1300 + 3600).model.state.phase).toBe('idle');
  });

  it('drops blind when no boundary shows up, then honors a late boundary', () => {
    let model = send(
      loaded(),
      { event: 'PostCompact', trigger: 'auto', mentionedPinIds: [] },
      T0 + 1200,
    );
    expect(refresh(model, T0 + 2000).model.state.compactions).toHaveLength(0);
    model = refresh(model, T0 + 1200 + 5000).model;
    expect(model.state.items.map(i => i.status)).toEqual(['dropped', 'dropped']);
    model = applyFacts(model, [boundary], T0 + 7000).model;
    expect(model.state.compactions).toHaveLength(1);
    expect(model.state.items.map(i => i.status)).toEqual(['carried', 'dropped']);
  });

  it('matches a PostCompact that arrives after the boundary instead of compacting twice', () => {
    let model = applyFacts(loaded(), [boundary], T0 + 1000).model;
    model = send(model, { event: 'PostCompact', trigger: 'auto', mentionedPinIds: [] }, T0 + 1500);
    model = refresh(model, T0 + 60_000).model;
    expect(model.state.compactions).toHaveLength(1);
  });
});

describe('phase', () => {
  it('walks after a tool, waits on a permission prompt, idles, and ends', () => {
    let model = send(fresh(), { event: 'PostToolUse', tool: tool('a') }, T0);
    expect(model.state.phase).toBe('walking');
    expect(refresh(model, T0 + 4100).model.state.phase).toBe('idle');
    model = send(
      model,
      { event: 'Notification', notificationType: 'permission_prompt' },
      T0 + 5000,
    );
    expect(model.state.phase).toBe('waiting_for_user');
    model = send(model, { event: 'Notification', notificationType: 'auth_success' }, T0 + 5100);
    expect(model.state.phase).toBe('waiting_for_user');
    const stopped = applyEvent(model, event({ event: 'Stop' }, T0 + 6000), T0 + 6000);
    expect(stopped.cues).toContainEqual({ cue: 'cheer' });
    expect(stopped.model.state.phase).toBe('idle');
    model = send(stopped.model, { event: 'SessionEnd', reason: 'other' }, T0 + 7000);
    expect(model.state.phase).toBe('done');
  });

  it('camps for at least 3.5 s', () => {
    const model = send(fresh(), { event: 'PreCompact', trigger: 'manual' }, T0);
    const done = applyFacts(
      model,
      [{ fact: 'boundary', uuid: 'b', at: T0 + 100, trigger: 'manual', preservedUuids: [] }],
      T0 + 100,
    ).model;
    expect(refresh(done, T0 + 3000).model.state.phase).toBe('camping');
    expect(refresh(done, T0 + 3700).model.state.phase).toBe('idle');
  });

  it('returns the same model from refresh when nothing changed', () => {
    const model = fresh();
    expect(refresh(model, T0 + 10).model).toBe(model);
  });
});

describe('context and window', () => {
  it('prefers the status line over transcript usage for the same moment', () => {
    let model = send(
      fresh(),
      {
        event: 'StatusLine',
        windowTokens: 200_000,
        contextTokens: 150_000,
        model: 'claude-opus-5',
      },
      T0 + 10,
    );
    model = applyFacts(
      model,
      [{ fact: 'usage', uuid: 'u', at: T0 + 5, contextTokens: 1 }],
      T0,
    ).model;
    expect(model.state).toMatchObject({
      contextTokens: 150_000,
      contextSource: 'statusline',
      windowTokens: 200_000,
      compactAtTokens: 167_000,
    });
    expect(model.state.fill).toBeCloseTo(150 / 167);
    expect(model.state.windowFill).toBeCloseTo(0.75);
    model = applyFacts(
      model,
      [{ fact: 'usage', uuid: 'v', at: T0 + 20, contextTokens: 160_000 }],
      T0,
    ).model;
    expect(model.state.contextSource).toBe('transcript');
  });

  it('estimates context after a boundary from the opening size plus postTokens', () => {
    const facts: TranscriptFact[] = [
      { fact: 'usage', uuid: 'a', at: T0, contextTokens: 40_000 },
      { fact: 'usage', uuid: 'b', at: T0 + 1, contextTokens: 900_000 },
      {
        fact: 'boundary',
        uuid: 'c',
        at: T0 + 2,
        trigger: 'manual',
        preservedUuids: [],
        postTokens: 15_000,
      },
    ];
    const { state } = applyFacts(fresh(), facts, T0).model;
    expect(state).toMatchObject({ contextTokens: 55_000, contextSource: 'estimate' });
  });

  it('keeps the [1m] model id when the bare id shows up in usage', () => {
    const facts: TranscriptFact[] = [
      { fact: 'model', uuid: 'm', at: T0, modelId: 'claude-opus-4-6[1m]' },
      { fact: 'usage', uuid: 'u', at: T0, contextTokens: 5, model: 'claude-opus-4-6' },
    ];
    const { state } = applyFacts(fresh(), facts, T0).model;
    expect(state.model).toBe('claude-opus-4-6[1m]');
    expect(state.windowTokens).toBe(1_000_000);
  });
});

describe('companions', () => {
  it('tracks subagents with satchels and stable hats, and ignores internal agents', () => {
    let model = fresh();
    const sub = (agentId: string, agentType: string) => ({ agentId, agentType });
    model = send(model, { event: 'SubagentStart', ...sub('a1', 'Explore') }, T0);
    model = send(model, { event: 'SubagentStart', ...sub('a2', 'Plan') }, T0);
    model = send(model, { event: 'SubagentStart', ...sub('a3', '') }, T0);
    model = send(model, { event: 'PostToolUse', tool: tool('s1'), ...sub('a1', 'Explore') }, T0);
    model = send(model, { event: 'SubagentStop', reportChars: 4000, ...sub('a1', 'Explore') }, T0);
    model = send(model, { event: 'SubagentStop', reportChars: 10, ...sub('a9', '') }, T0);
    const { subagents } = model.state;
    expect(Object.keys(subagents)).toEqual(['a1', 'a2']);
    expect(subagents.a1).toMatchObject({ status: 'returned', reportTokens: 1000, hat: 0 });
    expect(subagents.a2).toMatchObject({ status: 'active', hat: 1 });
    expect(subagents.a1?.items).toEqual([model.state.items[0]?.id]);
    expect(model.state.items[0]?.agentId).toBe('a1');
  });
});

describe('compaction summary mentions', () => {
  it('marks which pins the summary names', () => {
    let model = send(fresh(), { event: 'PostToolUse', tool: tool('t1') }, T0);
    model = send(
      model,
      {
        event: 'PostToolUse',
        tool: tool('t2', { label: 'src/b.ts', path: 'C:\\work\\demo-app\\src\\b.ts' }),
      },
      T0 + 1,
    );
    const [a, b] = model.state.items;
    const pin = (item: Item): Pin => ({
      itemId: item.id,
      kind: item.kind,
      label: item.label,
      pinnedAt: T0,
    });
    model = applyPins(model, [pin(a!), pin(b!)], T0).model;
    const summary: TranscriptFact = {
      fact: 'summary',
      uuid: 'summary-1',
      at: T0 + 10,
      chars: 40,
      mentionedPinIds: [a!.id],
    };
    model = applyFacts(model, [summary], T0 + 10).model;
    expect(model.state.items.find(i => i.id === a!.id)?.mentionedInSummary).toBe(true);
    expect(model.state.items.find(i => i.id === b!.id)?.mentionedInSummary).toBe(false);
  });
});
