import { DomainError } from '../../common/errors';
import type { EventQueryFilters, EventRepo } from '../../domain/ports';
import type { DomainEvent } from '../../domain/types';
import { EVENTS_PAGE_SIZE } from '../../domain/types';
import { deepCopy } from './clone';

/**
 * In-memory {@link EventRepo} for tests/dev. Append-only (a duplicate id is a programming error).
 * `query` filters BEFORE paginating, sorts occurredAt DESC with a stable id tiebreak, and returns the
 * filtered total.
 */
export class InMemoryEventRepo implements EventRepo {
  private readonly events = new Map<string, DomainEvent>();

  async append(event: DomainEvent): Promise<DomainEvent> {
    if (this.events.has(event.id)) {
      throw new DomainError('INVALID_STATE', `Event ${event.id} already exists (append-only)`);
    }
    this.events.set(event.id, deepCopy(event));
    return deepCopy(event);
  }

  async query(filters: EventQueryFilters, page?: number): Promise<{ items: DomainEvent[]; total: number }> {
    const filtered = [...this.events.values()].filter((event) => matches(event, filters));
    // Newest first; stable tiebreak by id so equal timestamps keep a deterministic order.
    filtered.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || a.id.localeCompare(b.id));

    const p = page && page > 0 ? page : 1;
    const start = (p - 1) * EVENTS_PAGE_SIZE;
    const items = filtered.slice(start, start + EVENTS_PAGE_SIZE);
    return { items: deepCopy(items), total: filtered.length };
  }
}

const matches = (event: DomainEvent, filters: EventQueryFilters): boolean => {
  if (filters.customerId !== undefined && event.customerId !== filters.customerId) {
    return false;
  }
  if (filters.category !== undefined && event.category !== filters.category) {
    return false;
  }
  if (filters.documentType !== undefined && event.documentType !== filters.documentType) {
    return false;
  }
  if (filters.versionId !== undefined && event.versionId !== filters.versionId) {
    return false;
  }
  if (filters.from !== undefined && event.occurredAt.getTime() < filters.from.getTime()) {
    return false;
  }
  if (filters.to !== undefined && event.occurredAt.getTime() > filters.to.getTime()) {
    return false;
  }
  return true;
};
