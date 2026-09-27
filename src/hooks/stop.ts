import { runObserver } from './_shared';

runObserver(({ envelope }) => ({ ...envelope, event: 'Stop' }));
