/**
 * Invariant tests against real Postgres — counterpart of
 * src/persistence/inmemory/event.repo.spec.ts. Runs only with DATABASE_URL (see
 * agreement-document.repo.prisma.spec.ts for details/invocation).
 */
import { anEvent } from '../../domain/testing/fixtures';
import { PrismaEventRepo } from './event.repo';
import { PrismaService } from './prisma.service';
import { resetDatabase } from './testing/reset-database';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const at = (iso: string) => new Date(iso);

describeIfDb('PrismaEventRepo (against real Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaEventRepo;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    repo = new PrismaEventRepo(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('append round-trips every field incl. Json metadata', async () => {
    const event = anEvent({ id: 'evt-1', metadata: { method: 'ACTIVE_CONSENT', isEffective: true } });
    const saved = await repo.append(event);
    expect(saved).toEqual(event);
    const { items } = await repo.query({ customerId: 'c-123' });
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(event);
  });

  it('rejects a duplicate id (append-only, PK violation → INVALID_STATE)', async () => {
    await repo.append(anEvent({ id: 'evt-dup' }));
    await expect(repo.append(anEvent({ id: 'evt-dup' }))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INVALID_STATE',
    });
  });

  it('query sorts occurredAt DESC (stable id tiebreak) and filters by category + date range', async () => {
    const ts = at('2026-07-05T00:00:00Z');
    await repo.append(anEvent({ id: 'evt-b', category: 'CONSENT', occurredAt: ts }));
    await repo.append(anEvent({ id: 'evt-a', category: 'CONSENT', occurredAt: ts }));
    await repo.append(anEvent({ id: 'evt-admin', category: 'ADMINISTRATION', occurredAt: at('2026-07-06T00:00:00Z') }));

    const all = await repo.query({});
    expect(all.items.map((e) => e.id)).toEqual(['evt-admin', 'evt-a', 'evt-b']);

    const consent = await repo.query({ category: 'CONSENT' });
    expect(consent.total).toBe(2);
    expect(consent.items.map((e) => e.id)).toEqual(['evt-a', 'evt-b']);

    const day = await repo.query({ from: at('2026-07-05T00:00:00Z'), to: at('2026-07-05T23:59:59.999Z') });
    expect(day.items.map((e) => e.id)).toEqual(['evt-a', 'evt-b']);
  });

  it('paginates 50/page with the filtered total', async () => {
    for (let i = 0; i < 55; i += 1) {
      await repo.append(anEvent({ id: `evt-${String(i).padStart(3, '0')}`, occurredAt: new Date(2026, 6, 1, 0, 0, i) }));
    }
    const page1 = await repo.query({}, 1);
    const page2 = await repo.query({}, 2);
    expect(page1.total).toBe(55);
    expect(page1.items).toHaveLength(50);
    expect(page2.items).toHaveLength(5);
  });
});
