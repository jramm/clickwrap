import { DomainError } from '../common/errors';
import { FixedClock } from '../domain/clock';
import { aCustomer, aState, aVersion, anAcceptance, testActor } from '../domain/testing/fixtures';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import { DashboardService } from './dashboard.service';
import { VersionCustomersService } from './version-customers.service';

const T0 = new Date('2026-07-07T09:00:00Z');
const PAST = new Date('2026-06-01T00:00:00Z');
const FUTURE = new Date('2026-08-01T00:00:00Z');

describe('VersionCustomersService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let customers: InMemoryCustomerRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let acceptances: InMemoryAcceptanceRepo;
  let dashboard: DashboardService;
  let service: VersionCustomersService;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    customers = new InMemoryCustomerRepo();
    states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    dashboard = new DashboardService(documents, versions, states, acceptances, new FixedClock(T0));
    service = new VersionCustomersService(customers, states, acceptances, dashboard);

    await documents.save({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
  });

  describe('the drill-down bug scenario (version dimension preserved)', () => {
    beforeEach(async () => {
      // Current (June) version and an UPCOMING (August) version of the same document.
      await versions.save(aVersion({ id: 'v-current', documentId: 'doc-dpa-c', versionLabel: 'June 2026 edition', status: 'PUBLISHED', validFrom: PAST }));
      await versions.save(aVersion({ id: 'v-upcoming', documentId: 'doc-dpa-c', versionLabel: 'August 2026 edition', status: 'PUBLISHED', validFrom: FUTURE }));
      await customers.save(aCustomer({ id: 'c-1', companyName: 'Acme GmbH', externalRef: 'crm-4711', roles: ['customer'] }));

      // The customer ACCEPTED the current version …
      await states.save(aState({ id: 'cvs-current', customerId: 'c-1', versionId: 'v-current', state: 'ACCEPTED' }));
      await acceptances.append(
        anAcceptance({ id: 'a-current', customerId: 'c-1', versionId: 'v-current', method: 'ACTIVE_CONSENT', channel: 'PORTAL', acceptedAt: new Date('2026-06-05T10:00:00Z'), actor: testActor({ name: 'Jane Doe' }) }),
      );
      // … but has only been queued for the upcoming version (nobody accepted August yet).
      await states.save(aState({ id: 'cvs-upcoming', customerId: 'c-1', versionId: 'v-upcoming', state: 'PENDING_NOTIFICATION' }));
    });

    it('shows the customer as PENDING (not ACCEPTED) for the UPCOMING version, with no acceptance', async () => {
      const { items } = await service.list('v-upcoming');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ customerId: 'c-1', state: 'PENDING_NOTIFICATION' });
      expect(items[0].acceptance).toBeUndefined();
    });

    it('shows the SAME customer as ACCEPTED for the current version, with the acceptance of THAT version', async () => {
      const { items } = await service.list('v-current');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ customerId: 'c-1', state: 'ACCEPTED' });
      expect(items[0].acceptance).toEqual({
        acceptedAt: new Date('2026-06-05T10:00:00Z'),
        method: 'ACTIVE_CONSENT',
        channel: 'PORTAL',
        actorName: 'Jane Doe',
      });
    });
  });

  describe('rows, filters, search, pagination', () => {
    beforeEach(async () => {
      await versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-c', versionLabel: 'June 2026 edition', status: 'PUBLISHED', validFrom: PAST }));
      await customers.save(aCustomer({ id: 'c-acc', companyName: 'Accepted Co', externalRef: 'crm-1', roles: ['customer'], contactEmails: ['a@acc.test'] }));
      await customers.save(aCustomer({ id: 'c-pend', companyName: 'Pending Co', externalRef: 'crm-2', roles: ['customer'], contactEmails: ['b@pend.test'] }));
      await customers.save(aCustomer({ id: 'c-block', companyName: 'Blocked Co', externalRef: 'crm-3', roles: ['customer'], contactEmails: ['c@block.test'] }));
      await customers.save(aCustomer({ id: 'c-obj', companyName: 'Objected Co', externalRef: 'crm-4', roles: ['customer'], contactEmails: ['d@obj.test'] }));

      await states.save(aState({ id: 's-acc', customerId: 'c-acc', versionId: 'v-1', state: 'ACCEPTED' }));
      await acceptances.append(anAcceptance({ id: 'a-acc', customerId: 'c-acc', versionId: 'v-1', method: 'IMPORT', channel: 'ADMIN' }));
      await states.save(aState({ id: 's-pend', customerId: 'c-pend', versionId: 'v-1', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));
      await states.save(aState({ id: 's-block', customerId: 'c-block', versionId: 'v-1', state: 'EXPIRED_BLOCKING', deadlineAt: new Date('2026-06-30T00:00:00Z') }));
      await states.save(aState({ id: 's-obj', customerId: 'c-obj', versionId: 'v-1', state: 'OBJECTED' }));
      // A SUPERSEDED state must never appear in this view.
      await customers.save(aCustomer({ id: 'c-super', companyName: 'Superseded Co', externalRef: 'crm-5', roles: ['customer'] }));
      await states.save(aState({ id: 's-super', customerId: 'c-super', versionId: 'v-1', state: 'SUPERSEDED' }));
    });

    it('lists all non-SUPERSEDED customers sorted by name', async () => {
      const { items, total } = await service.list('v-1');
      expect(total).toBe(4);
      expect(items.map((r) => r.customerId)).toEqual(['c-acc', 'c-block', 'c-obj', 'c-pend']);
      expect(items.some((r) => r.customerId === 'c-super')).toBe(false);
    });

    it('carries the deadline for pending/blocked rows', async () => {
      const { items } = await service.list('v-1', { state: 'pending' });
      expect(items).toEqual([
        expect.objectContaining({ customerId: 'c-pend', state: 'NOTIFIED', deadlineAt: new Date('2026-07-21T09:00:00Z') }),
      ]);
    });

    it.each([
      ['accepted', ['c-acc']],
      ['pending', ['c-pend']],
      ['blocked', ['c-block']],
      ['objected', ['c-obj']],
    ] as const)('filters by state=%s', async (state, expected) => {
      const { items } = await service.list('v-1', { state });
      expect(items.map((r) => r.customerId)).toEqual(expected);
    });

    it('searches by name / externalRef / e-mail', async () => {
      expect((await service.list('v-1', { search: 'Pending' })).items.map((r) => r.customerId)).toEqual(['c-pend']);
      expect((await service.list('v-1', { search: 'crm-3' })).items.map((r) => r.customerId)).toEqual(['c-block']);
      expect((await service.list('v-1', { search: 'd@obj.test' })).items.map((r) => r.customerId)).toEqual(['c-obj']);
    });

    it('paginates in blocks of 50', async () => {
      for (let i = 0; i < 60; i++) {
        await customers.save(aCustomer({ id: `c-bulk-${String(i).padStart(3, '0')}`, companyName: `Bulk ${String(i).padStart(3, '0')}`, externalRef: `bulk-${i}`, roles: ['customer'] }));
        await states.save(aState({ id: `s-bulk-${i}`, customerId: `c-bulk-${String(i).padStart(3, '0')}`, versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));
      }
      const page1 = await service.list('v-1', { page: 1 });
      const page2 = await service.list('v-1', { page: 2 });
      expect(page1.total).toBe(64); // 4 base + 60 bulk
      expect(page1.items).toHaveLength(50);
      expect(page2.items).toHaveLength(14);
    });

    it('reuses the dashboard per-version stats (header numbers match the card)', async () => {
      const { stats } = await service.list('v-1');
      const dashboardStats = await dashboard.versionStats('v-1');
      expect(stats).toEqual(dashboardStats);
      expect(stats.stats).toMatchObject({ totalCustomers: 4, accepted: 1, pending: 1, blocked: 1, objected: 1 });
      expect(stats.versionLabel).toBe('June 2026 edition');
    });
  });

  it('throws VERSION_NOT_FOUND for an unknown version id', async () => {
    await expect(service.list('missing')).rejects.toMatchObject({
      name: 'DomainError',
      code: 'VERSION_NOT_FOUND',
    });
    await expect(service.list('missing')).rejects.toBeInstanceOf(DomainError);
  });
});
