import type { BackpackConfig, ClaudeWindowEnv } from './config';

export interface WindowSettings {
  config: BackpackConfig;
  claude: ClaudeWindowEnv;
}

export interface WindowSize {
  windowTokens: number;
  compactAtTokens: number;
}

const STANDARD_WINDOW = 200_000;
const LARGE_WINDOW = 1_000_000;
/**
 * Claude Code reserves room for the reply and a safety margin before it auto compacts. On a
 * 1M window this lands at the documented 967K and matches the local preTokens samples.
 */
const COMPACT_HEADROOM = 33_000;

interface ModelVersion {
  family: 'opus' | 'sonnet' | 'haiku' | 'fable';
  major?: number;
  minor: number;
}

function parseVersion(base: string): ModelVersion | undefined {
  const match = /(opus|sonnet|haiku|fable)(?:-(\d+)(?:[-.](\d{1,2})(?!\d))?)?/.exec(base);
  if (!match) return undefined;
  const family = match[1];
  if (family !== 'opus' && family !== 'sonnet' && family !== 'haiku' && family !== 'fable') {
    return undefined;
  }
  const major = match[2] === undefined ? undefined : Number(match[2]);
  return { family, minor: Number(match[3] ?? 0), ...(major === undefined ? {} : { major }) };
}

function atLeast(version: ModelVersion, major: number, minor: number): boolean {
  if (version.major === undefined) return true;
  return version.major > major || (version.major === major && version.minor >= minor);
}

/** The window a model gets with no overrides, from the families in the model config docs. */
export function nativeWindow(modelId: string | undefined): number {
  if (modelId === undefined) return STANDARD_WINDOW;
  const id = modelId.toLowerCase();
  if (id.includes('[1m]')) return LARGE_WINDOW;
  const base = id.replace(/\[[^\]]*\]/g, '');
  if (/claude-(instant|2|3)/.test(base)) return STANDARD_WINDOW;
  const version = parseVersion(base);
  if (!version) return STANDARD_WINDOW;
  switch (version.family) {
    case 'fable':
      return LARGE_WINDOW;
    case 'haiku':
      return STANDARD_WINDOW;
    case 'opus':
      return atLeast(version, 4, 7) ? LARGE_WINDOW : STANDARD_WINDOW;
    case 'sonnet':
      return atLeast(version, 5, 0) ? LARGE_WINDOW : STANDARD_WINDOW;
  }
}

export function matchesPattern(pattern: string, modelId: string): boolean {
  const escaped = pattern
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'i').test(modelId);
}

function overrideFor(config: BackpackConfig, modelId: string | undefined): number | undefined {
  if (modelId === undefined) return undefined;
  return config.windows.find(o => matchesPattern(o.pattern, modelId))?.tokens;
}

function windowFor(
  modelId: string | undefined,
  settings: WindowSettings,
  statusLineWindow: number | undefined,
): number {
  if (statusLineWindow !== undefined && statusLineWindow > 0) return statusLineWindow;
  const override = overrideFor(settings.config, modelId);
  if (override !== undefined) return override;
  const native = nativeWindow(modelId);
  return settings.claude.disable1m && native > STANDARD_WINDOW ? STANDARD_WINDOW : native;
}

function compactPoint(windowTokens: number, settings: WindowSettings): number {
  const configured = settings.config.compactAt;
  if (configured !== undefined) {
    return Math.round(configured <= 1 ? configured * windowTokens : configured);
  }
  const auto = settings.claude.autoCompactWindow;
  if (auto !== undefined) return auto;
  return windowTokens > COMPACT_HEADROOM * 3
    ? windowTokens - COMPACT_HEADROOM
    : Math.round(windowTokens * 0.9);
}

/** Resolves the window and compaction point. The status line reports the true window, so it wins. */
export function resolveWindow(
  modelId: string | undefined,
  settings: WindowSettings,
  statusLineWindow?: number,
): WindowSize {
  const windowTokens = windowFor(modelId, settings, statusLineWindow);
  const compactAtTokens = Math.max(1, Math.min(windowTokens, compactPoint(windowTokens, settings)));
  return { windowTokens, compactAtTokens };
}
