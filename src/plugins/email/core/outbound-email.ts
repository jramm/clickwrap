/**
 * Provider-agnostic record of one sent e-mail (the plugin's own port, not part of src/domain/ports.ts).
 *
 * `notifiedAt`/`deadlineAt` on the CustomerVersionState may only be set on DELIVERY (delivery webhook
 * or fallback polling, see DeliveryEventService) — never by the plain send. The send itself is kept
 * here so that the delivery/bounce event (correlated via `providerRef`) can be mapped back to a
 * (customerId, versionId).
 */
export interface OutboundEmail {
  /** The provider's own message reference (e.g. Postmark MessageID, SMTP/noop generated id). */
  providerRef: string;
  customerId: string;
  versionId: string;
  recipient: string;
  sentAt: Date;
  deliveredAt?: Date;
}

export interface OutboundEmailRepo {
  save(email: OutboundEmail): Promise<OutboundEmail>;
  findByProviderRef(providerRef: string): Promise<OutboundEmail | undefined>;
  /** Sets deliveredAt (idempotent: a later call does not overwrite an already-set timestamp). */
  markDelivered(providerRef: string, deliveredAt: Date): Promise<OutboundEmail | undefined>;
  /** Candidates for fallback polling: not yet delivered and older than `olderThan`. */
  findPendingOlderThan(olderThan: Date): Promise<OutboundEmail[]>;
}
