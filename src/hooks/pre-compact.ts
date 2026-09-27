import { runObserver, triggerOf } from './_shared';

runObserver(({ input, envelope }) => ({
  ...envelope,
  event: 'PreCompact',
  trigger: triggerOf(input),
}));
