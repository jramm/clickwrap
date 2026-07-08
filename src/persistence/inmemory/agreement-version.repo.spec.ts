import { DomainError } from '../../common/errors';
import { aDocument, aVersion } from '../../domain/testing/fixtures';
import { InMemoryAgreementDocumentRepo } from './agreement-document.repo';
import { InMemoryAgreementVersionRepo } from './agreement-version.repo';

const NOW = new Date('2026-07-07T09:00:00Z');

describe('InMemoryAgreementVersionRepo', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let repo: InMemoryAgreementVersionRepo;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    repo = new InMemoryAgreementVersionRepo(documents);
    await documents.save(aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' }));
    await documents.save(aDocument({ id: 'doc-dpa-p', type: 'dpa', audience: 'partner' }));
  });

  describe('findCurrentPublished — newest PUBLISHED version with validFrom <= now', () => {
    it('picks the newest applicable PUBLISHED version of the matching (type, audience)', async () => {
      await repo.save(aVersion({ id: 'v-old', documentId: 'doc-dpa-c', status: 'RETIRED', validFrom: new Date('2025-01-01') }));
      await repo.save(aVersion({ id: 'v-april', documentId: 'doc-dpa-c', validFrom: new Date('2026-04-01') }));
      await repo.save(aVersion({ id: 'v-june', documentId: 'doc-dpa-c', validFrom: new Date('2026-06-01') }));
      expect((await repo.findCurrentPublished('dpa', 'customer', NOW))?.id).toBe('v-june');
    });

    it('ignores DRAFT and RETIRED versions', async () => {
      await repo.save(aVersion({ id: 'v-pub', documentId: 'doc-dpa-c', validFrom: new Date('2026-04-01') }));
      await repo.save(aVersion({ id: 'v-draft', documentId: 'doc-dpa-c', status: 'DRAFT', validFrom: new Date('2026-06-01') }));
      await repo.save(aVersion({ id: 'v-retired', documentId: 'doc-dpa-c', status: 'RETIRED', validFrom: new Date('2026-05-01') }));
      expect((await repo.findCurrentPublished('dpa', 'customer', NOW))?.id).toBe('v-pub');
    });

    it('ignores versions with validFrom in the future', async () => {
      await repo.save(aVersion({ id: 'v-now', documentId: 'doc-dpa-c', validFrom: new Date('2026-06-01') }));
      await repo.save(aVersion({ id: 'v-future', documentId: 'doc-dpa-c', validFrom: new Date('2026-09-01') }));
      expect((await repo.findCurrentPublished('dpa', 'customer', NOW))?.id).toBe('v-now');
    });

    it('separates audiences: partner versions do not count for customers', async () => {
      await repo.save(aVersion({ id: 'v-partner', documentId: 'doc-dpa-p', validFrom: new Date('2026-06-01') }));
      expect(await repo.findCurrentPublished('dpa', 'customer', NOW)).toBeUndefined();
      expect((await repo.findCurrentPublished('dpa', 'partner', NOW))?.id).toBe('v-partner');
    });

    it('returns undefined when no document or no applicable version exists', async () => {
      expect(await repo.findCurrentPublished('terms', 'customer', NOW)).toBeUndefined();
    });

    it('compliance baseline flips at validFrom: with BOTH versions PUBLISHED, the old one is current before the flip and the new one after', async () => {
      await repo.save(aVersion({ id: 'v-old', documentId: 'doc-dpa-c', validFrom: new Date('2026-06-01'), publishedAt: new Date('2026-06-01') }));
      await repo.save(aVersion({ id: 'v-next', documentId: 'doc-dpa-c', validFrom: new Date('2026-08-01'), publishedAt: NOW }));

      // Before the flip the predecessor stays the compliance baseline …
      expect((await repo.findCurrentPublished('dpa', 'customer', NOW))?.id).toBe('v-old');
      expect((await repo.findCurrentPublished('dpa', 'customer', new Date('2026-07-31T23:59:59Z')))?.id).toBe('v-old');
      // … and exactly at/after validFrom the upcoming version takes over.
      expect((await repo.findCurrentPublished('dpa', 'customer', new Date('2026-08-01T00:00:00Z')))?.id).toBe('v-next');
      expect((await repo.findCurrentPublished('dpa', 'customer', new Date('2026-09-01T00:00:00Z')))?.id).toBe('v-next');
    });
  });

  describe('findUpcomingPublishedList — ALL PUBLISHED versions with validFrom > now (validFrom asc)', () => {
    it('returns every upcoming published version ordered by validFrom asc (multiple futures)', async () => {
      await repo.save(aVersion({ id: 'v-now', documentId: 'doc-dpa-c', validFrom: new Date('2026-06-01') }));
      await repo.save(aVersion({ id: 'v-aug', documentId: 'doc-dpa-c', validFrom: new Date('2026-08-01') }));
      await repo.save(aVersion({ id: 'v-sep', documentId: 'doc-dpa-c', validFrom: new Date('2026-09-01') }));
      expect((await repo.findUpcomingPublishedList('dpa', 'customer', NOW)).map((v) => v.id)).toEqual(['v-aug', 'v-sep']);
    });

    it('ignores DRAFT and RETIRED versions with future validFrom', async () => {
      await repo.save(aVersion({ id: 'v-draft', documentId: 'doc-dpa-c', status: 'DRAFT', validFrom: new Date('2026-08-01') }));
      await repo.save(aVersion({ id: 'v-retired', documentId: 'doc-dpa-c', status: 'RETIRED', validFrom: new Date('2026-08-01') }));
      expect(await repo.findUpcomingPublishedList('dpa', 'customer', NOW)).toEqual([]);
    });

    it('excludes a version once it has become effective (validFrom <= now)', async () => {
      await repo.save(aVersion({ id: 'v-aug', documentId: 'doc-dpa-c', validFrom: new Date('2026-08-01') }));
      await repo.save(aVersion({ id: 'v-sep', documentId: 'doc-dpa-c', validFrom: new Date('2026-09-01') }));
      expect((await repo.findUpcomingPublishedList('dpa', 'customer', new Date('2026-08-01T00:00:00Z'))).map((v) => v.id)).toEqual(['v-sep']);
    });

    it('returns [] for unknown (type, audience)', async () => {
      expect(await repo.findUpcomingPublishedList('terms', 'customer', NOW)).toEqual([]);
    });
  });

  it('findByDocument returns the version history of the document', async () => {
    await repo.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-c' }));
    await repo.save(aVersion({ id: 'v-2', documentId: 'doc-dpa-c', status: 'DRAFT' }));
    await repo.save(aVersion({ id: 'v-x', documentId: 'doc-dpa-p' }));
    expect((await repo.findByDocument('doc-dpa-c')).map((v) => v.id).sort()).toEqual(['v-1', 'v-2']);
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

  it('returns deep copies: mutating a result does not write back into the store', async () => {
    await repo.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-c' }));
    const found = await repo.findById('v-1');
    if (!found) {
      throw new Error('Version is missing');
    }
    found.changeSummary = 'mutated';
    found.validFrom.setUTCFullYear(1999);
    expect(await repo.findById('v-1')).toMatchObject({
      changeSummary: 'New sub-processor for e-mail delivery.',
      validFrom: new Date('2026-07-01T00:00:00Z'),
    });
  });

  it('save throws a DomainError when the document does not exist (aggregate consistency)', async () => {
    await expect(repo.save(aVersion({ documentId: 'doc-unknown' }))).rejects.toBeInstanceOf(DomainError);
  });
});
