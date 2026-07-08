/**
 * `email-provider` plugin kind: outbound e-mail delivery.
 *
 * An `EmailDeliveryProvider` turns a provider-agnostic {@link OutboundMail} into a real send and
 * returns a `providerRef` (the provider's own message id). The host correlates later
 * delivery/bounce events back to a send via that `providerRef`.
 *
 * Webhook-style plugins (delivery/bounce callbacks) ship a Nest controller via the plugin's
 * `module()` and inject the host's {@link InboundDeliveryEventSink} under
 * `PLUGIN_DI_TOKENS.InboundDeliveryEventSink` to hand translated events to the host.
 */

/** Provider-agnostic outbound message. The sender address is the provider's concern (env EMAIL_FROM). */
export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Result of a send: the provider's own reference used to correlate later delivery/bounce events. */
export interface SendResult {
  providerRef: string;
}

/**
 * Result of the optional delivery-status poll (fallback when a provider offers no webhooks or an
 * event was missed). `unsupported` means the provider cannot report status — polling is a no-op then.
 */
export type DeliveryStatus =
  | { kind: 'delivered'; deliveredAt?: Date }
  | { kind: 'pending' }
  | { kind: 'unsupported' };

export interface EmailDeliveryProvider {
  send(mail: OutboundMail): Promise<SendResult>;
  /**
   * Optional capability for polling-based delivery confirmation (fallback path). Providers without
   * delivery tracking either omit this method or return `{ kind: 'unsupported' }`.
   */
  fetchDeliveryStatus?(providerRef: string): Promise<DeliveryStatus>;
}

/**
 * Provider-agnostic inbound delivery event. A plugin's webhook controller translates its own
 * payloads into this shape; the host never sees provider-specific fields. The `providerRef`
 * correlates the event back to a recorded send.
 *
 * NOTE ON TIME: `occurredAt` is informational only. The host computes deadlines exclusively from
 * server time, never from an inbound payload.
 */
export interface InboundDeliveryEvent {
  providerRef: string;
  recipient: string;
  kind: 'DELIVERED' | 'BOUNCED';
  /** When the provider says the event happened (informational; not used for deadlines). */
  occurredAt?: Date;
  meta?: {
    /** The provider marked the recipient as permanently undeliverable (e.g. Postmark "Inactive"). */
    inactivatedRecipient?: boolean;
  };
}

/**
 * Host-provided sink for inbound delivery events. Bound by the host under
 * `PLUGIN_DI_TOKENS.InboundDeliveryEventSink` while the plugin is the active e-mail provider —
 * webhook controllers and polling jobs inject it to report deliveries/bounces.
 */
export interface InboundDeliveryEventSink {
  handle(event: InboundDeliveryEvent): Promise<void>;
}
