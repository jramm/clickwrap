/**
 * Invariant tests against real Postgres — counterpart of
 * src/persistence/inmemory/agreement-version.repo.spec.ts. Runs only with DATABASE_URL
 * (see agreement-document.repo.prisma.spec.ts for details/invocation).
 */
import { aDocument, aVersion } from '../../domain/testing/fixtures.js';
import { AgreementDocumentRepo } from '../../domain/ports.js';
import { PrismaAgreementDocumentRepo } from './agreement-document.repo.js';
import { PrismaAgreementVersionRepo } from './agreement-version.repo.js';
import { PrismaService } from './prisma.service.js';
import { resetDatabase } from './testing/reset-database.js';

const NOW = new Date('2026-07-07T09:00:00Z');
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('PrismaAgreementVersionRepo (against real Postgres)', () => {
  let prisma: PrismaService;
  let documents: AgreementDocumentRepo;
  let repo: PrismaAgreementVersionRepo;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    documents = new PrismaAgreementDocumentRepo(prisma);
    repo = new PrismaAgreementVersionRepo(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await documents.save(aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' }));
    await documents.save(aDocument({ id: 'doc-dpa-p', type: 'dpa', audience: 'partner' }));
  });

  describe('findCurrentPublished — newest PUBLISHED version with validFrom <= now (hot path)', () => {
    it('picks the newest applicable PUBLISHED version of the matching (type, audience)', async () => {
      await repo.save(aVersion({ id: 'v-old', documentId: 'doc-dpa-c', status: 'RETIRED', validFrom: new Date('2025-01-01') }));
      await repo.save(aVersion({ id: 'v-april', documentId: 'doc-dpa-c', validFrom: new Date('2026-04-01') }));
      await repo.save(aVersion({ id: 'v-june', documentId: 'doc-dpa-c', validFrom: new Date('2026-06-01') }));

      expect((await repo.findCurrentPublished('dpa', 'customer', NOW))?.id).toBe('v-june');
    });

    it('ignores DRAFT/RETIRED versions and versions with validFrom in the future', async () => {
      await repo.save(aVersion({ id: 'v-pub', documentId: 'doc-dpa-c', validFrom: new Date('2026-04-01') }));
      await repo.save(aVersion({ id: 'v-draft', documentId: 'doc-dpa-c', status: 'DRAFT', validFrom: new Date('2026-06-01') }));
      await repo.save(aVersion({ id: 'v-retired', documentId: 'doc-dpa-c', status: 'RETIRED', validFrom: new Date('2026-05-01') }));
      await repo.save(aVersion({ id: 'v-future', documentId: 'doc-dpa-c', validFrom: new Date('2026-09-01') }));

      expect((await repo.findCurrentPublished('dpa', 'customer', NOW))?.id).toBe('v-pub');
    });

    it('separates audiences: partner versions do not count for customers', async () => {
      await repo.save(aVersion({ id: 'v-partner', documentId: 'doc-dpa-p', validFrom: new Date('2026-06-01') }));

      expect(await repo.findCurrentPublished('dpa', 'customer', NOW)).toBeUndefined();
      expect((await repo.findCurrentPublished('dpa', 'partner', NOW))?.id).toBe('v-partner');
    });

    it('compliance baseline flips at validFrom: both PUBLISHED — old current before the flip, new one after', async () => {
      await repo.save(aVersion({ id: 'v-old', documentId: 'doc-dpa-c', validFrom: new Date('2026-06-01'), publishedAt: new Date('2026-06-01') }));
      await repo.save(aVersion({ id: 'v-next', documentId: 'doc-dpa-c', validFrom: new Date('2026-08-01'), publishedAt: NOW }));

      expect((await repo.findCurrentPublished('dpa', 'customer', NOW))?.id).toBe('v-old');
      expect((await repo.findCurrentPublished('dpa', 'customer', new Date('2026-08-01T00:00:00Z')))?.id).toBe('v-next');
    });
  });

  describe('findUpcomingPublishedList — ALL PUBLISHED versions with validFrom > now (validFrom asc)', () => {
    it('returns every upcoming published version ordered by validFrom asc, ignoring drafts', async () => {
      await repo.save(aVersion({ id: 'v-now', documentId: 'doc-dpa-c', validFrom: new Date('2026-06-01') }));
      await repo.save(aVersion({ id: 'v-aug', documentId: 'doc-dpa-c', validFrom: new Date('2026-08-01') }));
      await repo.save(aVersion({ id: 'v-sep', documentId: 'doc-dpa-c', validFrom: new Date('2026-09-01') }));
      await repo.save(aVersion({ id: 'v-draft', documentId: 'doc-dpa-c', status: 'DRAFT', validFrom: new Date('2026-07-15') }));

      expect((await repo.findUpcomingPublishedList('dpa', 'customer', NOW)).map((v) => v.id)).toEqual(['v-aug', 'v-sep']);
    });

    it('excludes an effective version and returns [] for unknown (type, audience)', async () => {
      await repo.save(aVersion({ id: 'v-aug', documentId: 'doc-dpa-c', validFrom: new Date('2026-08-01') }));
      await repo.save(aVersion({ id: 'v-sep', documentId: 'doc-dpa-c', validFrom: new Date('2026-09-01') }));

      expect((await repo.findUpcomingPublishedList('dpa', 'customer', new Date('2026-08-01T00:00:00Z'))).map((v) => v.id)).toEqual(['v-sep']);
      expect(await repo.findUpcomingPublishedList('terms', 'customer', NOW)).toEqual([]);
    });
  });

  describe('delete — only DRAFTs may be deleted', () => {
    it('deletes a DRAFT', async () => {
      await repo.save(aVersion({ id: 'v-draft', documentId: 'doc-dpa-c', status: 'DRAFT' }));
      await repo.delete('v-draft');
      expect(await repo.findById('v-draft')).toBeUndefined();
    });

    it('PUBLISHED → VERSION_IMMUTABLE', async () => {
      await repo.save(aVersion({ id: 'v-pub', documentId: 'doc-dpa-c', status: 'PUBLISHED' }));
      await expect(repo.delete('v-pub')).rejects.toMatchObject({ name: 'DomainError', code: 'VERSION_IMMUTABLE' });
    });

    it('unknown id → VERSION_NOT_FOUND', async () => {
      await expect(repo.delete('missing')).rejects.toMatchObject({ name: 'DomainError', code: 'VERSION_NOT_FOUND' });
    });
  });

  it('save throws a DomainError when the document does not exist (FK constraint on documentId, aggregate consistency)', async () => {
    await expect(repo.save(aVersion({ documentId: 'doc-unknown' }))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INVALID_STATE',
    });
  });
});
