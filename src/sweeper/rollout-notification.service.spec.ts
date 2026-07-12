import type { AgreementVersion, Customer, CustomerVersionState } from '../domain/types.js';
import { aCustomer, aState, aVersion } from '../domain/testing/fixtures.js';
import { InMemoryRolloutNotifier } from '../agreements/rollout-notifier.inmemory.js';
import type { RolloutNotifier } from '../agreements/ports.js';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory/index.js';
import { RolloutNotificationService } from './rollout-notification.service.js';

const T0 = new Date('2026-07-07T09:00:00Z');

/** Notifier that throws for one customer id — to exercise per-candidate failure isolation. */
class FlakyNotifier implements RolloutNotifier {
  readonly published: string[] = [];
  constructor(private readonly failFor: string) {}
  async notifyVersionPublished(customer: Customer, _version: AgreementVersion): Promise<void> {
    if (customer.id === this.failFor) throw new Error('provider down');
    this.published.push(customer.id);
  }
  async remind(): Promise<void> {}
}

describe('RolloutNotificationService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let customers: InMemoryCustomerRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let notifier: InMemoryRolloutNotifier;
  let service: RolloutNotificationService;

  const make = (n: RolloutNotifier = notifier) => new RolloutNotificationService(states, customers, versions, n);

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    customers = new InMemoryCustomerRepo();
    states = new InMemoryCustomerVersionStateRepo();
    notifier = new InMemoryRolloutNotifier();
    service = make();
    await documents.save({ id: 'doc-dpa-customer', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
    await versions.save(aVersion({ id: 'v-1', status: 'PUBLISHED' }));
    await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
    await customers.save(aCustomer({ id: 'c-2', roles: ['customer'] }));
  });

  const dueState = (over: Partial<CustomerVersionState>) =>
    states.save(aState({ state: 'PENDING_NOTIFICATION', versionId: 'v-1', notificationDueAt: T0, ...over }));

  it('sends the queued notifications and clears notificationDueAt on success', async () => {
    await dueState({ id: 'cvs-1', customerId: 'c-1' });
    await dueState({ id: 'cvs-2', customerId: 'c-2' });

    await service.run();

    expect(notifier.published).toEqual(
      expect.arrayContaining([
        { customerId: 'c-1', versionId: 'v-1' },
        { customerId: 'c-2', versionId: 'v-1' },
      ]),
    );
    expect((await states.findById('cvs-1'))?.notificationDueAt).toBeUndefined();
    expect((await states.findById('cvs-2'))?.notificationDueAt).toBeUndefined();
  });

  it('ignores states that are not PENDING_NOTIFICATION or have no notificationDueAt', async () => {
    await states.save(aState({ id: 'cvs-notified', customerId: 'c-1', versionId: 'v-1', state: 'NOTIFIED', notificationDueAt: T0 }));
    await states.save(aState({ id: 'cvs-nodue', customerId: 'c-2', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));

    await service.run();

    expect(notifier.published).toEqual([]);
  });

  it('is failure-isolated: a send that throws keeps its marker (retried), others are still cleared', async () => {
    await dueState({ id: 'cvs-1', customerId: 'c-1' });
    await dueState({ id: 'cvs-2', customerId: 'c-2' });
    const flaky = new FlakyNotifier('c-1');

    await make(flaky).run();

    expect(flaky.published).toEqual(['c-2']);
    expect((await states.findById('cvs-1'))?.notificationDueAt).toEqual(T0); // failed → still owed
    expect((await states.findById('cvs-2'))?.notificationDueAt).toBeUndefined(); // sent → cleared
  });

  it('clears an orphaned marker (version gone) without sending', async () => {
    await dueState({ id: 'cvs-orphan', customerId: 'c-1', versionId: 'v-missing' });

    await service.run();

    expect(notifier.published).toEqual([]);
    expect((await states.findById('cvs-orphan'))?.notificationDueAt).toBeUndefined();
  });

  it('respects the batch size (oldest first)', async () => {
    await dueState({ id: 'cvs-old', customerId: 'c-1', notificationDueAt: new Date('2026-07-01T00:00:00Z') });
    await dueState({ id: 'cvs-new', customerId: 'c-2', notificationDueAt: new Date('2026-07-05T00:00:00Z') });

    await service.run(1);

    expect(notifier.published).toEqual([{ customerId: 'c-1', versionId: 'v-1' }]);
    expect((await states.findById('cvs-old'))?.notificationDueAt).toBeUndefined();
    expect((await states.findById('cvs-new'))?.notificationDueAt).toEqual(new Date('2026-07-05T00:00:00Z'));
  });
});
