import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, parseClaudeWindowEnv, parseConfig } from './config';
import { matchesPattern, nativeWindow, resolveWindow, type WindowSettings } from './window';

const plain: WindowSettings = { config: DEFAULT_CONFIG, claude: { disable1m: false } };

describe('nativeWindow', () => {
  it.each([
    ['claude-opus-5', 1_000_000],
    ['claude-opus-5[1m]', 1_000_000],
    ['claude-opus-4-7', 1_000_000],
    ['claude-opus-4-6', 200_000],
    ['claude-opus-4-6[1m]', 1_000_000],
    ['claude-opus-4-20250514', 200_000],
    ['claude-sonnet-5', 1_000_000],
    ['claude-sonnet-4-5-20250929', 200_000],
    ['claude-haiku-4-5', 200_000],
    ['claude-fable-5-1', 1_000_000],
    ['claude-3-5-sonnet-20241022', 200_000],
    ['opus', 1_000_000],
    ['gpt-something', 200_000],
  ])('%s has a %i window', (model, tokens) => {
    expect(nativeWindow(model)).toBe(tokens);
  });

  it('assumes the smaller window when the model is unknown', () => {
    expect(nativeWindow(undefined)).toBe(200_000);
  });
});

describe('resolveWindow', () => {
  it('puts the compaction point at the documented 967K on a 1M model', () => {
    expect(resolveWindow('claude-opus-5[1m]', plain)).toEqual({
      windowTokens: 1_000_000,
      compactAtTokens: 967_000,
    });
  });

  it('prefers the status line window over everything', () => {
    expect(resolveWindow('claude-opus-5', plain, 200_000).windowTokens).toBe(200_000);
  });

  it('honors CLAUDE_CODE_DISABLE_1M_CONTEXT', () => {
    const settings = { ...plain, claude: { disable1m: true } };
    expect(resolveWindow('claude-opus-5[1m]', settings).windowTokens).toBe(200_000);
  });

  it('applies user overrides by pattern and autoCompactWindow', () => {
    const settings: WindowSettings = {
      config: parseConfig({ windows: { 'claude-opus-*': 500_000 } }),
      claude: { disable1m: false, autoCompactWindow: 400_000 },
    };
    expect(resolveWindow('claude-opus-5', settings)).toEqual({
      windowTokens: 500_000,
      compactAtTokens: 400_000,
    });
  });

  it('takes compactAt from config as tokens or a fraction', () => {
    const tokens = { ...plain, config: parseConfig({ compactAt: 800_000 }) };
    const fraction = { ...plain, config: parseConfig({ compactAt: 0.5 }) };
    expect(resolveWindow('claude-opus-5', tokens).compactAtTokens).toBe(800_000);
    expect(resolveWindow('claude-opus-5', fraction).compactAtTokens).toBe(500_000);
  });
});

describe('matchesPattern', () => {
  it('matches wildcards case-insensitively and escapes the rest', () => {
    expect(matchesPattern('claude-opus-4-6*', 'Claude-Opus-4-6[1m]')).toBe(true);
    expect(matchesPattern('a.b', 'axb')).toBe(false);
  });
});

describe('config parsing', () => {
  it('falls back to defaults for junk', () => {
    expect(parseConfig('nope')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig({ weights: { book: 9000, brick: 10, anvil: 5 } }).weights).toEqual(
      DEFAULT_CONFIG.weights,
    );
    expect(parseConfig({ windows: { x: 'big', '': 5000, y: 10 } }).windows).toEqual([]);
  });

  it('reads Claude settings and lets the env var win', () => {
    expect(parseClaudeWindowEnv({ autoCompactWindow: 300_000 }, {})).toEqual({
      disable1m: false,
      autoCompactWindow: 300_000,
    });
    expect(
      parseClaudeWindowEnv(
        { autoCompactWindow: 300_000 },
        { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '250000', CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' },
      ),
    ).toEqual({ disable1m: true, autoCompactWindow: 250_000 });
    expect(parseClaudeWindowEnv(null, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'lots' })).toEqual({
      disable1m: false,
    });
  });
});
