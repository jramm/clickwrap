import { randomUUID } from 'node:crypto';
import type { EmailDeliveryProvider, OutboundMail, SendResult } from '../core/email-delivery-provider';

/**
 * Default provider for dev/tests: sends nothing, logs the recipient, and returns a fake providerRef so
 * the whole send pipeline (OutboundEmailRepo, correlation) runs without a real account. No delivery
 * tracking (no fetchDeliveryStatus) — in this mode deadlines start exclusively via portal-popup access
 * (POST /customers/:id/notifications).
 */
export class NoopEmailProvider implements EmailDeliveryProvider {
  async send(mail: OutboundMail): Promise<SendResult> {
    // eslint-disable-next-line no-console
    console.warn(`[email:noop] e-mail to ${mail.to} NOT sent (noop provider). Subject: ${mail.subject}`);
    return { providerRef: `noop-${randomUUID()}` };
  }
}
