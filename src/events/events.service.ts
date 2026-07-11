import { Inject, Injectable } from '@nestjs/common';
import type { EventRepo } from '../domain/ports.js';
import type { DomainEvent, EventActorKind, EventCategory, EventType } from '../domain/types.js';
import { TOKENS } from '../persistence/tokens.js';

export type { EventActorKind, EventCategory, EventType } from '../domain/types.js';
export { EVENTS_PAGE_SIZE } from '../domain/types.js';

/** A single normalized legal event as returned by GET /admin/events (DomainEvent with an ISO date). */
export interface EventView {
  id: string;
  /** ISO-8601 date-time. */
  occurredAt: string;
  type: EventType;
  category: EventCategory;
  actorKind: EventActorKind;
  actorLabel: string;
  customerId?: string;
  customerName?: string;
  versionId?: string;
  documentType?: string;
  audience?: string;
  versionLabel?: string;
  channel?: string;
  recipient?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface EventQuery {
  customerId?: string;
  /** ISO date-time or date-only (YYYY-MM-DD → start-of-day). occurredAt >= from. */
  from?: string;
  /** ISO date-time or date-only (YYYY-MM-DD → end-of-day). occurredAt <= to. */
  to?: string;
  category?: EventCategory;
  documentType?: string;
  versionId?: string;
  page?: number;
}

export interface EventListResult {
  items: EventView[];
  total: number;
}

/**
 * Reads the append-only, core-written Event table ({@link EventRepo}) into the chronological
 * (newest-first), paginated, filterable event list for GET /admin/events. The core writes one entry
 * per successful domain action (dual-write via {@link EventRecorder}); this service is a thin,
 * table-backed query — no cross-source aggregation. Filtering runs BEFORE pagination (`total` is the
 * filtered count); a date-only `to` is treated as end-of-day.
 */
@Injectable()
export class EventsService {
  constructor(@Inject(TOKENS.EventRepo) private readonly events: EventRepo) {}

  async list(query: EventQuery = {}): Promise<EventListResult> {
    const { items, total } = await this.events.query(
      {
        customerId: query.customerId,
        category: query.category,
        documentType: query.documentType,
        versionId: query.versionId,
        from: parseFrom(query.from),
        to: parseTo(query.to),
      },
      query.page,
    );
    return { items: items.map(toView), total };
  }
}

const toView = (event: DomainEvent): EventView => ({
  ...event,
  occurredAt: event.occurredAt.toISOString(),
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** occurredAt >= from. A date-only `from` is the start of that (UTC) day. */
const parseFrom = (value: string | undefined): Date | undefined => parseBound(value, 'T00:00:00.000Z');

/** occurredAt <= to. A date-only `to` is the END of that (UTC) day so a single-day range works. */
const parseTo = (value: string | undefined): Date | undefined => parseBound(value, 'T23:59:59.999Z');

const parseBound = (value: string | undefined, dayTime: string): Date | undefined => {
  if (!value) {
    return undefined;
  }
  const iso = DATE_ONLY.test(value) ? `${value}${dayTime}` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
};
