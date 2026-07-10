/**
 * Built-in plugins. They use the exact same `definePlugin` shape and go through the exact same
 * registry (duplicate checks, context, module mounting) as external packages — no special path.
 * Only their loading differs trivially: they are compiled in instead of discovered on disk.
 */
import type { AnyClickwrapPlugin } from '../../plugin-sdk';
import { defaultAcceptancePagePlugin } from './default-acceptance-page.plugin';
import { googleSsoAdminAuthPlugin } from './google-sso-admin-auth.plugin';
import { localFileStoragePlugin } from './local-file-storage.plugin';
import { memoryFileStoragePlugin } from './memory-file-storage.plugin';
import { metergridCustomerSourcePlugin } from './metergrid-customer-source.plugin';
import { noneCustomerSourcePlugin } from './none-customer-source.plugin';
import { noopEmailPlugin } from './noop-email.plugin';
import { postmarkEmailPlugin } from './postmark-email.plugin';
import { smtpEmailPlugin } from './smtp-email.plugin';
import { staticTokenAdminAuthPlugin } from './static-token-admin-auth.plugin';
import { supertokensAdminAuthPlugin } from './supertokens-admin-auth.plugin';

export const builtinPlugins: AnyClickwrapPlugin[] = [
  noopEmailPlugin,
  postmarkEmailPlugin,
  smtpEmailPlugin,
  memoryFileStoragePlugin,
  localFileStoragePlugin,
  googleSsoAdminAuthPlugin,
  staticTokenAdminAuthPlugin,
  supertokensAdminAuthPlugin,
  noneCustomerSourcePlugin,
  metergridCustomerSourcePlugin,
  defaultAcceptancePagePlugin,
];
