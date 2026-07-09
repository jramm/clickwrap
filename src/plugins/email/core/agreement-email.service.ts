import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Clock } from '../../../domain/clock';
import { customerDisplayName } from '../../../domain/customer';
import type { AgreementVersion, Customer } from '../../../domain/types';
import { EventRecorder } from '../../../events/event-recorder';
import { TOKENS } from '../../../persistence/tokens';
import { PLUGIN_DI_TOKENS, type EmailAttachment, type FileStorage } from '../../../plugin-sdk';
import { EmailContentService } from './email-content.service';
import { EMAIL_TOKENS, type EmailDeliveryProvider, type SendResult } from './email-delivery-provider';
import type { OutboundEmailRepo } from './outbound-email';

interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const PDF_CONTENT_TYPE = 'application/pdf';

/**
 * Builds and sends rollout/reminder e-mails through the selected {@link EmailDeliveryProvider}
 * — provider-agnostic. The content (subject/html/text) comes from the admin-managed
 * {@link EmailContentService} (per-document-type template resolution + placeholder rendering).
 * IMPORTANT: `notifiedAt`/`deadlineAt` are NOT set here — only the delivery confirmation
 * (delivery webhook or fallback polling, see DeliveryEventService) may do that, never the plain send.
 * The send itself is recorded in the OutboundEmailRepo (correlated via the provider's `providerRef`).
 *
 * Attachment policy: a PASSIVE (tacit-consent) rollout notification carries the version PDF as an
 * attachment, so the customer receives the document itself in that one mail (there is no active
 * step where they would otherwise fetch it). ACTIVE notifications stay link-only (the rendered mail
 * embeds a `documentPdfUrl`), and reminders never attach.
 */
@Injectable()
export class AgreementEmailService {
  constructor(
    @Inject(EMAIL_TOKENS.EmailDeliveryProvider) private readonly provider: EmailDeliveryProvider,
    @Inject(EMAIL_TOKENS.OutboundEmailRepo) private readonly outboundEmailRepo: OutboundEmailRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    private readonly content: EmailContentService,
    @Optional() private readonly recorder?: EventRecorder,
    @Optional() @Inject(PLUGIN_DI_TOKENS.FileStorage) private readonly fileStorage?: FileStorage,
  ) {}

  /**
   * Rollout notification about a newly published version. PASSIVE versions additionally carry the
   * version PDF as an attachment (see the attachment policy above).
   */
  async sendVersionNotification(
    customer: Customer,
    recipient: string,
    version: AgreementVersion,
  ): Promise<SendResult> {
    const content = await this.content.renderFor('VERSION_NOTIFICATION', customer, version);
    const attachments =
      version.acceptanceMode === 'PASSIVE' ? await this.versionPdfAttachment(version) : undefined;
    return this.sendAndRecord(customer, recipient, version, content, attachments);
  }

  /** Reminder before the deadline — sent 7 and 2 days before deadlineAt (never attaches). */
  async sendReminder(
    customer: Customer,
    recipient: string,
    version: AgreementVersion,
    deadlineAt: Date,
  ): Promise<SendResult> {
    const content = await this.content.renderFor('REMINDER', customer, version, deadlineAt);
    return this.sendAndRecord(customer, recipient, version, content);
  }

  /** Loads the version PDF from file storage and turns it into a base64 mail attachment. */
  private async versionPdfAttachment(version: AgreementVersion): Promise<EmailAttachment[] | undefined> {
    if (!this.fileStorage) {
      return undefined;
    }
    const pdf = await this.fileStorage.retrieve(version.storageKey);
    return [{ filename: version.fileName, contentBase64: pdf.toString('base64'), contentType: PDF_CONTENT_TYPE }];
  }

  private async sendAndRecord(
    customer: Customer,
    recipient: string,
    version: AgreementVersion,
    content: EmailContent,
    attachments?: EmailAttachment[],
  ): Promise<SendResult> {
    const { providerRef } = await this.provider.send({ to: recipient, ...content, attachments });
    await this.outboundEmailRepo.save({
      providerRef,
      customerId: customer.id,
      versionId: version.id,
      recipient,
      sentAt: this.clock.now(),
    });

    // Every rollout/reminder send is recorded — so a customer-create → acceptance-link mail shows up.
    await this.recorder?.record({
      type: 'EMAIL_SENT',
      category: 'COMMUNICATION',
      actorKind: 'SYSTEM',
      actorLabel: 'system',
      customerId: customer.id,
      customerName: customerDisplayName(customer),
      versionId: version.id,
      versionLabel: version.versionLabel,
      channel: 'EMAIL',
      recipient,
      summary: `E-mail sent to ${recipient} (version ${version.versionLabel})`,
      metadata: { providerRef },
    });
    return { providerRef };
  }
}
