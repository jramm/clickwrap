import { DomainError } from '../common/errors';
import {
  aCustomer,
  aDocument,
  aNotification,
  aState,
  aVersion,
  anAcceptance,
  anObjection,
} from '../domain/testing/fixtures';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryNotificationEventRepo,
  InMemoryObjectionRepo,
} from '../persistence/inmemory';
import { HistoryService } from './history.service';

describe('HistoryService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let customers: InMemoryCustomerRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let acceptances: InMemoryAcceptanceRepo;
  let objections: InMemoryObjectionRepo;
  let notifications: InMemoryNotificationEventRepo;
  let service: HistoryService;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    customers = new InMemoryCustomerRepo();
    states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    objections = new InMemoryObjectionRepo();
    notifications = new InMemoryNotificationEventRepo();
    service = new HistoryService(customers, acceptances, objections, notifications, states, versions, documents);

    await documents.save({ id: 'doc-dpa-customer', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-customer' }));
    await customers.save(aCustomer({ id: 'c-123' }));
  });

  it('unknown customer → CUSTOMER_NOT_FOUND', async () => {
    const promise = service.history('c-unknown');
    await expect(promise).rejects.toBeInstanceOf(DomainError);
    await expect(promise).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('returns acceptances incl. evidence data and enriched document type/label', async () => {
    await acceptances.append(
      anAcceptance({
        id: 'a-1',
        customerId: 'c-123',
        versionId: 'v-1',
        method: 'ACTIVE_CONSENT',
        channel: 'PORTAL',
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
        consentText: 'I agree.',
        consentTextHash: 'sha256:ab12',
        contentHash: 'sha256:9c1e',
      }),
    );

    const history = await service.history('c-123');
    expect(history.acceptances).toHaveLength(1);
    expect(history.acceptances[0]).toMatchObject({
      versionId: 'v-1',
      documentType: 'dpa',
      versionLabel: 'June 2026 edition',
      method: 'ACTIVE_CONSENT',
      channel: 'PORTAL',
      isEffective: true,
    });
    expect(history.acceptances[0].evidence).toMatchObject({
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      consentText: 'I agree.',
      consentTextHash: 'sha256:ab12',
      contentHash: 'sha256:9c1e',
    });
  });

  it('returns the customer objections', async () => {
    await objections.append(anObjection({ id: 'o-1', customerId: 'c-123', versionId: 'v-1' }));
    const history = await service.history('c-123');
    expect(history.objections).toHaveLength(1);
    expect(history.objections[0].id).toBe('o-1');
  });

  it('returns notifications chronologically with versionId and deliveredAt', async () => {
    await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1' }));
    await notifications.append(aNotification({ id: 'n-2', customerVersionStateId: 'cvs-1', channel: 'PORTAL', occurredAt: new Date('2026-07-08T08:00:00Z') }));
    await notifications.append(aNotification({ id: 'n-1', customerVersionStateId: 'cvs-1', channel: 'EMAIL', occurredAt: new Date('2026-07-07T09:00:00Z') }));

    const history = await service.history('c-123');
    expect(history.notifications.map((n) => n.channel)).toEqual(['EMAIL', 'PORTAL']);
    expect(history.notifications[0]).toMatchObject({ versionId: 'v-1', deliveredAt: new Date('2026-07-07T09:00:00Z') });
  });

  it('returns the rollout states incl. state ID for the admin UI operations actions', async () => {
    const customer = aCustomer({ id: 'c-1' });
    await customers.save(customer);
    const version = aVersion({ id: 'v-1', versionLabel: 'June 2026 edition' });
    await documents.save(aDocument({ id: version.documentId }));
    await versions.save(version);
    const state = aState({
      id: 'cvs-1',
      customerId: 'c-1',
      versionId: 'v-1',
      state: 'NOTIFIED',
      remindersSent: 1,
    });
    await states.save(state);

    const history = await service.history('c-1');

    expect(history.states).toHaveLength(1);
    expect(history.states[0]).toMatchObject({
      id: 'cvs-1',
      versionId: 'v-1',
      versionLabel: 'June 2026 edition',
      state: 'NOTIFIED',
      remindersSent: 1,
    });
  });
});
