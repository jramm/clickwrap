/**
 * Adapter: binds the agreements module's RolloutNotifier port (src/agreements/ports.ts) to the
 * provider-agnostic AgreementEmailService. Recipient logic: every notification goes to ALL of the
 * customer's stored contacts (`Customer.contactEmails`) — the first successful delivery to any of
 * them counts as access of the legal entity. A customer without contacts: no send — it stays
 * PENDING_NOTIFICATION and shows up in the escalation report ("not reachable").
 */
import { Injectable } from '@nestjs/common';
import type { AgreementVersion, Customer, CustomerVersionState } from '../../../domain/types';
import type { RolloutNotifier } from '../../../agreements/ports';
import { AgreementEmailService } from './agreement-email.service';

@Injectable()
export class AgreementRolloutNotifier implements RolloutNotifier {
  constructor(private readonly emails: AgreementEmailService) {}

  /** Publish rollout: "new version published" sent to all contacts. */
  async notifyVersionPublished(customer: Customer, version: AgreementVersion): Promise<void> {
    for (const recipient of customer.contactEmails) {
      await this.emails.sendVersionNotification(customer, recipient, version);
    }
  }

  /**
   * Admin action "send reminder again": as a reminder with the deadline; if no deadline is running yet
   * (no provable access → deadlineAt empty), the rollout notification is sent again instead — a
   * "reminder" without a deadline date would be misleading.
   */
  async remind(customer: Customer, state: CustomerVersionState, version: AgreementVersion): Promise<void> {
    for (const recipient of customer.contactEmails) {
      if (state.deadlineAt !== undefined) {
        await this.emails.sendReminder(customer, recipient, version, state.deadlineAt);
      } else {
        await this.emails.sendVersionNotification(customer, recipient, version);
      }
    }
  }
}
