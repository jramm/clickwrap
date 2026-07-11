/**
 * Invariant tests against real Postgres — counterpart of
 * src/persistence/inmemory/audience-and-document-type.repo.spec.ts (InMemoryDocumentTypeRepo
 * block). Runs only with DATABASE_URL (see agreement-document.repo.prisma.spec.ts for
 * details/invocation).
 *
 * Main purpose: verify that the `key @unique` constraint on the DocumentTypeDef table is
 * enforced by the real DB (P2002 → INVALID_STATE) and that the application-level reference
 * check of `deleteIfUnused` (AgreementDocument.type) holds against real rows.
 */
import { aDocument, aDocumentTypeDef } from '../../domain/testing/fixtures.js';
import { PrismaAgreementDocumentRepo } from './agreement-document.repo.js';
import { PrismaDocumentTypeRepo } from './document-type.repo.js';
import { PrismaService } from './prisma.service.js';
import { resetDatabase } from './testing/reset-database.js';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('PrismaDocumentTypeRepo (against real Postgres)', () => {
  let prisma: PrismaService;
  let documents: PrismaAgreementDocumentRepo;
  let repo: PrismaDocumentTypeRepo;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    documents = new PrismaAgreementDocumentRepo(prisma);
    repo = new PrismaDocumentTypeRepo(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('save + findByKey roundtrip', async () => {
    await repo.save(aDocumentTypeDef({ id: 'dt-1', key: 'terms', name: 'Terms of Service' }));
    // Assert against the fixture (not a hand-written partial) so new DocumentTypeDef fields —
    // e.g. `external` (Wave D) and the per-type template assignments — can't leave this stale.
    expect(await repo.findByKey('terms')).toEqual(aDocumentTypeDef({ id: 'dt-1', key: 'terms', name: 'Terms of Service' }));
    expect(await repo.findByKey('unknown')).toBeUndefined();
  });

  it('save is an upsert by id (rename keeps the same entity)', async () => {
    await repo.save(aDocumentTypeDef({ id: 'dt-1', key: 'dpa', name: 'Data Processing Agreement' }));
    await repo.save(aDocumentTypeDef({ id: 'dt-1', key: 'dpa', name: 'DPA' }));

    expect(await repo.findAll()).toHaveLength(1);
    expect((await repo.findByKey('dpa'))?.name).toBe('DPA');
  });

  it('duplicate key on a different id → DB unique constraint (P2002) → INVALID_STATE', async () => {
    await repo.save(aDocumentTypeDef({ id: 'dt-1', key: 'terms' }));
    await expect(repo.save(aDocumentTypeDef({ id: 'dt-2', key: 'terms' }))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INVALID_STATE',
    });
  });

  it('invalid slug key → INVALID_STATE (validated before hitting the DB)', async () => {
    await expect(repo.save(aDocumentTypeDef({ key: 'NOT A SLUG' }))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INVALID_STATE',
    });
  });

  it('findAll lists all document types', async () => {
    await repo.save(aDocumentTypeDef({ id: 'dt-1', key: 'terms', name: 'Terms of Service' }));
    await repo.save(aDocumentTypeDef({ id: 'dt-2', key: 'dpa' }));

    expect((await repo.findAll()).map((t) => t.key).sort()).toEqual(['dpa', 'terms']);
  });

  describe('deleteIfUnused', () => {
    it('deletes an unreferenced document type and reports true', async () => {
      await repo.save(aDocumentTypeDef({ key: 'terms' }));
      expect(await repo.deleteIfUnused('terms')).toBe(true);
      expect(await repo.findByKey('terms')).toBeUndefined();
    });

    it('returns false for an unknown key', async () => {
      expect(await repo.deleteIfUnused('ghost')).toBe(false);
    });

    it('keeps a document type referenced by a document (AgreementDocument.type)', async () => {
      await repo.save(aDocumentTypeDef({ key: 'dpa' }));
      await documents.save(aDocument({ type: 'dpa' }));

      expect(await repo.deleteIfUnused('dpa')).toBe(false);
      expect(await repo.findByKey('dpa')).toBeDefined();
    });
  });
});
