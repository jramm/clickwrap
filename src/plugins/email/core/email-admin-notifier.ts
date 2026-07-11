/**
 * Built-in `email` admin-notification transport: sends the notification to a single configured
 * recipient (ADMIN_NOTIFICATION_EMAIL) through the host's active {@link EmailDeliveryProvider} —
 * i.e. it reuses whichever e-mail plugin (postmark/smtp/noop) is selected, rather than shipping its
 * own transport. Because it depends on that host-provided provider it is constructed host-side (see
 * admin-notification.service.ts) instead of via the plugin registry's `create(ctx)`.
 *
 * Best-effort per the AdminNotifier contract: a send failure is logged and swallowed so it can
 * never block the business action (the objection) that produced the notification.
 */
import type { AdminNotification, AdminNotifier, EmailDeliveryProvider } from '../../../plugin-sdk/index.js';

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface AdminNotifierLogger {
  warn(message: string): void;
}

export class EmailAdminNotifier implements AdminNotifier {
  constructor(
    private readonly provider: EmailDeliveryProvider,
    private readonly recipient: string,
    private readonly logger: AdminNotifierLogger,
  ) {}

  async notify(notification: AdminNotification): Promise<void> {
    try {
      await this.provider.send({
        to: this.recipient,
        subject: notification.title,
        text: notification.body,
        html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(notification.body)}</pre>`,
      });
    } catch (error) {
      this.logger.warn(
        `admin-notification e-mail to ${this.recipient} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
