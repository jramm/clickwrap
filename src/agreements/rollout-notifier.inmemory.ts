import type { AgreementVersion, Customer, CustomerVersionState } from '../domain/types';
import type { RolloutNotifier } from './ports';

/** Spy notifier for tests: records publish notifications and reminders. */
export class InMemoryRolloutNotifier implements RolloutNotifier {
  readonly published: { customerId: string; versionId: string }[] = [];
  readonly reminders: { customerId: string; versionId: string }[] = [];

  async notifyVersionPublished(customer: Customer, version: AgreementVersion): Promise<void> {
    this.published.push({ customerId: customer.id, versionId: version.id });
  }

  async remind(customer: Customer, _state: CustomerVersionState, version: AgreementVersion): Promise<void> {
    this.reminders.push({ customerId: customer.id, versionId: version.id });
  }
}
