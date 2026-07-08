import { DomainError } from '../../common/errors';
import type { CustomerVersionStateRepo, CustomerVersionStateTransition } from '../../domain/ports';
import type { CustomerVersionState } from '../../domain/types';
import { deepCopy } from './clone';

const OPEN_STATES: readonly CustomerVersionState['state'][] = [
  'PENDING_NOTIFICATION',
  'NOTIFIED',
  'OBJECTED',
  'EXPIRED_BLOCKING',
];

export class InMemoryCustomerVersionStateRepo implements CustomerVersionStateRepo {
  private readonly states = new Map<string, CustomerVersionState>();

  async save(state: CustomerVersionState): Promise<CustomerVersionState> {
    this.states.set(state.id, deepCopy(state));
    return deepCopy(state);
  }

  async findById(id: string): Promise<CustomerVersionState | undefined> {
    return deepCopy(this.states.get(id));
  }

  async findByCustomerAndVersion(customerId: string, versionId: string): Promise<CustomerVersionState | undefined> {
    const found = [...this.states.values()].find(
      (s) => s.customerId === customerId && s.versionId === versionId,
    );
    return deepCopy(found);
  }

  async findByCustomer(customerId: string): Promise<CustomerVersionState[]> {
    return deepCopy([...this.states.values()].filter((s) => s.customerId === customerId));
  }

  async findOpenByVersion(versionId: string): Promise<CustomerVersionState[]> {
    return deepCopy(
      [...this.states.values()].filter((s) => s.versionId === versionId && OPEN_STATES.includes(s.state)),
    );
  }

  async findByVersion(versionId: string): Promise<CustomerVersionState[]> {
    return deepCopy([...this.states.values()].filter((s) => s.versionId === versionId));
  }

  async findDueForSweep(now: Date): Promise<CustomerVersionState[]> {
    return deepCopy(
      [...this.states.values()].filter(
        (s) => s.state === 'NOTIFIED' && s.deadlineAt !== undefined && s.deadlineAt.getTime() <= now.getTime(),
      ),
    );
  }

  async setNotifiedAtomically(
    id: string,
    update: Pick<CustomerVersionState, 'state' | 'notifiedAt' | 'deadlineAt'>,
  ): Promise<CustomerVersionState> {
    const stored = this.states.get(id);
    if (!stored) {
      throw new DomainError('INVALID_STATE', `CustomerVersionState ${id} does not exist`);
    }
    // SET notifiedAt=… WHERE notifiedAt IS NULL AND state='PENDING_NOTIFICATION' — the first
    // provable delivery wins; SUPERSEDED/ACCEPTED states are never resurrected.
    if (stored.notifiedAt === undefined && stored.state === 'PENDING_NOTIFICATION') {
      this.states.set(id, { ...stored, ...deepCopy(update) });
    }
    return deepCopy(this.states.get(id) as CustomerVersionState);
  }

  async transition(
    id: string,
    expectedState: CustomerVersionState['state'],
    update: CustomerVersionStateTransition,
  ): Promise<CustomerVersionState | null> {
    const stored = this.states.get(id);
    // UPDATE … WHERE id = $1 AND state = $2 — no match → null (precondition not met).
    if (!stored || stored.state !== expectedState) {
      return null;
    }
    this.states.set(id, { ...stored, ...deepCopy(update) });
    return deepCopy(this.states.get(id) as CustomerVersionState);
  }
}
