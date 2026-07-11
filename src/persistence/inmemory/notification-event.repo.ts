import { DomainError } from '../../common/errors.js';
import type { NotificationEventRepo } from '../../domain/ports.js';
import type { NotificationEvent } from '../../domain/types.js';
import { deepCopy } from './clone.js';

export class InMemoryNotificationEventRepo implements NotificationEventRepo {
  private readonly events = new Map<string, NotificationEvent>();

  async append(event: NotificationEvent): Promise<NotificationEvent> {
    if (this.events.has(event.id)) {
      throw new DomainError('INVALID_STATE', `NotificationEvent ${event.id} already exists (append-only)`);
    }
    this.events.set(event.id, deepCopy(event));
    return deepCopy(event);
  }

  async findByState(customerVersionStateId: string): Promise<NotificationEvent[]> {
    return deepCopy(
      [...this.events.values()].filter((e) => e.customerVersionStateId === customerVersionStateId),
    );
  }

  async findByProviderRef(providerRef: string): Promise<NotificationEvent | undefined> {
    return deepCopy([...this.events.values()].find((e) => e.providerRef === providerRef));
  }

  /** All notification events in insertion order (append-only store). */
  async findAll(): Promise<NotificationEvent[]> {
    return deepCopy([...this.events.values()]);
  }
}
