import type { AgreementVersionRepo } from '../domain/ports';
import { aCustomer, aNotification, aState, aVersion } from '../domain/testing/fixtures';
import type { AgreementVersion } from '../domain/types';
import { InMemoryCustomerRepo } from '../persistence/inmemory/customer.repo';
import { InMemoryCustomerVersionStateRepo } from '../persistence/inmemory/customer-version-state.repo';
import { InMemoryNotificationEventRepo } from '../persistence/inmemory/notification-event.repo';
import { InMemoryReminderCandidateRepo } from './reminder-candidate.repo.inmemory';

class FakeAgreementVersionRepo implements AgreementVersionRepo {
  private readonly versions = new Map<string, AgreementVersion>();

  seed(version: AgreementVersion): void {
    this.versions.set(version.id, version);
  }

  async findById(id: string) {
    return this.versions.get(id);
  }

  async save(): Promise<AgreementVersion> {
    throw new Error('not implemented');
  }

  async findByDocument(): Promise<AgreementVersion[]> {
    throw new Error('not implemented');
  }

  async findCurrentPublished(): Promise<AgreementVersion | undefined> {
    throw new Error('not implemented');
  }

  async findUpcomingPublishedList(): Promise<AgreementVersion[]> {
    throw new Error('not implemented');
  }

  async delete(): Promise<void> {
    throw new Error('not implemented');
  }
}

const BEFORE = new Date('2026-07-14T09:00:00Z');

