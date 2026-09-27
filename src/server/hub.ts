import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { paths } from '../core/paths';
import type { HookEvent, SceneCue } from '../core/protocol';
import {
  applyEvent,
  applyFacts,
  applyPins,
  applyRepackQueue,
  createSession,
  refresh,
  type SessionModel,
  type Update,
} from '../core/session';
import { mentionedPinIds } from '../core/inject';
import { readPins, readRepack } from '../core/store';
import {
  createTranscriptReader,
  type TranscriptFact,
  type TranscriptReader,
} from '../core/transcript';
import type { SessionState } from '../core/types';
import type { WindowSettings } from '../core/window';
import { subagentTranscriptPath } from './discover';
import { createTailer, type Tailer } from './tailer';

export interface HubOptions {
  settings: WindowSettings;
  /** Called after every change with the new state and the cues it produced. */
  emit: (state: SessionState, cues: SceneCue[]) => void;
  now?: () => number;
}

export interface SessionHub {
  ingest: (event: HookEvent) => Promise<void>;
  /** Starts following a transcript found on disk, without any hook event yet. */
  track: (sessionId: string, transcriptPath: string) => Promise<void>;
  list: () => SessionState[];
  get: (sessionId: string) => SessionState | undefined;
  /** Re-reads pins.json and repack.json after the server wrote them. */
  reloadStore: (sessionId: string) => void;
  /** Polls transcripts, checks pin files and re-evaluates phase timers. */
  tick: () => Promise<void>;
  remove: (sessionId: string) => boolean;
}

interface AgentTail {
  tailer: Tailer;
  reader: TranscriptReader;
}

interface Entry {
  model: SessionModel;
  reader: TranscriptReader;
  tailer?: Tailer;
  ready: Promise<void>;
  catchingUp: boolean;
  storeStamp: string;
  agents: Map<string, AgentTail>;
  agentPaths: Map<string, string>;
}

/** Matches pins against compaction summaries inside the parser, so no summary text leaves it. */
function readerFor(entry: () => Entry): TranscriptReader {
  return createTranscriptReader(summary => mentionedPinIds(entry().model.state.pins, summary));
}

function isTranscriptPath(path: string): boolean {
  return path.endsWith('.jsonl') && isAbsolute(path);
}

function fileStamp(file: string): string {
  try {
    const info = statSync(file);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return 'none';
  }
}

function storeStamp(sessionId: string): string {
  return `${fileStamp(paths.pins(sessionId))}|${fileStamp(paths.repack(sessionId))}`;
}

