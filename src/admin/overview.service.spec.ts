import { FixedClock } from '../domain/clock';
import { aCustomer, aVersion, anAcceptance, anActiveVersion, aState } from '../domain/testing/fixtures';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import { OverviewService } from './overview.service';

const T0 = new Date('2026-07-07T09:00:00Z');

describe('OverviewService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let customers: InMemoryCustomerRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let acceptances: InMemoryAcceptanceRepo;
  let service: OverviewService;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    customers = new InMemoryCustomerRepo();
    states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    service = new OverviewService(customers, documents, versions, states, acceptances, new FixedClock(T0));

    await documents.save({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
    await documents.save({ id: 'doc-terms-c', type: 'terms', audience: 'customer', name: 'Terms — Customers' });
    await documents.save({ id: 'doc-dpa-p', type: 'dpa', audience: 'partner', name: 'DPA — Partners' });
  });

  it('builds per-customer rows with one cell per TYPE_AUDIENCE and the required field set', async () => {
    await versions.save(aVersion({ id: 'v-dpa-current', documentId: 'doc-dpa-c', versionLabel: 'June 2026 edition', status: 'PUBLISHED', validFrom: new Date('2026-07-01T00:00:00Z') }));
    await versions.save(aVersion({ id: 'v-terms-current', documentId: 'doc-terms-c', versionLabel: 'April 2026 edition', status: 'PUBLISHED', validFrom: new Date('2026-04-01T00:00:00Z') }));
    await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
    // Terms accepted (current version, TACIT); DPA only up to the old version, current one open (NOTIFIED).
    await acceptances.append(anAcceptance({ id: 'a-terms', customerId: 'c-1', versionId: 'v-terms-current', method: 'TACIT', acceptedAt: new Date('2026-05-01T00:00:00Z') }));
    await versions.save(aVersion({ id: 'v-dpa-old', documentId: 'doc-dpa-c', versionLabel: 'Jan 2025 edition', status: 'RETIRED', validFrom: new Date('2025-01-01T00:00:00Z') }));
    await acceptances.append(anAcceptance({ id: 'a-dpa-old', customerId: 'c-1', versionId: 'v-dpa-old', method: 'ACTIVE_CONSENT', acceptedAt: new Date('2025-01-10T00:00:00Z') }));
    await states.save(aState({ id: 'cvs-dpa', customerId: 'c-1', versionId: 'v-dpa-current', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));

    const { items, total } = await service.overview();
    expect(total).toBe(1);
    // Known gap fixed: the admin overview shows the customer name alongside the id.
    expect(items[0]).toMatchObject({ customerId: 'c-1', customerName: 'Acme GmbH' });
    const cells = items[0].cells;
    expect(cells['TERMS_CUSTOMER']).toMatchObject({ acceptedVersion: 'April 2026 edition', method: 'TACIT', state: undefined, blocking: false });
    expect(cells['TERMS_CUSTOMER'].requiredVersion).toBeUndefined();
    expect(cells['DPA_CUSTOMER']).toMatchObject({
      acceptedVersion: 'Jan 2025 edition',
      method: 'ACTIVE_CONSENT',
      state: 'NOTIFIED',
      requiredVersion: 'June 2026 edition',
      deadlineAt: new Date('2026-07-21T09:00:00Z'),
      blocking: false,
    });
  });

  describe('filters', () => {
    beforeEach(async () => {
      await versions.save(anActiveVersion({ id: 'v-dpa', documentId: 'doc-dpa-c', status: 'PUBLISHED', validFrom: new Date('2026-07-01T00:00:00Z') }));
    });

    it('non_compliant: only customers with EXPIRED_BLOCKING', async () => {
      await customers.save(aCustomer({ id: 'c-blocked', roles: ['customer'] }));
      await customers.save(aCustomer({ id: 'c-ok', roles: ['customer'] }));
      await states.save(aState({ id: 'cvs-b', customerId: 'c-blocked', versionId: 'v-dpa', state: 'EXPIRED_BLOCKING' }));
      await states.save(aState({ id: 'cvs-ok', customerId: 'c-ok', versionId: 'v-dpa', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));

      const { items } = await service.overview({ filter: 'non_compliant' });
      expect(items.map((r) => r.customerId)).toEqual(['c-blocked']);
    });

    it('objected: only customers with an OBJECTED state', async () => {
      await customers.save(aCustomer({ id: 'c-obj', roles: ['customer'] }));
      await customers.save(aCustomer({ id: 'c-ok', roles: ['customer'] }));
      await states.save(aState({ id: 'cvs-obj', customerId: 'c-obj', versionId: 'v-dpa', state: 'OBJECTED' }));
      await states.save(aState({ id: 'cvs-ok', customerId: 'c-ok', versionId: 'v-dpa', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));

      const { items } = await service.overview({ filter: 'objected' });
      expect(items.map((r) => r.customerId)).toEqual(['c-obj']);
    });

    it('unreachable: PENDING_NOTIFICATION without notifiedAt', async () => {
      await customers.save(aCustomer({ id: 'c-unreach', roles: ['customer'] }));
      await customers.save(aCustomer({ id: 'c-notified', roles: ['customer'] }));
      await states.save(aState({ id: 'cvs-u', customerId: 'c-unreach', versionId: 'v-dpa', state: 'PENDING_NOTIFICATION' }));
      await states.save(aState({ id: 'cvs-n', customerId: 'c-notified', versionId: 'v-dpa', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));

      const { items } = await service.overview({ filter: 'unreachable' });
      expect(items.map((r) => r.customerId)).toEqual(['c-unreach']);
    });

    it('pending: PENDING_NOTIFICATION or NOTIFIED', async () => {
      await customers.save(aCustomer({ id: 'c-pending', roles: ['customer'] }));
      await states.save(aState({ id: 'cvs-p', customerId: 'c-pending', versionId: 'v-dpa', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));

      const { items } = await service.overview({ filter: 'pending' });
      expect(items.map((r) => r.customerId)).toEqual(['c-pending']);
    });

    it('deadline_lt_7d: NOTIFIED with deadlineAt in less than 7 days', async () => {
      await customers.save(aCustomer({ id: 'c-soon', roles: ['customer'] }));
      await customers.save(aCustomer({ id: 'c-later', roles: ['customer'] }));
      await states.save(aState({ id: 'cvs-soon', customerId: 'c-soon', versionId: 'v-dpa', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-10T09:00:00Z') }));
      await states.save(aState({ id: 'cvs-later', customerId: 'c-later', versionId: 'v-dpa', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-30T09:00:00Z') }));

      const { items } = await service.overview({ filter: 'deadline_lt_7d' });
      expect(items.map((r) => r.customerId)).toEqual(['c-soon']);
    });
  });

  describe('audience/documentType filters', () => {
    beforeEach(async () => {
      await versions.save(aVersion({ id: 'v-dpa-c', documentId: 'doc-dpa-c', status: 'PUBLISHED', validFrom: new Date('2026-07-01T00:00:00Z') }));
      await versions.save(aVersion({ id: 'v-terms-c', documentId: 'doc-terms-c', status: 'PUBLISHED', validFrom: new Date('2026-07-01T00:00:00Z') }));
      await versions.save(aVersion({ id: 'v-dpa-p', documentId: 'doc-dpa-p', status: 'PUBLISHED', validFrom: new Date('2026-07-01T00:00:00Z') }));
    });

    it('audience=partner: only customers with the partner role, only partner cells', async () => {
      await customers.save(aCustomer({ id: 'c-both', roles: ['customer', 'partner'] }));
      await customers.save(aCustomer({ id: 'c-customer', roles: ['customer'] }));

      const { items } = await service.overview({ audience: 'partner' });
      expect(items).toHaveLength(1);
      expect(items[0].customerId).toBe('c-both');
      expect(Object.keys(items[0].cells)).toEqual(['DPA_PARTNER']);
    });

    it('documentType=terms: only terms cells', async () => {
      await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
      const { items } = await service.overview({ documentType: 'terms' });
      expect(Object.keys(items[0].cells)).toEqual(['TERMS_CUSTOMER']);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await versions.save(aVersion({ id: 'v-dpa-c', documentId: 'doc-dpa-c', status: 'PUBLISHED', validFrom: new Date('2026-07-01T00:00:00Z') }));
      await customers.save(aCustomer({ id: 'c-acme', name: 'Acme GmbH', externalRef: 'crm-4711', roles: ['customer'], contactEmails: ['legal@acme.example'] }));
      await customers.save(aCustomer({ id: 'c-globex', name: 'Globex Corp', externalRef: 'crm-8000', roles: ['customer'], contactEmails: ['ops@globex.test'] }));
    });

    it('filters rows by a case-insensitive substring on name/externalRef/contactEmails', async () => {
      const { items, total } = await service.overview({ search: 'globex' });
      expect(items.map((r) => r.customerId)).toEqual(['c-globex']);
      expect(total).toBe(1);
    });

    it('matches the externalRef too', async () => {
      const { items } = await service.overview({ search: '4711' });
      expect(items.map((r) => r.customerId)).toEqual(['c-acme']);
    });
  });
});
