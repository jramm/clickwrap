import { definePlugin } from '../../plugin-sdk/index.js';
import { NoopEmailProvider } from '../email/noop/noop.provider.js';

/** Default e-mail provider (dev/tests): sends nothing, logs the recipient. No delivery tracking. */
export const noopEmailPlugin = definePlugin({
  kind: 'email-provider',
  key: 'noop',
  create: () => new NoopEmailProvider(),
});
