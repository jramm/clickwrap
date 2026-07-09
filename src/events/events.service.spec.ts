import { InMemoryAdminAuditRepo, type AdminAuditLog } from '../agreements/audit';
import { aCustomer, aDocument, aNotification, aState, aVersion, anAcceptance, anObjection, testActor } from '../domain/testing/fixtures';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryNotificationEventRepo,
  InMemoryObjectionRepo,
} from '../persistence/inmemory';
import { EventsService, type EventView } from './events.service';

const auditLog = (overrides: Partial<AdminAuditLog> & Pick<AdminAuditLog, 'id' | 'action' | 'targetType' | 'targetId'>): AdminAuditLog => ({
  actor: 'admin-1',
  createdAt: new Date('2026-07-06T09:00:00Z'),
  ...overrides,
});

const setup = () => {
  const documents = new InMemoryAgreementDocumentRepo();
  const versions = new InMemoryAgreementVersionRepo(documents);
  const customers = new InMemoryCustomerRepo();
  const states = new InMemoryCustomerVersionStateRepo();
  const acceptances = new InMemoryAcceptanceRepo();
  const objections = new InMemoryObjectionRepo();
  const notifications = new InMemoryNotificationEventRepo();
  const audit = new InMemoryAdminAuditRepo();
  const service = new EventsService(
    audit,
    acceptances,
    objections,
    notifications,
    customers,
    states,
    versions,
    documents,
  );
  return { documents, versions, customers, states, acceptances, objections, notifications, audit, service };
};

type Ctx = ReturnType<typeof setup>;

/** Seed the standard cross-source fixture set (one event per source & category). */
const seed = async (ctx: Ctx) => {
  await ctx.documents.save(aDocument({ id: 'doc-dpa-customer', type: 'dpa', audience: 'customer' }));
  await ctx.documents.save(aDocument({ id: 'doc-terms-partner', type: 'terms', audience: 'partner', name: 'Terms — Partners' }));
  await ctx.versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-customer', versionLabel: 'June 2026 edition' }));
  await ctx.versions.save(aVersion({ id: 'v-2', documentId: 'doc-terms-partner', versionLabel: 'Terms v2' }));
  await ctx.customers.save(aCustomer({ id: 'c-123', companyName: 'Acme GmbH' }));
  await ctx.customers.save(aCustomer({ id: 'c-456', externalRef: 'crm-456', companyName: 'Beta AG', roles: ['partner'] }));
  await ctx.states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1' }));
  await ctx.states.save(aState({ id: 'cvs-2', customerId: 'c-456', versionId: 'v-2' }));

  // CONSENT — acceptance (customer, portal) + a superseded (corrected) acceptance (admin).
  await ctx.acceptances.append(
    anAcceptance({ id: 'a-1', customerId: 'c-123', versionId: 'v-1', channel: 'PORTAL', acceptedAt: new Date('2026-07-09T14:12:03Z') }),
  );
  await ctx.acceptances.append(
    anAcceptance({
      id: 'a-super',
      customerId: 'c-123',
      versionId: 'v-1',
      channel: 'ADMIN',
      isEffective: false,
      supersededByAcceptanceId: 'a-1',
      actor: testActor({ userId: 'admin-2' }),
      acceptedAt: new Date('2026-07-04T08:00:00Z'),
    }),
  );
  // CONSENT — objection (customer, portal).
  await ctx.objections.append(
    anObjection({ id: 'o-1', customerId: 'c-456', versionId: 'v-2', channel: 'PORTAL', objectedAt: new Date('2026-07-10T10:00:00Z') }),
  );
  // COMMUNICATION — e-mail sent (system).
  await ctx.notifications.append(
    aNotification({ id: 'n-email', customerVersionStateId: 'cvs-1', channel: 'EMAIL', recipient: 'jane@customer.example', occurredAt: new Date('2026-07-07T09:05:11Z') }),
  );
  // ACCESS — hosted acceptance page opened (customer).
  await ctx.notifications.append(
    aNotification({ id: 'n-link', customerVersionStateId: 'cvs-1', channel: 'LINK', recipient: 'u-42', occurredAt: new Date('2026-07-08T11:00:00Z'), providerRef: undefined }),
  );
  // ADMINISTRATION — publish (version-scoped, no customer).
  await ctx.audit.append(auditLog({ id: 'au-pub', action: 'PUBLISH', targetType: 'AgreementVersion', targetId: 'v-1', createdAt: new Date('2026-07-01T09:00:00Z'), metadata: { documentId: 'doc-dpa-customer' } }));
  // ADMINISTRATION — deadline extended vs block suspended (both CUSTOMER_VERSION_STATE_PATCH).
  await ctx.audit.append(auditLog({ id: 'au-deadline', action: 'CUSTOMER_VERSION_STATE_PATCH', targetType: 'CustomerVersionState', targetId: 'cvs-1', reason: 'Customer asked for more time', createdAt: new Date('2026-07-02T09:00:00Z'), metadata: { suspendBlock: false } }));
  await ctx.audit.append(auditLog({ id: 'au-block', action: 'CUSTOMER_VERSION_STATE_PATCH', targetType: 'CustomerVersionState', targetId: 'cvs-2', reason: 'Escalation', createdAt: new Date('2026-07-03T09:00:00Z'), metadata: { suspendBlock: true } }));
  // ADMINISTRATION — reminder (system actor), manual acceptance, customer create.
  await ctx.audit.append(auditLog({ id: 'au-remind', action: 'REMIND', targetType: 'CustomerVersionState', targetId: 'cvs-1', actor: 'system', createdAt: new Date('2026-07-05T09:00:00Z') }));
  await ctx.audit.append(auditLog({ id: 'au-manual', action: 'MANUAL_ACCEPTANCE', targetType: 'Acceptance', targetId: 'acc-x', reason: 'Signed offer', createdAt: new Date('2026-07-05T10:00:00Z'), metadata: { customerId: 'c-123', versionId: 'v-1' } }));
  await ctx.audit.append(auditLog({ id: 'au-cust', action: 'CUSTOMER_CREATE', targetType: 'Customer', targetId: 'c-456', createdAt: new Date('2026-06-30T09:00:00Z') }));
};

