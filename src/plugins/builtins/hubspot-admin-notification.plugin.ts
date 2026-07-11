import { definePlugin } from '../../plugin-sdk/index.js';
import { HubSpotAdminNotifier } from '../notifications/hubspot-admin-notifier.js';

/** HubSpot admin notifications as CRM tickets (env HUBSPOT_ACCESS_TOKEN + pipeline/stage). */
export const hubspotAdminNotificationPlugin = definePlugin({
  kind: 'admin-notification',
  key: 'hubspot',
  create: (ctx) =>
    new HubSpotAdminNotifier(
      ctx.requireEnv('HUBSPOT_ACCESS_TOKEN'),
      ctx.requireEnv('HUBSPOT_TICKET_PIPELINE'),
      ctx.requireEnv('HUBSPOT_TICKET_STAGE'),
      ctx.logger,
      ctx.env('HUBSPOT_BASE_URL'),
    ),
});
