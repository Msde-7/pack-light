import { packRepack } from '../core/inject';
import { getString } from '../core/json';
import { claimRepack, readRepack, writeRepack } from '../core/store';
import { additionalContext, postEvent, readHookInput, runHook, writeOut } from './_shared';

interface Repack {
  text?: string;
  ids: string[];
}

function takeRepack(sessionId: string): Repack {
  const claimed = claimRepack(sessionId);
  const packed = packRepack(claimed);
  if (packed === undefined) return { ids: [] };
  // Entries that did not fit go back in front of anything queued since the claim.
  const leftover = claimed.filter(entry => !packed.included.includes(entry));
  if (leftover.length > 0) writeRepack(sessionId, [...leftover, ...readRepack(sessionId)]);
  return { text: packed.text, ids: packed.included.map(entry => entry.itemId) };
}

runHook(async () => {
  const hook = await readHookInput();
  if (hook === undefined) return;
  const { input, envelope } = hook;
  const repack = takeRepack(envelope.sessionId);
  if (repack.text !== undefined) {
    await writeOut(additionalContext('UserPromptSubmit', repack.text));
  }
  await postEvent({
    ...envelope,
    event: 'UserPromptSubmit',
    promptChars: getString(input, 'prompt')?.length ?? 0,
    repackedIds: repack.ids,
  });
});
