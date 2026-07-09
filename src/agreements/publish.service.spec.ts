import { DomainError } from '../common/errors';
import { FixedClock } from '../domain/clock';
import { sweep } from '../domain/state-machine';
import { aCustomer, aState, aVersion, anActiveVersion } from '../domain/testing/fixtures';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryEventRepo,
} from '../persistence/inmemory';
import { EventRecorder } from '../events/event-recorder';
import { InMemoryAdminAuditRepo } from './audit';
import { InMemoryRolloutNotifier } from './rollout-notifier.inmemory';
import { PublishService } from './publish.service';

const T0 = new Date('2026-07-07T09:00:00Z');

const expectCode = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code });
};

describe('PublishService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let customers: InMemoryCustomerRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let acceptances: InMemoryAcceptanceRepo;
  let notifier: InMemoryRolloutNotifier;
  let audit: InMemoryAdminAuditRepo;
  let clock: FixedClock;
  let events: InMemoryEventRepo;
  let service: PublishService;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    customers = new InMemoryCustomerRepo();
    states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    notifier = new InMemoryRolloutNotifier();
    audit = new InMemoryAdminAuditRepo();
    clock = new FixedClock(T0);
    events = new InMemoryEventRepo();
    service = new PublishService(versions, documents, customers, states, notifier, audit, clock, new EventRecorder(events, clock));
    await documents.save({ id: 'doc-dpa-customer', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
  });

  describe('validateForPublish', () => {
    it('unknown version → VERSION_NOT_FOUND', async () => {
      await expectCode(service.publish('v-unknown', 'admin-1'), 'VERSION_NOT_FOUND');
    });

    it('without changeSummary → CHANGE_SUMMARY_REQUIRED', async () => {
      await versions.save(aVersion({ id: 'v-1', status: 'DRAFT', changeSummary: '   ' }));
      await expectCode(service.publish('v-1', 'admin-1'), 'CHANGE_SUMMARY_REQUIRED');
    });

    it('ACTIVE without consentText → CONSENT_TEXT_REQUIRED', async () => {
      await versions.save(anActiveVersion({ id: 'v-1', status: 'DRAFT', consentText: undefined }));
      await expectCode(service.publish('v-1', 'admin-1'), 'CONSENT_TEXT_REQUIRED');
    });

    it('PASSIVE without objectionPeriodDays → INVALID_STATE', async () => {
      await versions.save(aVersion({ id: 'v-1', status: 'DRAFT', objectionPeriodDays: undefined }));
      await expectCode(service.publish('v-1', 'admin-1'), 'INVALID_STATE');
    });

    it('PATCH-immutable: publishing an already PUBLISHED version again → VERSION_IMMUTABLE (assertDraftMutable)', async () => {
      await versions.save(aVersion({ id: 'v-1', status: 'PUBLISHED' }));
      await expectCode(service.publish('v-1', 'admin-1'), 'VERSION_IMMUTABLE');
    });

  });

  describe('scheduled publish (validFrom in the future)', () => {
    const FUTURE = new Date('2026-08-01T00:00:00Z');

    it('publishes the version and rolls out immediately (states + mails), so acceptance can be collected in advance', async () => {
      await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
      await versions.save(aVersion({ id: 'v-next', status: 'DRAFT', validFrom: FUTURE }));

      const result = await service.publish('v-next', 'admin-1');

      expect(result).toMatchObject({ versionId: 'v-next', status: 'PUBLISHED', rolloutCustomers: 1, publishedAt: T0 });
      expect(await versions.findById('v-next')).toMatchObject({ status: 'PUBLISHED', publishedAt: T0, publishedBy: 'admin-1' });
      expect(await states.findByCustomerAndVersion('c-1', 'v-next')).toMatchObject({ state: 'PENDING_NOTIFICATION' });
      expect(notifier.published).toEqual([{ customerId: 'c-1', versionId: 'v-next' }]);
    });

    it('does NOT retire the predecessor and does NOT supersede its open states — the old version stays the compliance baseline until the flip', async () => {
      await versions.save(aVersion({ id: 'v-old', status: 'PUBLISHED', validFrom: new Date('2026-06-01T00:00:00Z') }));
      await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
      await states.save(
        aState({ id: 'cvs-old', customerId: 'c-1', versionId: 'v-old', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }),
      );
      await versions.save(aVersion({ id: 'v-next', status: 'DRAFT', validFrom: FUTURE }));

      await service.publish('v-next', 'admin-1');

      expect((await versions.findById('v-old'))?.status).toBe('PUBLISHED');
      expect((await states.findById('cvs-old'))?.state).toBe('NOTIFIED');
      // findCurrentPublished still selects the predecessor before the flip …
      expect((await versions.findCurrentPublished('dpa', 'customer', T0))?.id).toBe('v-old');
      // … and the upcoming version after it.
      expect((await versions.findCurrentPublished('dpa', 'customer', FUTURE))?.id).toBe('v-next');
    });

    it('does NOT set carryOverBlocking at publish time — block carry-over is applied by the activation sweeper at the flip', async () => {
      await versions.save(aVersion({ id: 'v-old', status: 'PUBLISHED', validFrom: new Date('2026-06-01T00:00:00Z') }));
      await customers.save(aCustomer({ id: 'c-blocked', roles: ['customer'] }));
      await states.save(aState({ id: 'cvs-blocked', customerId: 'c-blocked', versionId: 'v-old', state: 'EXPIRED_BLOCKING' }));
      await versions.save(aVersion({ id: 'v-next', status: 'DRAFT', validFrom: FUTURE }));

      await service.publish('v-next', 'admin-1');

      // The predecessor block itself stays active (state untouched) …
      expect((await states.findById('cvs-blocked'))?.state).toBe('EXPIRED_BLOCKING');
      // … so the successor state must not double-book the block before the flip.
      expect((await states.findByCustomerAndVersion('c-blocked', 'v-next'))?.carryOverBlocking).toBeUndefined();
    });
  });

  describe('publish', () => {
    it('sets the version to PUBLISHED with publishedAt/By', async () => {
      await versions.save(aVersion({ id: 'v-1', status: 'DRAFT' }));
      const result = await service.publish('v-1', 'admin-1');
      expect(result).toMatchObject({ versionId: 'v-1', status: 'PUBLISHED', publishedAt: T0 });
      const stored = await versions.findById('v-1');
      expect(stored).toMatchObject({ status: 'PUBLISHED', publishedAt: T0, publishedBy: 'admin-1' });
    });

    it('sets the previous PUBLISHED version of the same document to RETIRED', async () => {
      await versions.save(aVersion({ id: 'v-old', status: 'PUBLISHED' }));
      await versions.save(aVersion({ id: 'v-new', status: 'DRAFT', versionLabel: 'July 2026 edition' }));
      await service.publish('v-new', 'admin-1');
      expect((await versions.findById('v-old'))?.status).toBe('RETIRED');
      expect((await versions.findById('v-new'))?.status).toBe('PUBLISHED');
    });

    it('closes open states of the predecessor version as SUPERSEDED (the sweeper books nothing afterwards)', async () => {
      await versions.save(aVersion({ id: 'v-old', status: 'PUBLISHED' }));
      await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
      await states.save(
        aState({ id: 'cvs-old', customerId: 'c-1', versionId: 'v-old', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }),
      );
      await versions.save(aVersion({ id: 'v-new', status: 'DRAFT' }));
      await service.publish('v-new', 'admin-1');

      const superseded = await states.findById('cvs-old');
      expect(superseded?.state).toBe('SUPERSEDED');
      // The sweeper would book nothing for a SUPERSEDED state (NOOP).
      clock.set(new Date('2026-08-01T00:00:00Z'));
      expect(sweep(superseded!, aVersion({ id: 'v-old' }), clock).outcome).toBe('NOOP');
    });

    it('creates a new PENDING_NOTIFICATION state per customer with a matching role', async () => {
      await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
      await customers.save(aCustomer({ id: 'c-2', roles: ['customer'] }));
      await versions.save(aVersion({ id: 'v-1', status: 'DRAFT' }));
      const result = await service.publish('v-1', 'admin-1');

      expect(result.rolloutCustomers).toBe(2);
      const s1 = await states.findByCustomerAndVersion('c-1', 'v-1');
      expect(s1).toMatchObject({ state: 'PENDING_NOTIFICATION', remindersSent: 0 });
      expect(notifier.published).toEqual(
        expect.arrayContaining([
          { customerId: 'c-1', versionId: 'v-1' },
          { customerId: 'c-2', versionId: 'v-1' },
        ]),
      );
    });

    it('ACTIVE rollout stamps the absolute hard deadline on each created state (before any access)', async () => {
      const HARD = new Date('2026-07-21T09:00:00Z');
      await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
      await versions.save(anActiveVersion({ id: 'v-active', documentId: 'doc-dpa-customer', status: 'DRAFT', hardDeadlineAt: HARD }));

      await service.publish('v-active', 'admin-1');

      const state = await states.findByCustomerAndVersion('c-1', 'v-active');
      expect(state).toMatchObject({ state: 'PENDING_NOTIFICATION' });
      expect(state?.deadlineAt).toEqual(HARD);
    });

    it('PASSIVE rollout leaves deadlineAt undefined (starts only at provable access)', async () => {
      await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
      await versions.save(aVersion({ id: 'v-1', status: 'DRAFT', objectionPeriodDays: 14 }));

      await service.publish('v-1', 'admin-1');

      expect((await states.findByCustomerAndVersion('c-1', 'v-1'))?.deadlineAt).toBeUndefined();
    });

    it('rollout only targets matching roles — a partner-only customer gets no state', async () => {
      await customers.save(aCustomer({ id: 'c-customer', roles: ['customer'] }));
      await customers.save(aCustomer({ id: 'c-partner', roles: ['partner'] }));
      await versions.save(aVersion({ id: 'v-1', status: 'DRAFT' }));
      const result = await service.publish('v-1', 'admin-1');

      expect(result.rolloutCustomers).toBe(1);
      expect(await states.findByCustomerAndVersion('c-partner', 'v-1')).toBeUndefined();
      expect(await states.findByCustomerAndVersion('c-customer', 'v-1')).toBeDefined();
    });

    it('dual role: a customer with customer+partner gets exactly one state for the customer version', async () => {
      await customers.save(aCustomer({ id: 'c-both', roles: ['customer', 'partner'] }));
      await versions.save(aVersion({ id: 'v-1', status: 'DRAFT' }));
      const result = await service.publish('v-1', 'admin-1');

      expect(result.rolloutCustomers).toBe(1);
      const forCustomer = (await states.findByCustomer('c-both')).filter((s) => s.versionId === 'v-1');
      expect(forCustomer).toHaveLength(1);
    });

    it('block carry-over: if the predecessor state was EXPIRED_BLOCKING → new state carryOverBlocking=true', async () => {
      await versions.save(aVersion({ id: 'v-old', status: 'PUBLISHED' }));
      await customers.save(aCustomer({ id: 'c-blocked', roles: ['customer'] }));
      await customers.save(aCustomer({ id: 'c-open', roles: ['customer'] }));
      await states.save(aState({ id: 'cvs-blocked', customerId: 'c-blocked', versionId: 'v-old', state: 'EXPIRED_BLOCKING' }));
      await states.save(aState({ id: 'cvs-open', customerId: 'c-open', versionId: 'v-old', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));
      await versions.save(aVersion({ id: 'v-new', status: 'DRAFT' }));
      await service.publish('v-new', 'admin-1');

      expect((await states.findByCustomerAndVersion('c-blocked', 'v-new'))?.carryOverBlocking).toBe(true);
      expect((await states.findByCustomerAndVersion('c-open', 'v-new'))?.carryOverBlocking).toBeUndefined();
    });

    it('writes a PUBLISH audit log entry', async () => {
      await versions.save(aVersion({ id: 'v-1', status: 'DRAFT' }));
      await service.publish('v-1', 'admin-1');
      const logs = await audit.findByTarget('AgreementVersion', 'v-1');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: 'PUBLISH', actor: 'admin-1' });
    });
  });

  describe('event recording', () => {
    it('records a VERSION_PUBLISHED event on success', async () => {
      await versions.save(aVersion({ id: 'v-1', status: 'DRAFT', versionLabel: 'June 2026 edition' }));
      await service.publish('v-1', 'admin-1');
      const { items } = await events.query({});
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'VERSION_PUBLISHED',
        category: 'ADMINISTRATION',
        actorKind: 'ADMIN',
        actorLabel: 'admin-1',
        versionId: 'v-1',
        documentType: 'dpa',
        audience: 'customer',
        versionLabel: 'June 2026 edition',
      });
    });

    it('records NO event when validation fails', async () => {
      await versions.save(aVersion({ id: 'v-1', status: 'DRAFT', changeSummary: '' }));
      await expectCode(service.publish('v-1', 'admin-1'), 'CHANGE_SUMMARY_REQUIRED');
      expect((await events.query({})).total).toBe(0);
    });

    it('records an OBLIGATION_ROLLED_OUT event (ADMIN, CONSENT) per rolled-out customer', async () => {
      await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
      await versions.save(aVersion({ id: 'v-1', status: 'DRAFT', versionLabel: 'June 2026 edition' }));

      await service.publish('v-1', 'admin-1');

      const obligations = (await events.query({})).items.filter((e) => e.type === 'OBLIGATION_ROLLED_OUT');
      expect(obligations).toHaveLength(1);
      expect(obligations[0]).toMatchObject({
        category: 'CONSENT',
        actorKind: 'ADMIN',
        actorLabel: 'admin-1',
        customerId: 'c-1',
        versionId: 'v-1',
        versionLabel: 'June 2026 edition',
        summary: 'Customer put under obligation for version June 2026 edition',
      });
    });

    it('records a VERSION_RETIRED event (ADMIN) when an immediate publish retires the predecessor', async () => {
      await versions.save(aVersion({ id: 'v-old', status: 'PUBLISHED', versionLabel: 'May 2026 edition', validFrom: new Date('2026-06-01T00:00:00Z') }));
      await versions.save(aVersion({ id: 'v-1', status: 'DRAFT', versionLabel: 'June 2026 edition' }));

      await service.publish('v-1', 'admin-1');

      const retired = (await events.query({})).items.filter((e) => e.type === 'VERSION_RETIRED');
      expect(retired).toHaveLength(1);
      expect(retired[0]).toMatchObject({
        category: 'ADMINISTRATION',
        actorKind: 'ADMIN',
        versionId: 'v-old',
        versionLabel: 'May 2026 edition',
        summary: 'Version May 2026 edition retired',
      });
    });
  });
});
