import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '../../../domain/clock';
import type { AgreementVersion, Customer } from '../../../domain/types';
import { TOKENS } from '../../../persistence/tokens';
import { EmailContentService } from './email-content.service';
import { EMAIL_TOKENS, type EmailDeliveryProvider, type SendResult } from './email-delivery-provider';
import type { OutboundEmailRepo } from './outbound-email';

interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * Builds and sends rollout/reminder e-mails through the selected {@link EmailDeliveryProvider}
 * — provider-agnostic. The content (subject/html/text) comes from the admin-managed
 * {@link EmailContentService} (per-document-type template resolution + placeholder rendering).
 * IMPORTANT: `notifiedAt`/`deadlineAt` are NOT set here — only the delivery confirmation
 * (delivery webhook or fallback polling, see DeliveryEventService) may do that, never the plain send.
 * The send itself is recorded in the OutboundEmailRepo (correlated via the provider's `providerRef`).
 */
@Injectable()
export class AgreementEmailService {
  constructor(
    @Inject(EMAIL_TOKENS.EmailDeliveryProvider) private readonly provider: EmailDeliveryProvider,
    @Inject(EMAIL_TOKENS.OutboundEmailRepo) private readonly outboundEmailRepo: OutboundEmailRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    private readonly content: EmailContentService,
  ) {}

  /** Rollout notification about a newly published version. */
  async sendVersionNotification(
    customer: Customer,
    recipient: string,
    version: AgreementVersion,
  ): Promise<SendResult> {
    const content = await this.content.renderFor('VERSION_NOTIFICATION', customer, version);
    return this.sendAndRecord(customer, recipient, version, content);
  }

  /** Reminder before the deadline — sent 7 and 2 days before deadlineAt. */
  async sendReminder(
    customer: Customer,
    recipient: string,
    version: AgreementVersion,
    deadlineAt: Date,
  ): Promise<SendResult> {
    const content = await this.content.renderFor('REMINDER', customer, version, deadlineAt);
    return this.sendAndRecord(customer, recipient, version, content);
  }

  private async sendAndRecord(
    customer: Customer,
    recipient: string,
    version: AgreementVersion,
    content: EmailContent,
  ): Promise<SendResult> {
    const { providerRef } = await this.provider.send({ to: recipient, ...content });
    await this.outboundEmailRepo.save({
      providerRef,
      customerId: customer.id,
      versionId: version.id,
      recipient,
      sentAt: this.clock.now(),
    });
    return { providerRef };
  }
}
