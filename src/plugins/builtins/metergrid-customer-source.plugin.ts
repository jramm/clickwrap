import { definePlugin } from '../../plugin-sdk';
import { MetergridCustomerSource } from '../customer-source/metergrid/metergrid.source';

/** Default metergrid partner-API base URL; overridable via METERGRID_BASE_URL. */
const DEFAULT_BASE_URL = 'https://api-partners.metergrid.de';

/**
 * metergrid customer source (activated via CUSTOMER_SOURCE=metergrid). Reads its config from env
 * exactly like the e-mail built-ins: METERGRID_BASE_URL (defaulted), METERGRID_USERNAME and
 * METERGRID_PASSWORD (both mandatory — `requireEnv` fails the boot with a descriptive error naming
 * this plugin when they are missing). Prefer a dedicated service account over a personal login.
 */
export const metergridCustomerSourcePlugin = definePlugin({
  kind: 'customer-source',
  key: 'metergrid',
  create: (ctx) =>
    new MetergridCustomerSource({
      baseUrl: ctx.env('METERGRID_BASE_URL', DEFAULT_BASE_URL) as string,
      username: ctx.requireEnv('METERGRID_USERNAME'),
      password: ctx.requireEnv('METERGRID_PASSWORD'),
    }),
});
