/**
 * Built-in plugins. They use the exact same `definePlugin` shape and go through the exact same
 * registry (duplicate checks, context, module mounting) as external packages — no special path.
 * Only their loading differs trivially: they are compiled in instead of discovered on disk.
 */
import type { AnyClickwrapPlugin } from '../../plugin-sdk/index.js';
import { defaultAcceptancePagePlugin } from './default-acceptance-page.plugin.js';
import { googleSsoAdminAuthPlugin } from './google-sso-admin-auth.plugin.js';
import { hubspotAdminNotificationPlugin } from './hubspot-admin-notification.plugin.js';
import { slackAdminNotificationPlugin } from './slack-admin-notification.plugin.js';
import { localFileStoragePlugin } from './local-file-storage.plugin.js';
import { memoryFileStoragePlugin } from './memory-file-storage.plugin.js';
import { noopEmailPlugin } from './noop-email.plugin.js';
import { postmarkEmailPlugin } from './postmark-email.plugin.js';
import { s3FileStoragePlugin } from './s3-file-storage.plugin.js';
import { smtpEmailPlugin } from './smtp-email.plugin.js';
import { staticTokenAdminAuthPlugin } from './static-token-admin-auth.plugin.js';
import { supertokensAdminAuthPlugin } from './supertokens-admin-auth.plugin.js';

export const builtinPlugins: AnyClickwrapPlugin[] = [
  noopEmailPlugin,
  postmarkEmailPlugin,
  smtpEmailPlugin,
  memoryFileStoragePlugin,
  localFileStoragePlugin,
  s3FileStoragePlugin,
  googleSsoAdminAuthPlugin,
  staticTokenAdminAuthPlugin,
  supertokensAdminAuthPlugin,
  defaultAcceptancePagePlugin,
  slackAdminNotificationPlugin,
  hubspotAdminNotificationPlugin,
];
