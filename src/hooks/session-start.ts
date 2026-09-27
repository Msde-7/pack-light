import { buildPinContext } from '../core/inject';
import { getObject, getString, type JsonObject } from '../core/json';
import { SESSION_SOURCES, type SessionSource } from '../core/protocol';
import { readPins } from '../core/store';
import { additionalContext, postEvent, readHookInput, runHook, writeOut } from './_shared';

/** The pins are already printed by then, so the POST gets less time to keep the hook fast. */
const COMPACT_POST_TIMEOUT_MS = 50;

function sourceOf(value: string | undefined): SessionSource {
  return SESSION_SOURCES.find(source => source === value) ?? 'startup';
}

function modelOf(input: JsonObject): string | undefined {
  return getString(input, 'model') ?? getString(getObject(input, 'model'), 'id');
}

runHook(async () => {
  const hook = await readHookInput();
  if (hook === undefined) return;
  const { input, envelope } = hook;
  const source = sourceOf(getString(input, 'source'));
  if (source === 'compact') {
    const context = buildPinContext(readPins(envelope.sessionId));
    if (context !== undefined) await writeOut(additionalContext('SessionStart', context));
  }
  const model = modelOf(input);
  await postEvent(
    { ...envelope, event: 'SessionStart', source, ...(model === undefined ? {} : { model }) },
    source === 'compact' ? COMPACT_POST_TIMEOUT_MS : undefined,
  );
});
