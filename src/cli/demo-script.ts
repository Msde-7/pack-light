import { kindOf } from '../core/estimate';
import { stableItemId } from '../core/ids';
import type { HookEvent, ToolSummary } from '../core/protocol';

export type DemoEventBody = HookEvent extends infer E
  ? E extends HookEvent
    ? Omit<E, 'v' | 'sessionId' | 'transcriptPath' | 'cwd' | 'at'>
    : never
  : never;

export type DemoAction =
  | { type: 'event'; sessionId: string; body: DemoEventBody }
  | { type: 'pin'; sessionId: string; itemId: string; note: string }
  | { type: 'repack'; sessionId: string; itemIds: string[] };

export interface DemoStep {
  /** Pause before this step, in milliseconds at speed 1. */
  wait: number;
  action: DemoAction;
}

export interface DemoSession {
  sessionId: string;
  cwd: string;
}

const DEMO_WINDOW = 200_000;
export const TRAIL: DemoSession = { sessionId: 'demo-trail-app', cwd: '/home/hiker/trail-app' };
export const API: DemoSession = { sessionId: 'demo-api-server', cwd: '/home/hiker/api-server' };
const EXPLORER = 'demo-explorer';

export function demoItemId(session: DemoSession, toolUseId: string): string {
  return stableItemId(session.sessionId, `tool:${toolUseId}`);
}

function tool(
  toolUseId: string,
  toolName: string,
  label: string,
  tokens: number,
  path?: string,
): ToolSummary {
  return {
    toolUseId,
    toolName,
    kind: kindOf(toolName),
    label,
    tokens,
    ...(path === undefined ? {} : { path }),
  };
}

function file(session: DemoSession, relative: string): string {
  return `${session.cwd}/${relative}`;
}

class Script {
  readonly steps: DemoStep[] = [];

  constructor(private readonly session: DemoSession) {}

  event(wait: number, body: DemoEventBody): this {
    this.steps.push({ wait, action: { type: 'event', sessionId: this.session.sessionId, body } });
    return this;
  }

  /** A tool call followed by the status line reporting the new context size. */
  use(wait: number, summary: ToolSummary, contextTokens: number, agentId?: string): this {
    const agent = agentId === undefined ? {} : { agentId, agentType: 'Explore' };
    this.steps.push({
      wait,
      action: {
        type: 'event',
        sessionId: this.session.sessionId,
        body: { event: 'PostToolUse', tool: summary, ...agent },
      },
    });
    return this.context(200, contextTokens);
  }

  context(wait: number, contextTokens: number): this {
    return this.event(wait, { event: 'StatusLine', windowTokens: DEMO_WINDOW, contextTokens });
  }

  pin(wait: number, toolUseId: string, note: string): this {
    const itemId = demoItemId(this.session, toolUseId);
    this.steps.push({
      wait,
      action: { type: 'pin', sessionId: this.session.sessionId, itemId, note },
    });
    return this;
  }

  repack(wait: number, toolUseIds: string[]): this {
    const itemIds = toolUseIds.map(id => demoItemId(this.session, id));
    this.steps.push({
      wait,
      action: { type: 'repack', sessionId: this.session.sessionId, itemIds },
    });
    return this;
  }
}

/**
 * One scripted hike through a 200K window. It covers every visible behavior in order: a
 * duplicate read, a loud command, a companion, a pin, a permission wait, an auto compaction,
 * a repack and a finished turn.
 */