export function createSessionHub(options: HubOptions): SessionHub {
  const now = options.now ?? Date.now;
  const sessions = new Map<string, Entry>();

  function commit(entry: Entry, update: Update): void {
    if (update.model === entry.model) return;
    entry.model = update.model;
    if (entry.catchingUp) return;
    options.emit(entry.model.state, update.cues);
  }

  /** A new model with the session's pins and repack queue already laid on. */
  function freshModel(sessionId: string, cwd: string, transcriptPath: string, at: number) {
    const model = createSession({ sessionId, cwd, transcriptPath, at }, options.settings);
    const pinned = applyPins(model, readPins(sessionId), now()).model;
    return applyRepackQueue(pinned, readRepack(sessionId), now()).model;
  }

  function onFacts(entry: Entry, facts: readonly TranscriptFact[]): void {
    if (facts.length > 0) commit(entry, applyFacts(entry.model, facts, now()));
  }

  function rebuild(entry: Entry): void {
    const { sessionId, cwd, transcriptPath, startedAt } = entry.model.state;
    entry.model = freshModel(sessionId, cwd, transcriptPath, startedAt);
    entry.reader = readerFor(() => entry);
  }

  function attachTailer(entry: Entry, path: string): void {
    entry.tailer = createTailer({
      path,
      onText: text => {
        onFacts(entry, entry.reader.feed(text));
      },
      onReset: () => {
        rebuild(entry);
      },
    });
  }

  async function catchUp(entry: Entry): Promise<void> {
    entry.catchingUp = true;
    try {
      await entry.tailer?.poll();
    } finally {
      entry.catchingUp = false;
    }
    options.emit(entry.model.state, []);
  }

  function create(sessionId: string, cwd: string, transcriptPath: string, at: number): Entry {
    const entry: Entry = {
      model: freshModel(sessionId, cwd, transcriptPath, at),
      reader: readerFor(() => entry),
      ready: Promise.resolve(),
      catchingUp: false,
      storeStamp: storeStamp(sessionId),
      agents: new Map(),
      agentPaths: new Map(),
    };
    if (isTranscriptPath(transcriptPath)) attachTailer(entry, transcriptPath);
    sessions.set(sessionId, entry);
    entry.ready = catchUp(entry);
    return entry;
  }

  function ensure(sessionId: string, cwd: string, transcriptPath: string, at: number): Entry {
    const entry = sessions.get(sessionId) ?? create(sessionId, cwd, transcriptPath, at);
    if (!entry.tailer && isTranscriptPath(transcriptPath)) {
      attachTailer(entry, transcriptPath);
      entry.ready = entry.ready.then(() => catchUp(entry));
    }
    return entry;
  }

  function resume(entry: Entry): void {
    if (!entry.tailer) return;
    entry.tailer.rewind();
    rebuild(entry);
    entry.ready = entry.ready.then(() => catchUp(entry));
  }

  function rememberAgentPath(entry: Entry, event: HookEvent): void {
    if (event.event !== 'SubagentStop' || event.agentId === undefined) return;
    const path = event.agentTranscriptPath;
    if (path !== undefined && isTranscriptPath(path)) entry.agentPaths.set(event.agentId, path);
  }

  async function ingest(event: HookEvent): Promise<void> {
    const entry = ensure(event.sessionId, event.cwd, event.transcriptPath, event.at);
    if (event.event === 'SessionStart' && event.source === 'resume') resume(entry);
    await entry.ready;
    rememberAgentPath(entry, event);
    commit(entry, applyEvent(entry.model, event, now()));
  }

  function agentPath(entry: Entry, agentId: string): string | undefined {
    const known = entry.agentPaths.get(agentId);
    if (known !== undefined) return known;
    const parent = entry.model.state.transcriptPath;
    return isTranscriptPath(parent) ? subagentTranscriptPath(parent, agentId) : undefined;
  }

  function agentTail(entry: Entry, agentId: string, path: string): AgentTail {
    const tail: AgentTail = {
      reader: createTranscriptReader(),
      tailer: createTailer({
        path,
        onText: text => {
          const usage = tail.reader
            .feed(text)
            .filter(fact => fact.fact === 'usage')
            .map(fact => ({ ...fact, agentId }));
          onFacts(entry, usage);
        },
        onReset: () => {
          tail.reader = createTranscriptReader();
        },
      }),
    };
    return tail;
  }

  /** Follows each companion's own transcript for its context size, then lets go once it returns. */
  async function pollAgents(entry: Entry): Promise<void> {
    for (const companion of Object.values(entry.model.state.subagents)) {
      const { agentId } = companion;
      let tail = entry.agents.get(agentId);
      const settled = companion.status === 'returned' && companion.contextTokens !== undefined;
      if (!tail && settled) continue;
      if (!tail) {
        const path = agentPath(entry, agentId);
        if (path === undefined) continue;
        tail = agentTail(entry, agentId, path);
        entry.agents.set(agentId, tail);
      }
      await tail.tailer.poll();
      if (companion.status === 'returned') entry.agents.delete(agentId);
    }
  }

  function checkStore(entry: Entry, force = false): void {
    const { sessionId } = entry.model.state;
    const stamp = storeStamp(sessionId);
    if (stamp === entry.storeStamp && !force) return;
    entry.storeStamp = stamp;
    commit(entry, applyPins(entry.model, readPins(sessionId), now()));
    commit(entry, applyRepackQueue(entry.model, readRepack(sessionId), now()));
  }

  let ticks = 0;
  async function tick(): Promise<void> {
    ticks += 1;
    for (const entry of sessions.values()) {
      if (entry.catchingUp) continue;
      await entry.tailer?.poll();
      if (ticks % 4 === 0) {
        checkStore(entry);
        await pollAgents(entry);
      }
      commit(entry, refresh(entry.model, now()));
    }
  }

  return {
    ingest,
    async track(sessionId, transcriptPath) {
      await ensure(sessionId, '', transcriptPath, now()).ready;
    },
    list: () => [...sessions.values()].map(entry => entry.model.state),
    get: sessionId => sessions.get(sessionId)?.model.state,
    reloadStore(sessionId) {
      const entry = sessions.get(sessionId);
      if (entry) checkStore(entry, true);
    },
    tick,
    remove: sessionId => sessions.delete(sessionId),
  };
}
