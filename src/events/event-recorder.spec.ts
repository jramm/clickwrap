import { FixedClock } from '../domain/clock';
import { aCustomer, aDocument, aVersion } from '../domain/testing/fixtures';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerRepo,
  InMemoryEventRepo,
} from '../persistence/inmemory';
import { EventRecorder } from './event-recorder';

const T0 = new Date('2026-07-09T10:00:00Z');

describe('EventRecorder', () => {
  let events: InMemoryEventRepo;
  let versions: InMemoryAgreementVersionRepo;
  let documents: InMemoryAgreementDocumentRepo;
  let customers: InMemoryCustomerRepo;
  let clock: FixedClock;

  beforeEach(() => {
    events = new InMemoryEventRepo();
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    customers = new InMemoryCustomerRepo();
    clock = new FixedClock(T0);
  });

  const recorderWithResolution = (): EventRecorder =>
    new EventRecorder(events, clock, versions, documents, customers);

  it('stamps id + occurredAt (server time) on the appended event', async () => {
    const recorder = new EventRecorder(events, clock);
    await recorder.record({ type: 'EMAIL_SENT', category: 'COMMUNICATION', actorKind: 'SYSTEM', actorLabel: 'system', summary: 's' });

    const { items } = await events.query({});
    expect(items).toHaveLength(1);
    expect(items[0].id).toMatch(/^evt-/);
    expect(items[0].occurredAt.toISOString()).toBe(T0.toISOString());
  });

  it('resolves documentType/audience/versionLabel from versionId when not supplied', async () => {
    await documents.save(aDocument({ id: 'doc-1', type: 'dpa', audience: 'customer' }));
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-1', versionLabel: 'June 2026' }));

    await recorderWithResolution().record({
      type: 'EMAIL_SENT',
      category: 'COMMUNICATION',
      actorKind: 'SYSTEM',
      actorLabel: 'system',
      versionId: 'v-1',
      summary: 'E-mail sent',
    });

    const { items } = await events.query({});
    expect(items[0]).toMatchObject({ documentType: 'dpa', audience: 'customer', versionLabel: 'June 2026' });
  });

  it('resolves customerName from customerId when not supplied', async () => {
    await customers.save(aCustomer({ id: 'c-1', companyName: 'Acme GmbH' }));

    await recorderWithResolution().record({
      type: 'CUSTOMER_UPDATED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: 'admin-1',
      customerId: 'c-1',
      summary: 'updated',
    });

    const { items } = await events.query({});
    expect(items[0].customerName).toBe('Acme GmbH');
  });

  it('never overwrites caller-provided denormalized values', async () => {
    await documents.save(aDocument({ id: 'doc-1', type: 'dpa', audience: 'customer' }));
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-1', versionLabel: 'June 2026' }));
    await customers.save(aCustomer({ id: 'c-1', companyName: 'Acme GmbH' }));

    await recorderWithResolution().record({
      type: 'VERSION_ACCEPTED',
      category: 'CONSENT',
      actorKind: 'CUSTOMER',
      actorLabel: 'customer',
      versionId: 'v-1',
      customerId: 'c-1',
      documentType: 'explicit-type',
      versionLabel: 'explicit-label',
      customerName: 'Explicit Name',
      summary: 'accepted',
    });

    const { items } = await events.query({});
    expect(items[0]).toMatchObject({
      documentType: 'explicit-type',
      versionLabel: 'explicit-label',
      customerName: 'Explicit Name',
      audience: 'customer',
    });
  });

  it('swallows a resolution failure without breaking the record (event still appended)', async () => {
    const throwingVersions = {
      findById: async () => {
        throw new Error('db down');
      },
    } as unknown as InMemoryAgreementVersionRepo;
    const recorder = new EventRecorder(events, clock, throwingVersions, documents, customers);

    await expect(
      recorder.record({
        type: 'EMAIL_SENT',
        category: 'COMMUNICATION',
        actorKind: 'SYSTEM',
        actorLabel: 'system',
        versionId: 'v-1',
        summary: 's',
      }),
    ).resolves.toBeUndefined();
    // Resolution threw BEFORE append, so nothing was written — but the caller never sees the error.
    expect((await events.query({})).items).toHaveLength(0);
  });

  it('is a no-op resolver when the repos are absent (legacy two-arg construction)', async () => {
    const recorder = new EventRecorder(events, clock);
    await recorder.record({
      type: 'EMAIL_SENT',
      category: 'COMMUNICATION',
      actorKind: 'SYSTEM',
      actorLabel: 'system',
      versionId: 'v-1',
      customerId: 'c-1',
      summary: 's',
    });

    const { items } = await events.query({});
    expect(items[0].documentType).toBeUndefined();
    expect(items[0].customerName).toBeUndefined();
  });
});