export function demoSteps(options: { interactive?: boolean } = {}): DemoStep[] {
  const t = new Script(TRAIL);
  const middleware = file(TRAIL, 'src/auth/middleware.ts');
  const session = file(TRAIL, 'src/auth/session.ts');

  t.event(0, { event: 'SessionStart', source: 'startup', model: 'claude-sonnet-4-6' })
    .context(100, 21_000)
    .event(300, {
      event: 'InstructionsLoaded',
      filePath: file(TRAIL, 'CLAUDE.md'),
      loadReason: 'session_start',
      chars: 5200,
    })
    .event(900, { event: 'UserPromptSubmit', promptChars: 140, repackedIds: [] })
    .use(900, tool('t1', 'Read', 'src/auth/middleware.ts', 3100, middleware), 26_000)
    .use(1100, tool('t2', 'Grep', 'grep: refreshToken', 900, undefined), 27_500)
    .use(1100, tool('t3', 'Read', 'src/auth/session.ts', 2400, session), 30_500)
    .use(1100, tool('t4', 'Read', 'src/auth/middleware.ts', 3100, middleware), 34_000)
    .use(1300, tool('t5', 'Bash', 'npm test -- auth', 12_500), 48_000)
    .event(1200, { event: 'SubagentStart', agentId: EXPLORER, agentType: 'Explore' })
    .use(
      900,
      tool('s1', 'Read', 'docs/oauth.md', 4000, file(TRAIL, 'docs/oauth.md')),
      48_500,
      EXPLORER,
    )
    .use(
      900,
      tool('s2', 'WebFetch', 'datatracker.ietf.org/doc/html/rfc6749', 9000),
      49_000,
      EXPLORER,
    )
    .event(1100, {
      event: 'SubagentStop',
      agentId: EXPLORER,
      agentType: 'Explore',
      reportChars: 6400,
    })
    .use(300, tool('t6', 'Agent', 'Explore the refresh flow', 1600), 55_000)
    .use(1100, tool('t7', 'Read', 'src/auth/middleware.ts', 3100, middleware), 62_000)
    .pin(1200, 't1', 'the 401 comes from a token refresh race in refreshSession()')
    .use(1300, tool('t8', 'Edit', 'edit: src/auth/session.ts', 600, session), 74_000)
    .use(1100, tool('t9', 'WebSearch', 'search: jwt clock skew leeway', 5200), 96_000)
    .use(1200, tool('t10', 'Bash', 'npm run build', 21_000), 128_000)
    .event(1400, { event: 'Notification', notificationType: 'permission_prompt' })
    .use(3200, tool('t11', 'Bash', 'npm test', 9000), 152_000)
    .use(
      1400,
      tool('t12', 'Read', 'src/auth/token-store.ts', 4200, file(TRAIL, 'src/auth/token-store.ts')),
      163_000,
    )
    .event(1400, { event: 'PreCompact', trigger: 'auto' })
    .event(600, {
      event: 'PostCompact',
      trigger: 'auto',
      mentionedPinIds: [demoItemId(TRAIL, 't1')],
    })
    .context(100, 38_000)
    .event(200, { event: 'SessionStart', source: 'compact' })
    .repack(4200, ['t5'])
    .event(1500, {
      event: 'UserPromptSubmit',
      promptChars: 90,
      repackedIds: [],
    })
    .use(900, tool('t13', 'Read', 'src/auth/session.ts', 2400, session), 44_000)
    .use(1100, tool('t14', 'Bash', 'npm test -- auth', 1500), 46_000)
    .event(1200, { event: 'Stop' });

  const api = new Script(API)
    .event(3000, { event: 'SessionStart', source: 'startup', model: 'claude-sonnet-4-6' })
    .context(100, 19_000)
    .use(2600, tool('a1', 'Read', 'src/routes.ts', 2200, file(API, 'src/routes.ts')), 24_000)
    .use(4000, tool('a2', 'Bash', 'npm run lint', 1800), 27_000)
    .event(2000, { event: 'Stop' });

  const steps = interleave(t.steps, api.steps);
  return options.interactive === true ? withoutHands(steps) : steps;
}

/** Drops the pin and the repack for a person to do at the page, keeping the pacing. */
function withoutHands(steps: DemoStep[]): DemoStep[] {
  let carried = 0;
  return steps.flatMap(step => {
    if (step.action.type !== 'event') {
      carried += step.wait;
      return [];
    }
    const kept = { wait: step.wait + carried, action: step.action };
    carried = 0;
    return [kept];
  });
}

/** Merges two timelines by absolute time, keeping each one's own pacing. */
function interleave(a: DemoStep[], b: DemoStep[]): DemoStep[] {
  const timed = [...absolute(a), ...absolute(b)].sort((x, y) => x.at - y.at);
  let previous = 0;
  return timed.map(({ at, action }) => {
    const wait = at - previous;
    previous = at;
    return { wait, action };
  });
}

function absolute(steps: DemoStep[]): { at: number; action: DemoAction }[] {
  let at = 0;
  return steps.map(step => {
    at += step.wait;
    return { at, action: step.action };
  });
}
