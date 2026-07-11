import { DomainError } from '../common/errors.js';
import { InMemoryAdminAuditRepo } from '../agreements/audit.js';
import { InMemoryRolloutNotifier } from '../agreements/rollout-notifier.inmemory.js';
import { FixedClock } from '../domain/clock.js';
import { aCustomer, aState, aVersion } from '../domain/testing/fixtures.js';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryEventRepo,
} from '../persistence/inmemory/index.js';
import { EventRecorder } from '../events/event-recorder.js';
import { CustomerVersionStateAdminService } from './customer-version-state-admin.service.js';

const T0 = new Date('2026-07-07T09:00:00Z');
const NEW_DEADLINE = new Date('2026-08-01T09:00:00Z');

const expectCode = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code });
};

describe('CustomerVersionStateAdminService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let customers: InMemoryCustomerRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let notifier: InMemoryRolloutNotifier;
  let audit: InMemoryAdminAuditRepo;
  let events: InMemoryEventRepo;
  let service: CustomerVersionStateAdminService;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    customers = new InMemoryCustomerRepo();
    states = new InMemoryCustomerVersionStateRepo();
    notifier = new InMemoryRolloutNotifier();
    audit = new InMemoryAdminAuditRepo();
    events = new InMemoryEventRepo();
    service = new CustomerVersionStateAdminService(
      states,
      versions,
      customers,
      notifier,
      audit,
      new FixedClock(T0),
      new EventRecorder(events, new FixedClock(T0)),
    );

    await documents.save({ id: 'doc-dpa-customer', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-customer' }));
    await customers.save(aCustomer({ id: 'c-123' }));
  });

  describe('patch', () => {
    it('extend deadline: sets a new deadlineAt + audit log', async () => {
      await states.save(aState({ id: 'cvs-1', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));
      const result = await service.patch('cvs-1', { deadlineAt: NEW_DEADLINE, reason: 'Cohort postponed' }, 'admin-1');
      expect(result.deadlineAt).toEqual(NEW_DEADLINE);
      expect(result.state).toBe('NOTIFIED');
      const logs = await audit.findByTarget('CustomerVersionState', 'cvs-1');
      expect(logs[0]).toMatchObject({ action: 'CUSTOMER_VERSION_STATE_PATCH', actor: 'admin-1', reason: 'Cohort postponed' });
    });

    it('suspend block: EXPIRED_BLOCKING → NOTIFIED with a new deadlineAt', async () => {
      await states.save(aState({ id: 'cvs-1', state: 'EXPIRED_BLOCKING' }));
      const result = await service.patch('cvs-1', { suspendBlock: true, deadlineAt: NEW_DEADLINE, reason: 'Special case' }, 'admin-1');
      expect(result).toMatchObject({ state: 'NOTIFIED', deadlineAt: NEW_DEADLINE });
    });

    it('missing reason → INVALID_STATE', async () => {
      await states.save(aState({ id: 'cvs-1', state: 'NOTIFIED' }));
      await expectCode(service.patch('cvs-1', { deadlineAt: NEW_DEADLINE, reason: '  ' }, 'admin-1'), 'INVALID_STATE');
    });

    it('block suspension without deadlineAt → INVALID_STATE', async () => {
      await states.save(aState({ id: 'cvs-1', state: 'EXPIRED_BLOCKING' }));
      await expectCode(service.patch('cvs-1', { suspendBlock: true, reason: 'x' }, 'admin-1'), 'INVALID_STATE');
    });

    it('block suspension from a non-EXPIRED_BLOCKING state → INVALID_STATE', async () => {
      await states.save(aState({ id: 'cvs-1', state: 'NOTIFIED' }));
      await expectCode(service.patch('cvs-1', { suspendBlock: true, deadlineAt: NEW_DEADLINE, reason: 'x' }, 'admin-1'), 'INVALID_STATE');
    });

    it('neither deadline nor block → INVALID_STATE', async () => {
      await states.save(aState({ id: 'cvs-1', state: 'NOTIFIED' }));
      await expectCode(service.patch('cvs-1', { reason: 'x' }, 'admin-1'), 'INVALID_STATE');
    });

    it('unknown state → INVALID_STATE', async () => {
      await expectCode(service.patch('cvs-unknown', { deadlineAt: NEW_DEADLINE, reason: 'x' }, 'admin-1'), 'INVALID_STATE');
    });
  });

  describe('remind', () => {
    it('calls RolloutNotifier.remind, increments remindersSent + audit log', async () => {
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'NOTIFIED', remindersSent: 1 }));
      const result = await service.remind('cvs-1', 'admin-1');
      expect(result.remindersSent).toBe(2);
      expect(notifier.reminders).toEqual([{ customerId: 'c-123', versionId: 'v-1' }]);
      const logs = await audit.findByTarget('CustomerVersionState', 'cvs-1');
      expect(logs[0]).toMatchObject({ action: 'REMIND', actor: 'admin-1' });
    });

    it('unknown state → INVALID_STATE', async () => {
      await expectCode(service.remind('cvs-unknown', 'admin-1'), 'INVALID_STATE');
    });
  });

  describe('event recording', () => {
    it('records DEADLINE_EXTENDED on a deadline extension', async () => {
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));
      await service.patch('cvs-1', { deadlineAt: NEW_DEADLINE, reason: 'Cohort postponed' }, 'admin-1');
      const { items } = await events.query({});
      expect(items[0]).toMatchObject({ type: 'DEADLINE_EXTENDED', category: 'ADMINISTRATION', actorKind: 'ADMIN', customerId: 'c-123', versionId: 'v-1' });
    });

    it('records BLOCK_SUSPENDED when suspending a block', async () => {
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'EXPIRED_BLOCKING' }));
      await service.patch('cvs-1', { suspendBlock: true, deadlineAt: NEW_DEADLINE, reason: 'Special case' }, 'admin-1');
      expect((await events.query({})).items[0]).toMatchObject({ type: 'BLOCK_SUSPENDED' });
    });

    it('records REMINDER_TRIGGERED on remind', async () => {
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'NOTIFIED', deadlineAt: new Date('2026-07-21T09:00:00Z') }));
      await service.remind('cvs-1', 'admin-1');
      expect((await events.query({})).items[0]).toMatchObject({ type: 'REMINDER_TRIGGERED', category: 'ADMINISTRATION' });
    });

    it('records NO event when the patch validation fails', async () => {
      await states.save(aState({ id: 'cvs-1', state: 'NOTIFIED' }));
      await expectCode(service.patch('cvs-1', { reason: '' }, 'admin-1'), 'INVALID_STATE');
      expect((await events.query({})).total).toBe(0);
    });
  });
});
