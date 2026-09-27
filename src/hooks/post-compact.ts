import { mentionedPinIds } from '../core/inject';
import { getString } from '../core/json';
import { readPins } from '../core/store';
import { runObserver, triggerOf } from './_shared';

// The summary is only matched against pin names here. It is never sent or stored.
runObserver(({ input, envelope }) => {
  const summary = getString(input, 'compact_summary') ?? '';
  return {
    ...envelope,
    event: 'PostCompact',
    trigger: triggerOf(input),
    mentionedPinIds: summary === '' ? [] : mentionedPinIds(readPins(envelope.sessionId), summary),
  };
});
