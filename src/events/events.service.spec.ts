import { anEvent } from '../domain/testing/fixtures';
import { InMemoryEventRepo } from '../persistence/inmemory';
import { EventsService } from './events.service';

const setup = () => {
  const events = new InMemoryEventRepo();
  const service = new EventsService(events);
  return { events, service };
};

/** Seed one event per source & category (mirrors the old cross-source fixture, now table-backed). */
const seed = async (events: InMemoryEventRepo) => {
  await events.append(
    anEvent({
      id: 'evt-acc',
      type: 'VERSION_ACCEPTED',
      category: 'CONSENT',
      actorKind: 'CUSTOMER',
      customerId: 'c-123',
      customerName: 'Acme GmbH',
      versionId: 'v-1',
      documentType: 'dpa',
      audience: 'customer',
      channel: 'PORTAL',
      occurredAt: new Date('2026-07-09T14:12:03Z'),
    }),
  );
  await events.append(
    anEvent({
      id: 'evt-obj',
      type: 'OBJECTION_RAISED',
      category: 'CONSENT',
      actorKind: 'CUSTOMER',
      customerId: 'c-456',
      customerName: 'Beta AG',
      versionId: 'v-2',
      documentType: 'terms',
      audience: 'partner',
      channel: 'PORTAL',
      occurredAt: new Date('2026-07-10T10:00:00Z'),
    }),
  );
  await events.append(
    anEvent({
      id: 'evt-email',
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
      occurredAt: new Date('2026-07-07T09:05:11Z'),
    }),
  );
  await events.append(
    anEvent({
      id: 'evt-access',
      type: 'PAGE_ACCESSED',
      category: 'ACCESS',
      actorKind: 'CUSTOMER',
      customerId: 'c-123',
      versionId: 'v-1',
      documentType: 'dpa',
      channel: 'LINK',
      occurredAt: new Date('2026-07-08T11:00:00Z'),
    }),
  );
  await events.append(
    anEvent({
      id: 'evt-block',
      type: 'BLOCK_SUSPENDED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      customerId: 'c-456',
      versionId: 'v-2',
      documentType: 'terms',
      channel: undefined,
      occurredAt: new Date('2026-07-03T09:00:00Z'),
    }),
  );
  await events.append(
    anEvent({
      id: 'evt-cust',
      type: 'CUSTOMER_CREATED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      customerId: 'c-456',
      customerName: 'Beta AG',
      versionId: undefined,
      documentType: undefined,
      channel: undefined,
      occurredAt: new Date('2026-06-30T09:00:00Z'),
    }),
  );
};

describe('EventsService (table-backed)', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(async () => {
    ctx = setup();
    await seed(ctx.events);
  });

  it('maps a DomainEvent to the EventView shape with an ISO occurredAt', async () => {
    const { items } = await ctx.service.list({ customerId: 'c-123', category: 'CONSENT' });
    expect(items[0]).toMatchObject({
      id: 'evt-acc',
      type: 'VERSION_ACCEPTED',
      category: 'CONSENT',
      actorKind: 'CUSTOMER',
      customerId: 'c-123',
      customerName: 'Acme GmbH',
      versionId: 'v-1',
      documentType: 'dpa',
      audience: 'customer',
      channel: 'PORTAL',
      occurredAt: '2026-07-09T14:12:03.000Z',
    });
  });

  it('sorts occurredAt DESC across categories (newest first)', async () => {
    const { items } = await ctx.service.list();
    const times = items.map((e) => e.occurredAt);
    expect(times).toEqual([...times].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
    expect(items[0].id).toBe('evt-obj');
    expect(items[items.length - 1].id).toBe('evt-cust');
  });

  it('customerId filter keeps only that customer and total reflects the filtered count', async () => {
    const { items, total } = await ctx.service.list({ customerId: 'c-456' });
    expect(items.every((e) => e.customerId === 'c-456')).toBe(true);
    expect(total).toBe(items.length);
    expect(items.map((e) => e.id).sort()).toEqual(['evt-block', 'evt-cust', 'evt-obj']);
  });

  it('category filter keeps only matching events', async () => {
    const consent = await ctx.service.list({ category: 'CONSENT' });
    expect(consent.items.map((e) => e.id).sort()).toEqual(['evt-acc', 'evt-obj']);
    const access = await ctx.service.list({ category: 'ACCESS' });
    expect(access.items.map((e) => e.id)).toEqual(['evt-access']);
  });

  it('documentType and versionId filters narrow the list', async () => {
    const byDoc = await ctx.service.list({ documentType: 'terms' });
    expect(byDoc.items.every((e) => e.documentType === 'terms')).toBe(true);
    expect(byDoc.items.map((e) => e.id).sort()).toEqual(['evt-block', 'evt-obj']);
    const byVersion = await ctx.service.list({ versionId: 'v-2' });
    expect(byVersion.items.every((e) => e.versionId === 'v-2')).toBe(true);
  });

  it('from/to range filters inclusively; a single date-only day matches events on that day (to = end-of-day)', async () => {
    const singleDay = await ctx.service.list({ from: '2026-07-09', to: '2026-07-09' });
    expect(singleDay.items.map((e) => e.id)).toEqual(['evt-acc']);

    const range = await ctx.service.list({ from: '2026-07-07', to: '2026-07-08' });
    expect(range.items.map((e) => e.id).sort()).toEqual(['evt-access', 'evt-email']);
  });

  it('paginates 50/page and total is the filtered (not the page) count', async () => {
    const fresh = setup();
    for (let i = 0; i < 55; i += 1) {
      await fresh.events.append(
        anEvent({ id: `evt-${String(i).padStart(3, '0')}`, occurredAt: new Date(2026, 6, 1, 0, 0, i) }),
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
