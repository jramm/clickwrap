/**
 * Invariant tests against real Postgres — counterpart of
 * src/persistence/inmemory/acceptance-link.repo.spec.ts. Runs only with DATABASE_URL (see
 * agreement-document.repo.prisma.spec.ts for details/invocation).
 */
import { anAcceptanceLink } from '../../domain/testing/fixtures';
import { PrismaAcceptanceLinkRepo } from './acceptance-link.repo';
import { PrismaService } from './prisma.service';
import { resetDatabase } from './testing/reset-database';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('PrismaAcceptanceLinkRepo (against real Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaAcceptanceLinkRepo;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    repo = new PrismaAcceptanceLinkRepo(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('create + findByTokenHash roundtrip (incl. optional fields)', async () => {
    const link = anAcceptanceLink({ id: 'al-1', tokenHash: 'h-1', audienceKey: 'customer' });
    await repo.create(link);
    expect(await repo.findByTokenHash('h-1')).toEqual(link);
    expect(await repo.findByTokenHash('h-unknown')).toBeUndefined();
  });

  it('rejects duplicate tokenHash (unique capability) → INVALID_STATE', async () => {
    await repo.create(anAcceptanceLink({ id: 'al-1', tokenHash: 'h-1' }));
    await expect(repo.create(anAcceptanceLink({ id: 'al-2', tokenHash: 'h-1' }))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INVALID_STATE',
    });
  });

  it('touch sets lastUsedAt; unknown id is a no-op', async () => {
    await repo.create(anAcceptanceLink({ id: 'al-1', tokenHash: 'h-1' }));
    const usedAt = new Date('2026-07-08T10:00:00Z');
    await repo.touch('al-1', usedAt);
    expect((await repo.findByTokenHash('h-1'))?.lastUsedAt).toEqual(usedAt);
    await expect(repo.touch('al-unknown', usedAt)).resolves.toBeUndefined();
  });

  it('revoke is idempotent — the first revocation wins', async () => {
    await repo.create(anAcceptanceLink({ id: 'al-1', tokenHash: 'h-1' }));
    const first = new Date('2026-07-08T10:00:00Z');
    expect((await repo.revoke('al-1', first))?.revokedAt).toEqual(first);
    expect((await repo.revoke('al-1', new Date('2026-07-09T10:00:00Z')))?.revokedAt).toEqual(first);
    expect(await repo.revoke('al-unknown', first)).toBeUndefined();
  });

  it('listByCustomer filters and sorts by createdAt', async () => {
    await repo.create(anAcceptanceLink({ id: 'al-1', tokenHash: 'h-1', customerId: 'c-1' }));
    await repo.create(anAcceptanceLink({ id: 'al-2', tokenHash: 'h-2', customerId: 'c-2' }));
    await repo.create(
      anAcceptanceLink({ id: 'al-3', tokenHash: 'h-3', customerId: 'c-1', createdAt: new Date('2026-07-02T09:00:00Z') }),
    );
    expect((await repo.listByCustomer('c-1')).map((l) => l.id)).toEqual(['al-1', 'al-3']);
  });
});