describe('InMemoryReminderCandidateRepo', () => {
  it('returns NOTIFIED states with deadlineAt <= before, including customer/version/recipient', async () => {
    const customers = new InMemoryCustomerRepo();
    const states = new InMemoryCustomerVersionStateRepo();
    const versions = new FakeAgreementVersionRepo();
    const notifications = new InMemoryNotificationEventRepo();

    await customers.save(aCustomer({ id: 'c-123' }));
    versions.seed(aVersion({ id: 'v-1' }));
    await states.save(
      aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'NOTIFIED', deadlineAt: BEFORE }),
    );
    await notifications.append(
      aNotification({ id: 'n-1', customerVersionStateId: 'cvs-1', recipient: 'max@customer.example', occurredAt: new Date('2026-07-07T09:00:00Z') }),
    );

    const repo = new InMemoryReminderCandidateRepo(customers, states, versions, notifications);
    const candidates = await repo.findDue(BEFORE);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ recipient: 'max@customer.example' });
    expect(candidates[0].customer.id).toBe('c-123');
    expect(candidates[0].version.id).toBe('v-1');
  });

  it("picks the recipient from the state's MOST RECENT NotificationEvent", async () => {
    const customers = new InMemoryCustomerRepo();
    const states = new InMemoryCustomerVersionStateRepo();
    const versions = new FakeAgreementVersionRepo();
    const notifications = new InMemoryNotificationEventRepo();

    await customers.save(aCustomer({ id: 'c-123' }));
    versions.seed(aVersion({ id: 'v-1' }));
    await states.save(
      aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'NOTIFIED', deadlineAt: BEFORE }),
    );
    await notifications.append(
      aNotification({
        id: 'n-1',
        customerVersionStateId: 'cvs-1',
        recipient: 'alt@customer.example',
        occurredAt: new Date('2026-07-06T09:00:00Z'),
      }),
    );
    await notifications.append(
      aNotification({
        id: 'n-2',
        customerVersionStateId: 'cvs-1',
        recipient: 'neu@customer.example',
        occurredAt: new Date('2026-07-07T09:00:00Z'),
      }),
    );

    const repo = new InMemoryReminderCandidateRepo(customers, states, versions, notifications);
    const [candidate] = await repo.findDue(BEFORE);

    expect(candidate.recipient).toBe('neu@customer.example');
  });

  it('ignores states whose deadlineAt is outside the horizon', async () => {
    const customers = new InMemoryCustomerRepo();
    const states = new InMemoryCustomerVersionStateRepo();
    const versions = new FakeAgreementVersionRepo();
    const notifications = new InMemoryNotificationEventRepo();

    await customers.save(aCustomer({ id: 'c-123' }));
    versions.seed(aVersion({ id: 'v-1' }));
    await states.save(
      aState({
        id: 'cvs-1',
        customerId: 'c-123',
        versionId: 'v-1',
        state: 'NOTIFIED',
        deadlineAt: new Date('2026-08-01T00:00:00Z'),
      }),
    );

    const repo = new InMemoryReminderCandidateRepo(customers, states, versions, notifications);
    expect(await repo.findDue(BEFORE)).toHaveLength(0);
  });

  it('ignores non-NOTIFIED states (e.g. ACCEPTED, SUPERSEDED)', async () => {
    const customers = new InMemoryCustomerRepo();
    const states = new InMemoryCustomerVersionStateRepo();
    const versions = new FakeAgreementVersionRepo();
    const notifications = new InMemoryNotificationEventRepo();

    await customers.save(aCustomer({ id: 'c-123' }));
    versions.seed(aVersion({ id: 'v-1' }));
    await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'ACCEPTED' }));

    const repo = new InMemoryReminderCandidateRepo(customers, states, versions, notifications);
    expect(await repo.findDue(BEFORE)).toHaveLength(0);
  });

  it('includes a PENDING_NOTIFICATION state with a due deadlineAt (never-accessed ACTIVE hard deadline)', async () => {
    const customers = new InMemoryCustomerRepo();
    const states = new InMemoryCustomerVersionStateRepo();
    const versions = new FakeAgreementVersionRepo();
    const notifications = new InMemoryNotificationEventRepo();

    await customers.save(aCustomer({ id: 'c-123' }));
    versions.seed(aVersion({ id: 'v-1' }));
    await states.save(
      aState({
        id: 'cvs-1',
        customerId: 'c-123',
        versionId: 'v-1',
        state: 'PENDING_NOTIFICATION',
        deadlineAt: BEFORE,
      }),
    );
    await notifications.append(
      aNotification({ id: 'n-1', customerVersionStateId: 'cvs-1', recipient: 'max@customer.example', occurredAt: new Date('2026-07-07T09:00:00Z') }),
    );

    const repo = new InMemoryReminderCandidateRepo(customers, states, versions, notifications);
    const candidates = await repo.findDue(BEFORE);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].state.state).toBe('PENDING_NOTIFICATION');
    expect(candidates[0]).toMatchObject({ recipient: 'max@customer.example' });
  });

  it('excludes a PENDING_NOTIFICATION state WITHOUT a deadlineAt (PASSIVE never-accessed)', async () => {
    const customers = new InMemoryCustomerRepo();
    const states = new InMemoryCustomerVersionStateRepo();
    const versions = new FakeAgreementVersionRepo();
    const notifications = new InMemoryNotificationEventRepo();

    await customers.save(aCustomer({ id: 'c-123' }));
    versions.seed(aVersion({ id: 'v-1' }));
    await states.save(
      aState({
        id: 'cvs-1',
        customerId: 'c-123',
        versionId: 'v-1',
        state: 'PENDING_NOTIFICATION',
        deadlineAt: undefined,
      }),
    );
    await notifications.append(
      aNotification({ id: 'n-1', customerVersionStateId: 'cvs-1', recipient: 'max@customer.example', occurredAt: new Date('2026-07-07T09:00:00Z') }),
    );

    const repo = new InMemoryReminderCandidateRepo(customers, states, versions, notifications);
    expect(await repo.findDue(BEFORE)).toHaveLength(0);
  });

  it('without a known NotificationEvent there is no candidate (no known recipient)', async () => {
    const customers = new InMemoryCustomerRepo();
    const states = new InMemoryCustomerVersionStateRepo();
    const versions = new FakeAgreementVersionRepo();
    const notifications = new InMemoryNotificationEventRepo();

    await customers.save(aCustomer({ id: 'c-123' }));
    versions.seed(aVersion({ id: 'v-1' }));
    await states.save(
      aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'NOTIFIED', deadlineAt: BEFORE }),
    );

    const repo = new InMemoryReminderCandidateRepo(customers, states, versions, notifications);
    expect(await repo.findDue(BEFORE)).toHaveLength(0);
  });
});
