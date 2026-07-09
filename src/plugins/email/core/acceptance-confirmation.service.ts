/**
 * Sends the acceptance-confirmation e-mail on acceptance: it renders the ACCEPTANCE_CONFIRMATION
 * template for the version's document type (falling back to the built-in default row), attaches the
 * accepted version's PDF, sends it through the active {@link EmailDeliveryProvider} and records the
 * send in the OutboundEmailRepo — mirroring {@link AgreementEmailService}.
 *
 * TRIGGER RULE (kept in ONE place so every call site behaves the same): a confirmation is sent for
 *   - method ACTIVE_CONSENT (channels PORTAL, LINK, and ADMIN manual recording), and
 *   - method TACIT (deadline sweeper),
 * but NEVER for method IMPORT (bulk/out-of-band onboarding — no confirmation to the customer).
 * See docs/INTEGRATION.md.
 *
 * Recipient: the accepting actor's e-mail if present (portal actor / hosted-page self-declared
 * signer), otherwise ALL of the customer's `contactEmails`; none → skip with a warning.
 *
 * Delivery is best-effort: a failure (template/PDF/provider) is caught and logged and NEVER
 * propagates — recording the acceptance must not fail because a confirmation mail could not be sent.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PLUGIN_DI_TOKENS, type FileStorage } from '../../../plugin-sdk';
import type { Clock } from '../../../domain/clock';
import { customerDisplayName } from '../../../domain/customer';
import type { CustomerRepo } from '../../../domain/ports';
import type { Acceptance, AgreementVersion, Customer } from '../../../domain/types';
import { EventRecorder } from '../../../events/event-recorder';
import { TOKENS } from '../../../persistence/tokens';
import { EmailContentService } from './email-content.service';
import { EMAIL_TOKENS, type EmailDeliveryProvider } from './email-delivery-provider';
import type { OutboundEmailRepo } from './outbound-email';

const PDF_CONTENT_TYPE = 'application/pdf';

@Injectable()
export class AcceptanceConfirmationService {
  private readonly logger = new Logger(AcceptanceConfirmationService.name);

  constructor(
    @Inject(EMAIL_TOKENS.EmailDeliveryProvider) private readonly provider: EmailDeliveryProvider,
    @Inject(EMAIL_TOKENS.OutboundEmailRepo) private readonly outboundEmailRepo: OutboundEmailRepo,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(PLUGIN_DI_TOKENS.FileStorage) private readonly fileStorage: FileStorage,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    private readonly content: EmailContentService,
    @Optional() private readonly recorder?: EventRecorder,
  ) {}

  /**
   * Delivers the accepted document to the customer as a PDF attachment. Never throws — a failure is
   * logged and swallowed so the surrounding acceptance transaction is unaffected.
   */
  async sendForAcceptance(version: AgreementVersion, acceptance: Acceptance): Promise<void> {
    try {
      // IMPORT acceptances (out-of-band onboarding) get no confirmation mail.
      if (acceptance.method === 'IMPORT') {
        return;
      }
      const customer = await this.customers.findById(acceptance.customerId);
      if (!customer) {
        this.logger.warn(`No customer ${acceptance.customerId} — acceptance confirmation skipped`);
        return;
      }
      const recipients = this.resolveRecipients(customer, acceptance);
      if (recipients.length === 0) {
        this.logger.warn(
          `Customer ${customer.id} has no acceptance-confirmation recipient (no actor e-mail, no contactEmails) — skipped`,
        );
        return;
      }
      await this.sendTo(recipients, customer, version, acceptance);
    } catch (err) {
      this.logger.error(
        `Acceptance confirmation for customer ${acceptance.customerId} / version ${version.id} failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Actor e-mail wins (portal / self-declared signer); otherwise all stored contact addresses. */
  private resolveRecipients(customer: Customer, acceptance: Acceptance): string[] {
    const actorEmail = acceptance.actor.email?.trim();
    if (actorEmail) {
      return [actorEmail];
    }
    return customer.contactEmails;
  }

  private async sendTo(
    recipients: string[],
    customer: Customer,
    version: AgreementVersion,
    acceptance: Acceptance,
  ): Promise<void> {
    const content = await this.content.renderFor(
      'ACCEPTANCE_CONFIRMATION',
      customer,
      version,
      undefined,
      acceptance.acceptedAt,
    );
    const pdf = await this.fileStorage.retrieve(version.storageKey);
    const attachment = {
      filename: version.fileName,
      contentBase64: pdf.toString('base64'),
      contentType: PDF_CONTENT_TYPE,
    };
    for (const recipient of recipients) {
      const { providerRef } = await this.provider.send({
        to: recipient,
        ...content,
        attachments: [attachment],
      });
      await this.outboundEmailRepo.save({
        providerRef,
        customerId: customer.id,
        versionId: version.id,
        recipient,
        sentAt: this.clock.now(),
      });
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
        summary: `Acceptance-confirmation e-mail sent to ${recipient} (version ${version.versionLabel})`,
        metadata: { providerRef, kind: 'ACCEPTANCE_CONFIRMATION' },
      });
    }
  }
}
