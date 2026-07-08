import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../domain/clock';
import type { AgreementVersionRepo, CustomerVersionStateRepo, NotificationEventRepo } from '../../../domain/ports';
import { recordAccess } from '../../../domain/state-machine';
import { ESCALATION_LOG, type EscalationLog } from '../../../common/escalation/escalation-log';
import { TOKENS } from '../../../persistence/tokens';
import { EMAIL_TOKENS, type EmailDeliveryProvider } from './email-delivery-provider';
import type { InboundDeliveryEvent } from './inbound-delivery-event';
import type { OutboundEmailRepo } from './outbound-email';

/**
 * Provider-agnostic processing of inbound delivery/bounce events — fed by any provider's webhook
 * (translated into {@link InboundDeliveryEvent}) AND by the fallback-polling path, so both apply the
 * exact same deadline logic. Generalized from the former PostmarkDeliveryService.
 *
 * Guarantees preserved:
 *  - `notifiedAt` is set ONLY on delivery, atomically via the state machine (carry-over respected).
 *  - Unknown `providerRef` → no-op (review environments may share one provider account).
 *  - Idempotent on double delivery (only one NotificationEvent is recorded).
 *  - Bounce → escalation only, never starts a deadline.
 */
@Injectable()
export class DeliveryEventService {
  constructor(
    @Inject(EMAIL_TOKENS.OutboundEmailRepo) private readonly outboundEmailRepo: OutboundEmailRepo,
    @Inject(TOKENS.NotificationEventRepo) private readonly notificationEventRepo: NotificationEventRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly stateRepo: CustomerVersionStateRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versionRepo: AgreementVersionRepo,
    @Inject(ESCALATION_LOG) private readonly escalationLog: EscalationLog,
    @Inject(EMAIL_TOKENS.EmailDeliveryProvider) private readonly provider: EmailDeliveryProvider,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  /** Dispatches an inbound event to delivery or bounce handling. */
  async handle(event: InboundDeliveryEvent): Promise<void> {
    if (event.kind === 'DELIVERED') {
      await this.recordDelivery(event.providerRef);
      return;
    }
    await this.recordBounce(event);
  }

  /**
   * Delivery confirmation for a providerRef: record NotificationEvent + set notifiedAt/deadlineAt.
   * Unknown providerRef → no-op (review environments may share one provider account).
   * Idempotent on double delivery: an already-recorded event is detected.
   */
  private async recordDelivery(providerRef: string): Promise<void> {
    const outboundEmail = await this.outboundEmailRepo.findByProviderRef(providerRef);
    if (!outboundEmail) {
      return;
    }
    if (outboundEmail.deliveredAt === undefined) {
      await this.outboundEmailRepo.markDelivered(providerRef, this.clock.now());
    }

    const state = await this.stateRepo.findByCustomerAndVersion(outboundEmail.customerId, outboundEmail.versionId);
    if (!state) {
      return;
    }
    if (state.state === 'SUPERSEDED') {
      // Superseded version: delivery no longer starts a deadline and records no access — a SUPERSEDED
      // state is never written back to NOTIFIED. The race (supersede AFTER this read) is
      // additionally guarded by the state condition in setNotifiedAtomically.
      return;
    }

    const alreadyRecorded = await this.notificationEventRepo.findByProviderRef(providerRef);
    if (!alreadyRecorded) {
      await this.notificationEventRepo.append({
        id: randomUUID(),
        customerVersionStateId: state.id,
        channel: 'EMAIL',
        recipient: outboundEmail.recipient,
        occurredAt: this.clock.now(),
        providerRef,
      });
    }

    const version = await this.versionRepo.findById(outboundEmail.versionId);
    if (!version) {
      return;
    }
    const updated = recordAccess(state, this.clock, version, state.carryOverBlocking === true);
    await this.stateRepo.setNotifiedAtomically(state.id, {
      state: updated.state,
      notifiedAt: updated.notifiedAt,
      deadlineAt: updated.deadlineAt,
    });
  }

  /**
   * Bounce escalation "not reachable": the deadline does NOT start — only an
   * escalation note for admin/legal, including `inactivatedEmail` (provider deactivated the recipient).
   * Without an OutboundEmail match → no-op like the delivery path (review environments may
   * share one provider account — foreign bounces must not create orphan escalation entries).
   */
  private async recordBounce(event: InboundDeliveryEvent): Promise<void> {
    const outboundEmail = await this.outboundEmailRepo.findByProviderRef(event.providerRef);
    if (!outboundEmail) {
      return;
    }
    await this.escalationLog.record({
      id: randomUUID(),
      kind: 'EMAIL_BOUNCE',
      customerId: outboundEmail.customerId,
      versionId: outboundEmail.versionId,
      recipient: event.recipient,
      occurredAt: this.clock.now(),
      inactivatedEmail: event.meta?.inactivatedRecipient === true,
    });
  }

  /**
   * Fallback polling: re-check open sends without a webhook event via the provider's
   * optional fetchDeliveryStatus — on delivery, the exact same processing as the delivery webhook.
   * Providers without delivery tracking (no fetchDeliveryStatus / `unsupported`) make this a no-op.
   */
  async pollPendingDeliveries(olderThan: Date): Promise<void> {
    if (!this.provider.fetchDeliveryStatus) {
      return;
    }
    const pending = await this.outboundEmailRepo.findPendingOlderThan(olderThan);
    for (const email of pending) {
      const status = await this.provider.fetchDeliveryStatus(email.providerRef);
      if (status.kind === 'delivered') {
        await this.recordDelivery(email.providerRef);
      }
    }
  }
}
