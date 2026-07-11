import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../../common/openapi/api-error-responses.decorator.js';
import { WebhookAuth } from '../../../common/openapi/security.decorators.js';
import { PLUGIN_DI_TOKENS, type InboundDeliveryEventSink } from '../../../plugin-sdk/index.js';
import type { InboundDeliveryEvent } from '../core/inbound-delivery-event.js';
import { PostmarkWebhookGuard } from './postmark-webhook.guard.js';

const RECORD_TYPE_DELIVERY = 'Delivery';
const RECORD_TYPE_BOUNCE = 'Bounce';

/** Raw Postmark webhook payload (only the fields relevant for Delivery/Bounce). */
export interface PostmarkWebhookPayload {
  RecordType: string;
  MessageID?: string;
  /** Delivery events carry the recipient under `Recipient`. */
  Recipient?: string;
  /** Bounce events carry the recipient under `Email`. */
  Email?: string;
  /** Postmark has permanently deactivated the recipient (bounce only). */
  Inactive?: boolean;
}

/**
 * POST /webhooks/postmark — delivery/bounce proof from Postmark. Postmark specifics
 * (RecordType, MessageID) are translated here into provider-agnostic {@link InboundDeliveryEvent}s and
 * handed to the host's {@link InboundDeliveryEventSink} (the DeliveryEventService, bound under the
 * SDK token exactly as for external webhook plugins). Registered only when EMAIL_PROVIDER=postmark.
 *
 * Auth via PostmarkWebhookGuard (token header, 403 on invalid, stops retries). Everything else answers
 * 200 so Postmark does not redeliver (also for unknown MessageID or unknown RecordType).
 */
@ApiTags('webhooks')
@WebhookAuth()
@Controller('webhooks/postmark')
@UseGuards(PostmarkWebhookGuard)
export class PostmarkWebhookController {
  constructor(
    @Inject(PLUGIN_DI_TOKENS.InboundDeliveryEventSink) private readonly deliveryEvents: InboundDeliveryEventSink,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Postmark delivery/bounce webhook (mounted only when EMAIL_PROVIDER=postmark)',
    description:
      'Delivery → sets notifiedAt atomically (deadline starts). Bounce → escalation "unreachable". ' +
      'Unknown MessageIDs and other RecordTypes → 200 no-op (stops redelivery).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['RecordType'],
      properties: {
        RecordType: { type: 'string', example: 'Delivery' },
        MessageID: { type: 'string' },
        Recipient: { type: 'string', description: 'Delivery events.' },
        Email: { type: 'string', description: 'Bounce events.' },
        Inactive: { type: 'boolean', description: 'Bounce: recipient permanently deactivated.' },
      },
    },
  })
  @ApiResponse({ status: 200, schema: { type: 'object', properties: { ok: { type: 'boolean', enum: [true] } } } })
  @ApiErrorResponses({ 403: 'Invalid webhook token (stops Postmark retries).' })
  @HttpCode(HttpStatus.OK)
  async handle(@Body() payload: PostmarkWebhookPayload): Promise<{ ok: true }> {
    const event = this.toInboundEvent(payload);
    if (event) {
      await this.deliveryEvents.handle(event);
    }
    // other RecordTypes (Open, Click, SubscriptionChange, …): 200 no-op.
    return { ok: true };
  }

  private toInboundEvent(payload: PostmarkWebhookPayload): InboundDeliveryEvent | undefined {
    if (payload.RecordType === RECORD_TYPE_DELIVERY) {
      if (!payload.MessageID) {
        return undefined;
      }
      return { providerRef: payload.MessageID, recipient: payload.Recipient ?? '', kind: 'DELIVERED' };
    }
    if (payload.RecordType === RECORD_TYPE_BOUNCE) {
      return {
        providerRef: payload.MessageID ?? '',
        recipient: payload.Email ?? payload.Recipient ?? '',
        kind: 'BOUNCED',
        meta: { inactivatedRecipient: payload.Inactive === true },
      };
    }
    return undefined;
  }
}
