/**
 * Invariant tests against real Postgres — counterpart of
 * src/persistence/inmemory/agreement-document.repo.spec.ts (simple-repos.spec.ts).
 *
 * Runs only when DATABASE_URL is set (no Docker/Postgres in the current environment, see
 * CONVENTIONS.md); excluded from the normal unit run via jest.config.js
 * (testPathIgnorePatterns: /\.prisma\.spec\.ts$/). Invoke as soon as a DB is available:
 *   DATABASE_URL=postgresql://clickwrap:clickwrap@localhost:5432/clickwrap \
 *     pnpm jest --testPathIgnorePatterns=/node_modules/ src/persistence/prisma
 */
import { aDocument } from '../../domain/testing/fixtures';
import { PrismaAgreementDocumentRepo } from './agreement-document.repo';
import { PrismaService } from './prisma.service';
import { resetDatabase } from './testing/reset-database';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('PrismaAgreementDocumentRepo (against real Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaAgreementDocumentRepo;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    repo = new PrismaAgreementDocumentRepo(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('save + findById/findByTypeAndAudience/findAll', async () => {
    await repo.save(aDocument({ id: 'd-1', type: 'dpa', audience: 'customer' }));
    await repo.save(aDocument({ id: 'd-2', type: 'dpa', audience: 'partner' }));

    expect(await repo.findById('d-1')).toMatchObject({ id: 'd-1' });
    expect((await repo.findByTypeAndAudience('dpa', 'partner'))?.id).toBe('d-2');
    expect(await repo.findByTypeAndAudience('terms', 'customer')).toBeUndefined();
    expect(await repo.findAll()).toHaveLength(2);
  });

  it('invariant: exactly one document per (type, audience) — DB unique constraint → INVALID_STATE', async () => {
    await repo.save(aDocument({ id: 'd-1' }));
    await expect(repo.save(aDocument({ id: 'd-2' }))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INVALID_STATE',
    });
  });

  it('save is an upsert by id (saving again with the same id updates instead of duplicating)', async () => {
    await repo.save(aDocument({ id: 'd-1', name: 'Old name' }));
    await repo.save(aDocument({ id: 'd-1', name: 'New name' }));

    expect((await repo.findById('d-1'))?.name).toBe('New name');
    expect(await repo.findAll()).toHaveLength(1);
  });
});
