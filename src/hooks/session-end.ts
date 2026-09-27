import { getString } from '../core/json';
import { runObserver } from './_shared';

runObserver(({ input, envelope }) => ({
  ...envelope,
  event: 'SessionEnd',
  reason: getString(input, 'reason') ?? 'other',
}));
