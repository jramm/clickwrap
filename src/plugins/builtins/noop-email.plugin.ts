import { definePlugin } from '../../plugin-sdk';
import { NoopEmailProvider } from '../email/noop/noop.provider';

/** Default e-mail provider (dev/tests): sends nothing, logs the recipient. No delivery tracking. */
export const noopEmailPlugin = definePlugin({
  kind: 'email-provider',
  key: 'noop',
  create: () => new NoopEmailProvider(),
});
