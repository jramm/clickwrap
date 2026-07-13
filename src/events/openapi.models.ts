/**
 * OpenAPI documentation models for the legal event / audit log (admin API, GET /admin/events).
 * These classes are documentation only; the endpoint returns plain objects (no runtime validation
 * beyond the query params). Kept in sync with {@link EventView} in events.service.ts.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The four broad buckets a normalized event falls into (used by the frontend category filter/chip). */
export const EVENT_CATEGORIES = ['COMMUNICATION', 'ACCESS', 'CONSENT', 'ADMINISTRATION'] as const;

/** Every specific event type recorded into the append-only Event table (GET /admin/events reads it). */
export const EVENT_TYPES = [
  'EMAIL_SENT',
  'EMAIL_DELIVERED',
  'EMAIL_BOUNCED',
  'PAGE_ACCESSED',
  'VERSION_ACCEPTED',
  'OBJECTION_RAISED',
  'OBJECTION_REOPENED',
  'VERSION_PUBLISHED',
  'VERSION_ACTIVATED',
  'VERSION_RETIRED',
  'DEADLINE_EXTENDED',
  'DEADLINE_EXPIRED',
  'BLOCK_SUSPENDED',
  'BLOCK_CARRIED_OVER',
  'OBLIGATION_ROLLED_OUT',
  'REMINDER_TRIGGERED',
  'MANUAL_ACCEPTANCE',
  'ACCEPTANCE_LINK_CREATED',
  'CUSTOMER_CREATED',
  'CUSTOMER_UPDATED',
  'CUSTOMER_DELETED',
  'DOCUMENT_CREATED',
  'VERSION_DRAFT_CREATED',
  'VERSION_UPDATED',
  'VERSION_DRAFT_DELETED',
  'SIGNED_DOCUMENT_UPLOADED',
  'DOCUMENT_TYPE_CREATED',
  'DOCUMENT_TYPE_UPDATED',
  'DOCUMENT_TYPE_DELETED',
  'AUDIENCE_CREATED',
  'AUDIENCE_UPDATED',
  'AUDIENCE_DELETED',
  'EMAIL_TEMPLATE_CREATED',
  'EMAIL_TEMPLATE_UPDATED',
  'EMAIL_TEMPLATE_DELETED',
] as const;

export const EVENT_ACTOR_KINDS = ['ADMIN', 'CUSTOMER', 'SYSTEM'] as const;

export class EventModel {
  @ApiProperty({ example: 'evt-9f1c…', description: 'Stable Event-table id (evt-…).' })
  id!: string;

  @ApiProperty({ format: 'date-time', example: '2026-07-09T14:12:03.000Z' })
  occurredAt!: string;

  @ApiProperty({ enum: EVENT_TYPES, example: 'VERSION_ACCEPTED' })
  type!: (typeof EVENT_TYPES)[number];

  @ApiProperty({ enum: EVENT_CATEGORIES, example: 'CONSENT' })
  category!: (typeof EVENT_CATEGORIES)[number];

  @ApiProperty({ enum: EVENT_ACTOR_KINDS, example: 'CUSTOMER' })
  actorKind!: (typeof EVENT_ACTOR_KINDS)[number];

  @ApiProperty({ example: 'Jane Doe', description: 'Human-readable actor label (name/email/user id/"system").' })
  actorLabel!: string;

  @ApiPropertyOptional({ example: 'c-123' })
  customerId?: string;

  @ApiPropertyOptional({ example: 'Acme GmbH', description: 'Derived customer display name.' })
  customerName?: string;

  @ApiPropertyOptional({ example: 'v-1' })
  versionId?: string;

  @ApiPropertyOptional({ example: 'dpa', description: 'Document type key.' })
  documentType?: string;

  @ApiPropertyOptional({ example: 'customer', description: 'Audience key.' })
  audience?: string;

  @ApiPropertyOptional({ example: 'June 2026 edition' })
  versionLabel?: string;

  @ApiPropertyOptional({ example: 'EMAIL', description: 'Delivery / acceptance channel of the source record.' })
  channel?: string;

  @ApiPropertyOptional({ example: 'legal@acme.example', description: 'E-mail recipient / accessing user id.' })
  recipient?: string;

  @ApiProperty({ example: 'Version June 2026 edition accepted (ACTIVE_CONSENT, PORTAL)' })
  summary!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Pass-through source metadata (reason, method, isEffective, …).',
  })
  metadata?: Record<string, unknown>;
}

export class EventListResponseModel {
  @ApiProperty({ type: [EventModel] })
  items!: EventModel[];

  @ApiProperty({ example: 173, description: 'Total number of events AFTER filtering (before pagination).' })
  total!: number;
}
