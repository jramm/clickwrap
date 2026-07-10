import { definePlugin } from '../../plugin-sdk';
import { MainPortalCustomerSource } from '../customer-source/mainportal/mainportal.source';

/** Default provider-groups endpoint path; overridable via MAINPORTAL_PROVIDER_GROUPS_PATH. */
const DEFAULT_PROVIDER_GROUPS_PATH = '/system/v1/provider-groups';

/**
 * Main-Portal customer source (activated via CUSTOMER_SOURCE=mainportal). Reads its config from env
 * exactly like the other built-ins: MAINPORTAL_BASE_URL and MAINPORTAL_API_TOKEN (both mandatory —
 * `requireEnv` fails the boot with a descriptive error naming this plugin when they are missing) and
 * MAINPORTAL_PROVIDER_GROUPS_PATH (defaulted). The token is a `system_api` bearer JWT; it is never
 * logged. See docs/integrations/mainportal-provider-groups.md for the endpoint contract.
 */
export const mainportalCustomerSourcePlugin = definePlugin({
  kind: 'customer-source',
  key: 'mainportal',
  create: (ctx) =>
    new MainPortalCustomerSource({
      baseUrl: ctx.requireEnv('MAINPORTAL_BASE_URL'),
      apiToken: ctx.requireEnv('MAINPORTAL_API_TOKEN'),
      providerGroupsPath: ctx.env('MAINPORTAL_PROVIDER_GROUPS_PATH', DEFAULT_PROVIDER_GROUPS_PATH) as string,
    }),
});
