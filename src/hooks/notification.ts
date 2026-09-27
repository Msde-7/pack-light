import { getString } from '../core/json';
import { runObserver } from './_shared';

runObserver(({ input, envelope }) => ({
  ...envelope,
  event: 'Notification',
  notificationType: getString(input, 'notification_type') ?? '',
}));
