import { InMemoryAdminAuditRepo } from '../agreements/audit';
import { InMemoryRolloutNotifier } from '../agreements/rollout-notifier.inmemory';
import { CustomerAdminService } from '../customers/customer-admin.service';
import { FixedClock } from '../domain/clock';
import { aCustomer, aDocument, anAudience, aVersion } from '../domain/testing/fixtures';
import type { CustomerVersionState, DomainEvent } from '../domain/types';
import { EventRecorder } from '../events/event-recorder';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryEventRepo,
} from '../persistence/inmemory';
import { CustomerSyncService } from './customer-sync.service';
import type { CustomerSyncConfig } from './ports';
import { FakeCustomerSource } from './testing/fake-customer-source';

const T0 = new Date('2026-07-09T12:00:00Z');
const SOURCE = 'metergrid';

describe('CustomerSyncService', () => {
  let customers: InMemoryCustomerRepo;
  let events: InMemoryEventRepo;
  let source: FakeCustomerSource;
  let recorder: EventRecorder;
  let service: CustomerSyncService;
  // Exposed by the last build() so tests can seed audiences/documents/versions and assert states.
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let audiences: InMemoryAudienceRepo;
  let customerAdmin: CustomerAdminService;

  const build = (config: Partial<CustomerSyncConfig> = {}): CustomerSyncService => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    states = new InMemoryCustomerVersionStateRepo();
    const acceptances = new InMemoryAcceptanceRepo();
    audiences = new InMemoryAudienceRepo(documents, customers);
    const clock = new FixedClock(T0);
    recorder = new EventRecorder(events, clock);
    customerAdmin = new CustomerAdminService(
      customers,
      audiences,
      versions,
      documents,
      states,
      acceptances,
      new InMemoryRolloutNotifier(),
      new InMemoryAdminAuditRepo(),
      clock,
      recorder,
    );
    const resolved: CustomerSyncConfig = { sourceKey: SOURCE, defaultRoles: [], wonAcceptTypes: [], ...config };
    return new CustomerSyncService(source, resolved, customers, documents, versions, clock, customerAdmin, recorder);
  };

  /** Seeds an audience + a published document/version for (type, audience). Returns the version. */
  const seedPublished = async (type: string, audience: string) => {
    if (!(await audiences.findByKey(audience))) {
      await audiences.save(anAudience({ id: `aud-${audience}`, key: audience, name: audience }));
    }
    const doc = aDocument({ id: `doc-${type}-${audience}`, type, audience, name: `${type} — ${audience}` });
    await documents.save(doc);
    return versions.save(aVersion({ id: `v-${type}-${audience}`, documentId: doc.id, contentHash: `sha256:${type}` }));
  };

  const statesOf = async (customerId: string): Promise<CustomerVersionState[]> => states.findByCustomer(customerId);

  const eventsOfType = async (type: DomainEvent['type']): Promise<DomainEvent[]> => {
    const { items } = await events.query({}, 1);
    return items.filter((e) => e.type === type);
  };

  beforeEach(() => {
    customers = new InMemoryCustomerRepo();
    events = new InMemoryEventRepo();
    source = new FakeCustomerSource();
    service = build();
  });

  it('creates a new source customer (source-tagged) and emits CUSTOMER_CREATED as a SYSTEM action', async () => {
    source.setSnapshot({
      customers: [{ externalRef: 'e1', firstName: 'Jane', lastName: 'Doe', companyName: 'Acme', contactEmails: ['a@x.io'] }],
    });

    const result = await service.sync();

    expect(result).toMatchObject({ created: 1, updated: 0, reactivated: 0, deleted: 0, errors: 0 });
    const [created] = await customers.findBySource(SOURCE);
    expect(created).toMatchObject({ externalRef: 'e1', firstName: 'Jane', companyName: 'Acme', source: SOURCE });
    expect(created.deletedAt).toBeUndefined();
    const createdEvents = await eventsOfType('CUSTOMER_CREATED');
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0].actorKind).toBe('SYSTEM');
  });

  it('import-accepts the configured won types on CREATE: create() gets acceptedVersions, and the customer ends up ACCEPTED (no pending) for them while other current documents still roll out', async () => {
    service = build({ defaultRoles: ['customer'], wonAcceptTypes: ['agb', 'avv'] });
    const agb = await seedPublished('agb', 'customer');
    const avv = await seedPublished('avv', 'customer');
    const dpa = await seedPublished('dpa', 'customer'); // NOT in wonAcceptTypes → normal rollout
    const createSpy = jest.spyOn(customerAdmin, 'create');
    source.setSnapshot({ customers: [{ externalRef: 'e1', firstName: 'Jane', contactEmails: ['a@x.io'] }] });

    const result = await service.sync();

    expect(result).toMatchObject({ created: 1, errors: 0 });
    const createInput = createSpy.mock.calls[0][0];
    expect(createInput.acceptedVersions).toEqual([
      { versionId: agb.id, reference: 'metergrid: initial onboarding (won deal)' },
      { versionId: avv.id, reference: 'metergrid: initial onboarding (won deal)' },
    ]);

    const [created] = await customers.findBySource(SOURCE);
    const stateByVersion = new Map((await statesOf(created.id)).map((s) => [s.versionId, s.state]));
    expect(stateByVersion.get(agb.id)).toBe('ACCEPTED');
    expect(stateByVersion.get(avv.id)).toBe('ACCEPTED');
    // The non-won document still rolls out normally (pending, and a rollout notification would be sent).
    expect(stateByVersion.get(dpa.id)).toBe('PENDING_NOTIFICATION');
  });

  it('does NOT import-accept when wonAcceptTypes is empty: create() gets no acceptedVersions and the customer is pending for the current document', async () => {
    service = build({ defaultRoles: ['customer'], wonAcceptTypes: [] });
    const agb = await seedPublished('agb', 'customer');
    const createSpy = jest.spyOn(customerAdmin, 'create');
    source.setSnapshot({ customers: [{ externalRef: 'e1', firstName: 'Jane', contactEmails: ['a@x.io'] }] });

    await service.sync();

    expect(createSpy.mock.calls[0][0].acceptedVersions).toEqual([]);
    const [created] = await customers.findBySource(SOURCE);
    const [state] = await statesOf(created.id);
    expect(state.versionId).toBe(agb.id);
    expect(state.state).toBe('PENDING_NOTIFICATION'); // normal pending rollout, not accepted
  });

  it('never re-imports acceptances on UPDATE (create() is not called; no ACCEPTED state added)', async () => {
    service = build({ defaultRoles: ['customer'], wonAcceptTypes: ['agb'] });
    await seedPublished('agb', 'customer');
    await customers.save(aCustomer({ id: 'c-1', externalRef: 'e1', firstName: 'Old', roles: ['customer'], contactEmails: ['a@x.io'], source: SOURCE }));
    const createSpy = jest.spyOn(customerAdmin, 'create');
    source.setSnapshot({ customers: [{ externalRef: 'e1', firstName: 'New', contactEmails: ['a@x.io'] }] });

    const result = await service.sync();

    expect(result).toMatchObject({ updated: 1, created: 0 });
    expect(createSpy).not.toHaveBeenCalled();
    expect(await statesOf('c-1')).toHaveLength(0); // no import acceptance on update
  });

  it('never re-imports acceptances on REACTIVATION (create() is not called; no ACCEPTED state added)', async () => {
    service = build({ defaultRoles: ['customer'], wonAcceptTypes: ['agb'] });
    await seedPublished('agb', 'customer');
    await customers.save(
      aCustomer({ id: 'c-1', externalRef: 'e1', firstName: 'Old', roles: ['customer'], contactEmails: ['a@x.io'], source: SOURCE, deletedAt: new Date('2026-07-01T00:00:00Z') }),
    );
    const createSpy = jest.spyOn(customerAdmin, 'create');
    source.setSnapshot({ customers: [{ externalRef: 'e1', firstName: 'New', contactEmails: ['a@x.io'] }] });

    const result = await service.sync();

    expect(result).toMatchObject({ reactivated: 1, created: 0 });
    expect(createSpy).not.toHaveBeenCalled();
    expect(await statesOf('c-1')).toHaveLength(0); // reactivation keeps existing history, imports nothing
  });

  it('updates ONLY when an identity field changed, emitting CUSTOMER_UPDATED; a second sync is a no-op (idempotent)', async () => {
    await customers.save(aCustomer({ id: 'c-1', externalRef: 'e1', firstName: 'Old', lastName: 'Doe', companyName: 'Acme', contactEmails: ['a@x.io'], roles: [], source: SOURCE }));
    source.setSnapshot({
      customers: [{ externalRef: 'e1', firstName: 'New', lastName: 'Doe', companyName: 'Acme', contactEmails: ['a@x.io'] }],
    });

    const first = await service.sync();
    expect(first).toMatchObject({ updated: 1, created: 0, deleted: 0 });
    expect((await customers.findById('c-1'))?.firstName).toBe('New');
    expect(await eventsOfType('CUSTOMER_UPDATED')).toHaveLength(1);

    // Second run with identical data: nothing changes, no new event.
    const second = await service.sync();
    expect(second).toMatchObject({ created: 0, updated: 0, reactivated: 0, deleted: 0 });
    expect(await eventsOfType('CUSTOMER_UPDATED')).toHaveLength(1);
  });

  it('is fully idempotent for an unchanged snapshot (zero writes, zero events)', async () => {
    await customers.save(aCustomer({ id: 'c-1', externalRef: 'e1', firstName: 'Jane', lastName: 'Doe', companyName: 'Acme', contactEmails: ['a@x.io'], roles: [], source: SOURCE }));
    source.setSnapshot({
      customers: [{ externalRef: 'e1', firstName: 'Jane', lastName: 'Doe', companyName: 'Acme', contactEmails: ['a@x.io'] }],
    });

    const result = await service.sync();
    expect(result).toEqual({ created: 0, updated: 0, reactivated: 0, deleted: 0, errors: 0 });
    const { total } = await events.query({}, 1);
    expect(total).toBe(0);
  });

  it('soft-deletes a source customer that disappeared, emitting CUSTOMER_DELETED and preserving the row', async () => {
    await customers.save(aCustomer({ id: 'c-1', externalRef: 'e1', roles: [], source: SOURCE }));
    source.setSnapshot({ customers: [] });

    const result = await service.sync();

    expect(result).toMatchObject({ deleted: 1 });
    const deleted = await customers.findById('c-1');
    expect(deleted?.deletedAt).toEqual(T0);
    expect(deleted?.externalRef).toBe('e1'); // row (evidence chain) preserved
    const deletedEvents = await eventsOfType('CUSTOMER_DELETED');
    expect(deletedEvents).toHaveLength(1);
    expect(deletedEvents[0].actorKind).toBe('SYSTEM');
    expect(deletedEvents[0].category).toBe('ADMINISTRATION');
  });

  it('never touches a manual (source=manual) customer, even when absent from the snapshot', async () => {
    await customers.save(aCustomer({ id: 'c-manual', externalRef: 'm1', roles: ['customer'], source: 'manual' }));
    source.setSnapshot({ customers: [] });

    const result = await service.sync();

    expect(result).toEqual({ created: 0, updated: 0, reactivated: 0, deleted: 0, errors: 0 });
    expect((await customers.findById('c-manual'))?.deletedAt).toBeUndefined();
    expect(await eventsOfType('CUSTOMER_DELETED')).toHaveLength(0);
  });

  it('reactivates a soft-deleted customer that reappears (clears deletedAt, updates fields, CUSTOMER_UPDATED)', async () => {
    await customers.save(
      aCustomer({ id: 'c-1', externalRef: 'e1', firstName: 'Old', roles: [], source: SOURCE, deletedAt: new Date('2026-07-01T00:00:00Z') }),
    );
    source.setSnapshot({ customers: [{ externalRef: 'e1', firstName: 'New', lastName: 'Doe', contactEmails: ['a@x.io'] }] });

    const result = await service.sync();

    expect(result).toMatchObject({ reactivated: 1, deleted: 0, created: 0 });
    const reactivated = await customers.findById('c-1');
    expect(reactivated?.deletedAt).toBeUndefined();
    expect(reactivated?.firstName).toBe('New');
    expect(await eventsOfType('CUSTOMER_UPDATED')).toHaveLength(1);
  });

  it('honours explicit deletedExternalRefs (soft-deletes even a ref still present in customers)', async () => {
    await customers.save(aCustomer({ id: 'c-1', externalRef: 'e1', firstName: 'Jane', lastName: 'Doe', companyName: 'Acme', contactEmails: ['a@x.io'], roles: [], source: SOURCE }));
    await customers.save(aCustomer({ id: 'c-2', externalRef: 'e2', roles: [], source: SOURCE }));
    source.setSnapshot({
      customers: [{ externalRef: 'e1', firstName: 'Jane', lastName: 'Doe', companyName: 'Acme', contactEmails: ['a@x.io'] }],
      deletedExternalRefs: ['e2'],
    });

    const result = await service.sync();

    expect(result).toMatchObject({ deleted: 1, updated: 0, created: 0 });
    expect((await customers.findById('c-2'))?.deletedAt).toEqual(T0);
    expect((await customers.findById('c-1'))?.deletedAt).toBeUndefined();
  });

  it('isolates per-record errors: one bad record is skipped, the rest still processed', async () => {
    source.setSnapshot({
      customers: [
        { externalRef: 'bad', contactEmails: ['not-an-email'] }, // create() rejects the invalid e-mail
        { externalRef: 'good', firstName: 'Ok', contactEmails: ['ok@x.io'] },
      ],
    });

    const result = await service.sync();

    expect(result).toMatchObject({ created: 1, errors: 1 });
    expect((await customers.findBySource(SOURCE)).map((c) => c.externalRef)).toEqual(['good']);
  });

  it('is a full no-op for the disabled `none` source, even if the snapshot has customers', async () => {
    const noneService = build({ sourceKey: 'none' });
    source.setSnapshot({ customers: [{ externalRef: 'e1', contactEmails: [] }] });

    const result = await noneService.sync();

    expect(result).toEqual({ created: 0, updated: 0, reactivated: 0, deleted: 0, errors: 0 });
    expect(await customers.findAll()).toHaveLength(0);
  });
});
