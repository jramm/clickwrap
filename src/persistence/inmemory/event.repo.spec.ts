import { DomainError } from '../../common/errors';
import { anEvent } from '../../domain/testing/fixtures';
import { InMemoryEventRepo } from './event.repo';

const at = (iso: string) => new Date(iso);

describe('InMemoryEventRepo', () => {
  let repo: InMemoryEventRepo;

  beforeEach(() => {
    repo = new InMemoryEventRepo();
  });

  it('appends and returns a copy (no shared references)', async () => {
    const event = anEvent({ id: 'evt-1', metadata: { method: 'ACTIVE_CONSENT' } });
    const saved = await repo.append(event);
    expect(saved).toEqual(event);
    event.metadata!.method = 'MUTATED';
    const { items } = await repo.query({});
    expect(items[0].metadata).toEqual({ method: 'ACTIVE_CONSENT' });
  });

  it('rejects a duplicate id (append-only)', async () => {
    await repo.append(anEvent({ id: 'evt-dup' }));
    await expect(repo.append(anEvent({ id: 'evt-dup' }))).rejects.toThrow(DomainError);
  });

  it('sorts occurredAt DESC with a stable id tiebreak on equal timestamps', async () => {
    const ts = at('2026-07-05T00:00:00Z');
    await repo.append(anEvent({ id: 'evt-b', occurredAt: ts }));
    await repo.append(anEvent({ id: 'evt-a', occurredAt: ts }));
    await repo.append(anEvent({ id: 'evt-newest', occurredAt: at('2026-07-06T00:00:00Z') }));
    const { items } = await repo.query({});
    expect(items.map((e) => e.id)).toEqual(['evt-newest', 'evt-a', 'evt-b']);
  });

  it('filters by customerId, category, documentType and versionId (AND, filtered total)', async () => {
    await repo.append(anEvent({ id: 'evt-1', customerId: 'c-1', category: 'CONSENT', documentType: 'dpa', versionId: 'v-1' }));
    await repo.append(anEvent({ id: 'evt-2', customerId: 'c-2', category: 'ADMINISTRATION', documentType: 'terms', versionId: 'v-2' }));
    await repo.append(anEvent({ id: 'evt-3', customerId: 'c-1', category: 'ACCESS', documentType: 'terms', versionId: 'v-2' }));

    expect((await repo.query({ customerId: 'c-1' })).items.map((e) => e.id).sort()).toEqual(['evt-1', 'evt-3']);
    expect((await repo.query({ category: 'ADMINISTRATION' })).items.map((e) => e.id)).toEqual(['evt-2']);
    expect((await repo.query({ documentType: 'terms' })).items.map((e) => e.id).sort()).toEqual(['evt-2', 'evt-3']);
    expect((await repo.query({ versionId: 'v-2' })).items.map((e) => e.id).sort()).toEqual(['evt-2', 'evt-3']);
    const combined = await repo.query({ customerId: 'c-1', documentType: 'terms' });
    expect(combined.items.map((e) => e.id)).toEqual(['evt-3']);
    expect(combined.total).toBe(1);
  });

  it('filters the date range inclusively (from/to)', async () => {
    await repo.append(anEvent({ id: 'evt-6', occurredAt: at('2026-07-06T12:00:00Z') }));
    await repo.append(anEvent({ id: 'evt-7', occurredAt: at('2026-07-07T12:00:00Z') }));
    await repo.append(anEvent({ id: 'evt-8', occurredAt: at('2026-07-08T12:00:00Z') }));

    const range = await repo.query({ from: at('2026-07-07T00:00:00Z'), to: at('2026-07-07T23:59:59.999Z') });
    expect(range.items.map((e) => e.id)).toEqual(['evt-7']);

    const inclusive = await repo.query({ from: at('2026-07-06T12:00:00Z'), to: at('2026-07-08T12:00:00Z') });
    expect(inclusive.items.map((e) => e.id).sort()).toEqual(['evt-6', 'evt-7', 'evt-8']);
  });

  it('paginates 50/page and total is the filtered (not the page) count', async () => {
    for (let i = 0; i < 55; i += 1) {
      await repo.append(anEvent({ id: `evt-${String(i).padStart(3, '0')}`, occurredAt: new Date(2026, 6, 1, 0, 0, i) }));
    }
    const page1 = await repo.query({}, 1);
    const page2 = await repo.query({}, 2);
    expect(page1.total).toBe(55);
    expect(page1.items).toHaveLength(50);
    expect(page2.total).toBe(55);
    expect(page2.items).toHaveLength(5);
    // Page 1 is the newest 50; the two pages do not overlap.
    expect(page1.items[0].id).toBe('evt-054');
  });
});
