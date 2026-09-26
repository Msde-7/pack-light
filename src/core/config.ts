import { DEFAULT_WEIGHTS, type WeightThresholds } from './estimate';
import { getNumber, getObject, isObject } from './json';

interface WindowOverride {
  /** Model id pattern, `*` matches any run of characters, case-insensitive. */
  pattern: string;
  tokens: number;
}

/** Contents of ~/.pack-light/config.json after validation. */
export interface BackpackConfig {
  weights: WeightThresholds;
  windows: WindowOverride[];
  /** Compaction point, as tokens or as a fraction (0..1] of the window. */
  compactAt?: number;
}

/** What Claude Code itself was told about the window, from settings.json and its env vars. */
export interface ClaudeWindowEnv {
  autoCompactWindow?: number;
  disable1m: boolean;
}

export const DEFAULT_CONFIG: BackpackConfig = { weights: DEFAULT_WEIGHTS, windows: [] };

function positive(value: number | undefined): number | undefined {
  return value !== undefined && value > 0 ? value : undefined;
}

function parseWeights(raw: unknown): WeightThresholds {
  const book = positive(getNumber(raw, 'book')) ?? DEFAULT_WEIGHTS.book;
  const brick = positive(getNumber(raw, 'brick')) ?? DEFAULT_WEIGHTS.brick;
  const anvil = positive(getNumber(raw, 'anvil')) ?? DEFAULT_WEIGHTS.anvil;
  return book < brick && brick < anvil ? { book, brick, anvil } : DEFAULT_WEIGHTS;
}

function parseWindows(raw: unknown): WindowOverride[] {
  if (!isObject(raw)) return [];
  return Object.entries(raw).flatMap(([pattern, tokens]) =>
    typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 1000 && pattern !== ''
      ? [{ pattern, tokens: Math.round(tokens) }]
      : [],
  );
}

export function parseConfig(raw: unknown): BackpackConfig {
  if (!isObject(raw)) return DEFAULT_CONFIG;
  const compactAt = positive(getNumber(raw, 'compactAt'));
  return {
    weights: parseWeights(getObject(raw, 'weights')),
    windows: parseWindows(raw.windows),
    ...(compactAt === undefined ? {} : { compactAt }),
  };
}

function parseTokenCount(text: string | undefined): number | undefined {
  if (text === undefined || !/^\s*\d+\s*$/.test(text)) return undefined;
  return positive(Number(text));
}

function truthy(text: string | undefined): boolean {
  return text !== undefined && /^(1|true|yes|on)$/i.test(text.trim());
}

/** The env var wins over settings.json, matching how Claude Code layers them. */
export function parseClaudeWindowEnv(
  settings: unknown,
  env: Readonly<Record<string, string | undefined>>,
): ClaudeWindowEnv {
  const fromEnv = parseTokenCount(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  const fromSettings = positive(getNumber(settings, 'autoCompactWindow'));
  const autoCompactWindow = fromEnv ?? fromSettings;
  return {
    disable1m: truthy(env.CLAUDE_CODE_DISABLE_1M_CONTEXT),
    ...(autoCompactWindow === undefined ? {} : { autoCompactWindow }),
  };
}
