import { randomUUID } from 'node:crypto';
import * as postmark from 'postmark';
import type {
  DeliveryStatus,
  EmailDeliveryProvider,
  OutboundMail,
  SendResult,
} from '../core/email-delivery-provider.js';

const DELIVERED_EVENT_TYPE = 'Delivered';

/**
 * Postmark implementation of {@link EmailDeliveryProvider}. All Postmark specifics (ServerClient,
 * MessageID, MessageEvents) live only here and in the Postmark webhook controller.
 *
 * Without POSTMARK_API_TOKEN it degrades to a no-send stub that still yields a unique providerRef, so
 * the full pipeline (OutboundEmailRepo, webhook correlation, fallback polling) runs without a real
 * account; `fetchDeliveryStatus` then never reports a delivery. Thin, untested (I/O wrapper).
 */
export class PostmarkEmailProvider implements EmailDeliveryProvider {
  private readonly client?: postmark.ServerClient;

  constructor(
    apiToken: string,
    private readonly from: string,
  ) {
    this.client = apiToken !== '' ? new postmark.ServerClient(apiToken) : undefined;
  }

  async send(mail: OutboundMail): Promise<SendResult> {
    if (!this.client) {
      // eslint-disable-next-line no-console
      console.warn(`[postmark] POSTMARK_API_TOKEN missing — e-mail to ${mail.to} NOT sent (noop).`);
      return { providerRef: `postmark-noop-${randomUUID()}` };
    }
    const response = await this.client.sendEmail({
      From: this.from,
      To: mail.to,
      Subject: mail.subject,
      HtmlBody: mail.html,
      TextBody: mail.text,
      Attachments: mail.attachments?.map((attachment) => ({
        Name: attachment.filename,
        Content: attachment.contentBase64,
        ContentType: attachment.contentType,
        ContentID: null,
      })),
    });
    return { providerRef: response.MessageID };
  }

  async fetchDeliveryStatus(providerRef: string): Promise<DeliveryStatus> {
    if (!this.client) {
      return { kind: 'pending' };
    }
    const details = await this.client.getOutboundMessageDetails(providerRef);
    const deliveryEvent = details.MessageEvents.find((event) => event.Type === DELIVERED_EVENT_TYPE);
    if (!deliveryEvent) {
      return { kind: 'pending' };
    }
    return { kind: 'delivered', deliveredAt: new Date(deliveryEvent.ReceivedAt) };
  }
}
