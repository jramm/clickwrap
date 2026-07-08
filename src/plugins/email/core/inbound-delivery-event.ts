/**
 * Provider-agnostic inbound delivery event consumed by {@link DeliveryEventService}.
 *
 * The type lives in the plugin SDK (re-exported here for a stable core-local import path).
 * Providers (their webhooks or their polling job) translate their own payloads into this shape;
 * the core never sees provider-specific fields. External webhook plugins reach the same handling
 * through the SDK's `InboundDeliveryEventSink` (PLUGIN_DI_TOKENS.InboundDeliveryEventSink), which
 * EmailModule binds to the DeliveryEventService.
 *
 * NOTE ON TIME: `occurredAt` is informational only. Objection deadlines are ALWAYS computed from
 * server time (injected Clock), never from an inbound payload.
 */
export type { InboundDeliveryEvent } from '../../../plugin-sdk';
