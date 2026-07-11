/**
 * `hubspot` admin-notification transport: creates a HubSpot CRM **ticket** for the event via the
 * CRM v3 API (private-app token). Config: HUBSPOT_ACCESS_TOKEN + the target HUBSPOT_TICKET_PIPELINE
 * and HUBSPOT_TICKET_STAGE (a ticket cannot exist without a pipeline stage). Self-contained (native
 * fetch, no deps). Best-effort per the AdminNotifier contract: transport errors and non-2xx
 * responses are logged and swallowed, never thrown.
 */
import type { AdminNotification, AdminNotifier, PluginLogger } from '../../plugin-sdk/index.js';

const DEFAULT_BASE_URL = 'https://api.hubapi.com';

export class HubSpotAdminNotifier implements AdminNotifier {
  constructor(
    private readonly accessToken: string,
    private readonly pipeline: string,
    private readonly stage: string,
    private readonly logger: PluginLogger,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async notify(notification: AdminNotification): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/crm/v3/objects/tickets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          properties: {
            subject: notification.title,
            content: notification.body,
            hs_pipeline: this.pipeline,
            hs_pipeline_stage: this.stage,
          },
        }),
      });
      if (!response.ok) {
        this.logger.warn(`hubspot admin-notification ticket failed: HTTP ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`hubspot admin-notification error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
