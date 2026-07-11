/**
 * `slack` admin-notification transport: posts the notification to a Slack **incoming webhook**
 * (env `SLACK_WEBHOOK_URL`). Self-contained (native fetch, no SDK/deps), so it is a normal registry
 * plugin created via `create(ctx)`. Best-effort per the AdminNotifier contract: transport errors
 * and non-2xx responses are logged and swallowed, never thrown.
 */
import type { AdminNotification, AdminNotifier, PluginLogger } from '../../plugin-sdk/index.js';

export class SlackAdminNotifier implements AdminNotifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly logger: PluginLogger,
  ) {}

  async notify(notification: AdminNotification): Promise<void> {
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `*${notification.title}*\n${notification.body}` }),
      });
      if (!response.ok) {
        this.logger.warn(`slack admin-notification failed: HTTP ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`slack admin-notification error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