const byId = (items: EventView[], id: string): EventView => {
  const found = items.find((e) => e.id === id);
  if (!found) {
    throw new Error(`event ${id} not found`);
  }
  return found;
};

describe('EventsService', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = setup();
    await seed(ctx);
  });

  it('normalizes an acceptance into a CONSENT / VERSION_ACCEPTED / CUSTOMER event with version metadata', async () => {
    const { items } = await ctx.service.list();
    expect(byId(items, 'acc:a-1')).toMatchObject({
      type: 'VERSION_ACCEPTED',
      category: 'CONSENT',
      actorKind: 'CUSTOMER',
      actorLabel: 'Jane Doe',
      customerId: 'c-123',
      customerName: 'Acme GmbH',
      versionId: 'v-1',
      documentType: 'dpa',
      audience: 'customer',
      versionLabel: 'June 2026 edition',
      channel: 'PORTAL',
    });
  });

  it('a superseded (corrected) acceptance still appears, flagged in metadata', async () => {
    const { items } = await ctx.service.list();
    const superseded = byId(items, 'acc:a-super');
    expect(superseded.actorKind).toBe('ADMIN');
    expect(superseded.actorLabel).toBe('admin-2');
    expect(superseded.metadata).toMatchObject({ isEffective: false, supersededByAcceptanceId: 'a-1' });
  });

  it('normalizes an objection into a CONSENT / OBJECTION_RAISED event', async () => {
    const { items } = await ctx.service.list();
    expect(byId(items, 'obj:o-1')).toMatchObject({
      type: 'OBJECTION_RAISED',
      category: 'CONSENT',
      actorKind: 'CUSTOMER',
      customerId: 'c-456',
      versionId: 'v-2',
      documentType: 'terms',
    });
  });

  it('maps NotificationEvent EMAIL → COMMUNICATION/EMAIL_SENT/SYSTEM and resolves customer/version via state', async () => {
    const { items } = await ctx.service.list();
    expect(byId(items, 'notif:n-email')).toMatchObject({
      type: 'EMAIL_SENT',
      category: 'COMMUNICATION',
      actorKind: 'SYSTEM',
      actorLabel: 'system',
      customerId: 'c-123',
      customerName: 'Acme GmbH',
      versionId: 'v-1',
      documentType: 'dpa',
      channel: 'EMAIL',
      recipient: 'jane@customer.example',
    });
  });

  it('maps NotificationEvent LINK/PORTAL → ACCESS/PAGE_ACCESSED/CUSTOMER', async () => {
    const { items } = await ctx.service.list();
    expect(byId(items, 'notif:n-link')).toMatchObject({
      type: 'PAGE_ACCESSED',
      category: 'ACCESS',
      actorKind: 'CUSTOMER',
      customerId: 'c-123',
      channel: 'LINK',
    });
  });

  it('maps PUBLISH audit → ADMINISTRATION/VERSION_PUBLISHED with resolved version metadata', async () => {
    const { items } = await ctx.service.list();
    expect(byId(items, 'audit:au-pub')).toMatchObject({
      type: 'VERSION_PUBLISHED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: 'admin-1',
      versionId: 'v-1',
      documentType: 'dpa',
    });
  });

  it('distinguishes CUSTOMER_VERSION_STATE_PATCH → DEADLINE_EXTENDED vs BLOCK_SUSPENDED via metadata.suspendBlock', async () => {
    const { items } = await ctx.service.list();
    expect(byId(items, 'audit:au-deadline')).toMatchObject({ type: 'DEADLINE_EXTENDED', customerId: 'c-123', versionId: 'v-1' });
    expect(byId(items, 'audit:au-block')).toMatchObject({ type: 'BLOCK_SUSPENDED', customerId: 'c-456', versionId: 'v-2' });
  });

  it('maps REMIND (system actor) → REMINDER_TRIGGERED/SYSTEM and resolves the state customer', async () => {
    const { items } = await ctx.service.list();
    expect(byId(items, 'audit:au-remind')).toMatchObject({ type: 'REMINDER_TRIGGERED', actorKind: 'SYSTEM', customerId: 'c-123' });
  });

  it('resolves MANUAL_ACCEPTANCE customer/version from metadata', async () => {
    const { items } = await ctx.service.list();
    expect(byId(items, 'audit:au-manual')).toMatchObject({ type: 'MANUAL_ACCEPTANCE', customerId: 'c-123', versionId: 'v-1' });
  });

  it('sorts occurredAt DESC across mixed sources', async () => {
    const { items } = await ctx.service.list();
    const times = items.map((e) => e.occurredAt);
    const sorted = [...times].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    expect(times).toEqual(sorted);
    // Newest fixture is the objection (2026-07-10); oldest is the customer create (2026-06-30).
    expect(items[0].id).toBe('obj:o-1');
    expect(items[items.length - 1].id).toBe('audit:au-cust');
  });

  it('customerId filter keeps only that customer and total reflects the filtered count', async () => {
    const { items, total } = await ctx.service.list({ customerId: 'c-456' });
    expect(items.every((e) => e.customerId === 'c-456')).toBe(true);
    expect(total).toBe(items.length);
    expect(items.map((e) => e.id).sort()).toEqual(['audit:au-block', 'audit:au-cust', 'obj:o-1']);
  });

  it('category filter keeps only matching events', async () => {
    const consent = await ctx.service.list({ category: 'CONSENT' });
    expect(consent.items.map((e) => e.id).sort()).toEqual(['acc:a-1', 'acc:a-super', 'obj:o-1']);
    const access = await ctx.service.list({ category: 'ACCESS' });
    expect(access.items.map((e) => e.id)).toEqual(['notif:n-link']);
  });

  it('documentType and versionId filters narrow the list', async () => {
    const byDoc = await ctx.service.list({ documentType: 'terms' });
    expect(byDoc.items.every((e) => e.documentType === 'terms')).toBe(true);
    expect(byDoc.items.map((e) => e.id).sort()).toEqual(['audit:au-block', 'obj:o-1']);
    const byVersion = await ctx.service.list({ versionId: 'v-2' });
    expect(byVersion.items.every((e) => e.versionId === 'v-2')).toBe(true);
  });

  it('from/to range filters inclusively; a single date-only day matches events on that day (to = end-of-day)', async () => {
    // Single day 2026-07-09 must include the acceptance at 14:12 that day.
    const singleDay = await ctx.service.list({ from: '2026-07-09', to: '2026-07-09' });
    expect(singleDay.items.map((e) => e.id)).toEqual(['acc:a-1']);

    const range = await ctx.service.list({ from: '2026-07-07', to: '2026-07-08' });
    expect(range.items.map((e) => e.id).sort()).toEqual(['notif:n-email', 'notif:n-link']);
  });

  it('paginates 50/page and total is the filtered (not the page) count', async () => {
    const fresh = setup();
    await fresh.documents.save(aDocument({ id: 'doc-dpa-customer' }));
    await fresh.versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-customer' }));
    await fresh.customers.save(aCustomer({ id: 'c-123' }));
    for (let i = 0; i < 55; i += 1) {
      await fresh.acceptances.append(
        anAcceptance({
          id: `a-${i}`,
          customerId: 'c-123',
          versionId: 'v-1',
          isEffective: false,
          acceptedAt: new Date(2026, 6, 1, 0, 0, i),
        }),
      );
    }
    const page1 = await fresh.service.list({ page: 1 });
    const page2 = await fresh.service.list({ page: 2 });
    expect(page1.total).toBe(55);
    expect(page1.items).toHaveLength(50);
    expect(page2.total).toBe(55);
    expect(page2.items).toHaveLength(5);
  });
});
