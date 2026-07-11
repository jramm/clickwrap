import { deepCopy } from '../../../persistence/inmemory/clone.js';
import type { OutboundEmail, OutboundEmailRepo } from './outbound-email.js';

/** In-memory implementation for tests (analogous to src/persistence/inmemory/*). */
export class InMemoryOutboundEmailRepo implements OutboundEmailRepo {
  private readonly emails = new Map<string, OutboundEmail>();

  async save(email: OutboundEmail): Promise<OutboundEmail> {
    this.emails.set(email.providerRef, deepCopy(email));
    return deepCopy(email);
  }

  async findByProviderRef(providerRef: string): Promise<OutboundEmail | undefined> {
    return deepCopy(this.emails.get(providerRef));
  }

  async markDelivered(providerRef: string, deliveredAt: Date): Promise<OutboundEmail | undefined> {
    const stored = this.emails.get(providerRef);
    if (!stored) {
      return undefined;
    }
    if (stored.deliveredAt === undefined) {
      this.emails.set(providerRef, { ...stored, deliveredAt: deepCopy(deliveredAt) });
    }
    return deepCopy(this.emails.get(providerRef));
  }

  async findPendingOlderThan(olderThan: Date): Promise<OutboundEmail[]> {
    return deepCopy(
      [...this.emails.values()].filter(
        (e) => e.deliveredAt === undefined && e.sentAt.getTime() < olderThan.getTime(),
      ),
    );
  }
}
