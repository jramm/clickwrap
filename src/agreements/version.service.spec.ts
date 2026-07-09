import { DomainError } from '../common/errors';
import { FixedClock } from '../domain/clock';
import { InMemoryAgreementDocumentRepo, InMemoryAgreementVersionRepo, InMemoryEventRepo } from '../persistence/inmemory';
import { EventRecorder } from '../events/event-recorder';
import { InMemoryPdfStorage } from './pdf-storage.inmemory';
import { VersionService, type CreateDraftInput } from './version.service';

const expectCode = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code });
};

const draftInput = (overrides: Partial<CreateDraftInput> = {}): CreateDraftInput => ({
  documentId: 'doc-1',
  versionLabel: 'June 2026 edition',
  changeSummary: 'New sub-processor.',
  acceptanceMode: 'ACTIVE',
  consentText: 'I agree.',
  hardDeadlineAt: new Date('2026-07-15T00:00:00Z'),
  validFrom: new Date('2026-07-01T00:00:00Z'),
  file: { buffer: Buffer.from('%PDF-1.7 test'), fileName: 'dpa.pdf' },
  ...overrides,
});

describe('VersionService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let pdf: InMemoryPdfStorage;
  let events: InMemoryEventRepo;
  let service: VersionService;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    pdf = new InMemoryPdfStorage();
    events = new InMemoryEventRepo();
    service = new VersionService(versions, documents, pdf, new EventRecorder(events, new FixedClock(new Date('2026-07-07T09:00:00Z')), versions, documents));
    await documents.save({ id: 'doc-1', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
  });

  describe('createDraft', () => {
    it('creates a DRAFT version, stores the PDF and sets contentHash (sha256 over the buffer)', async () => {
      const version = await service.createDraft(draftInput());
      expect(version.status).toBe('DRAFT');
      expect(version.id).toMatch(/^v-/);
      expect(version.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(version.fileName).toBe('dpa.pdf');
      expect(version.fileSize).toBe(Buffer.from('%PDF-1.7 test').length);
      await expect(pdf.getPresignedUrl(version.storageKey)).resolves.toContain('expires=900');
    });

    it('unknown document → INVALID_STATE', async () => {
      await expectCode(service.createDraft(draftInput({ documentId: 'doc-unknown' })), 'INVALID_STATE');
    });

    it('records a VERSION_DRAFT_CREATED event (ADMINISTRATION, ADMIN) with the resolved documentType', async () => {
      const version = await service.createDraft(draftInput(), 'admin-3');

      const { items } = await events.query({});
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'VERSION_DRAFT_CREATED',
        category: 'ADMINISTRATION',
        actorKind: 'ADMIN',
        actorLabel: 'admin-3',
        versionId: version.id,
        documentType: 'dpa',
        audience: 'customer',
        versionLabel: 'June 2026 edition',
      });
    });

    it('records NO event when creation fails (unknown document)', async () => {
      await expectCode(service.createDraft(draftInput({ documentId: 'doc-unknown' })), 'INVALID_STATE');
      expect((await events.query({})).total).toBe(0);
    });
  });

  describe('patchDraft', () => {
    it('changes metadata of a DRAFT', async () => {
      const version = await service.createDraft(draftInput());
      const patched = await service.patchDraft(version.id, { versionLabel: 'July 2026 edition' });
      expect(patched.versionLabel).toBe('July 2026 edition');
    });

    it('replaces the PDF and updates contentHash', async () => {
      const version = await service.createDraft(draftInput());
      const patched = await service.patchDraft(version.id, {}, { buffer: Buffer.from('different'), fileName: 'new.pdf' });
      expect(patched.fileName).toBe('new.pdf');
      expect(patched.contentHash).not.toBe(version.contentHash);
    });

    it('PATCH on PUBLISHED → VERSION_IMMUTABLE', async () => {
      const version = await service.createDraft(draftInput());
      await versions.save({ ...version, status: 'PUBLISHED' });
      await expectCode(service.patchDraft(version.id, { versionLabel: 'x' }), 'VERSION_IMMUTABLE');
    });

    it('PATCH on RETIRED → VERSION_IMMUTABLE', async () => {
      const version = await service.createDraft(draftInput());
      await versions.save({ ...version, status: 'RETIRED' });
      await expectCode(service.patchDraft(version.id, { versionLabel: 'x' }), 'VERSION_IMMUTABLE');
    });

    it('unknown version → VERSION_NOT_FOUND', async () => {
      await expectCode(service.patchDraft('v-unknown', {}), 'VERSION_NOT_FOUND');
    });

    it('records a VERSION_UPDATED event (ADMINISTRATION, ADMIN) on a successful patch', async () => {
      const version = await service.createDraft(draftInput());
      await service.patchDraft(version.id, { versionLabel: 'July 2026 edition' }, undefined, 'admin-9');

      const updated = (await events.query({})).items.filter((e) => e.type === 'VERSION_UPDATED');
      expect(updated).toHaveLength(1);
      expect(updated[0]).toMatchObject({
        category: 'ADMINISTRATION',
        actorKind: 'ADMIN',
        actorLabel: 'admin-9',
        versionId: version.id,
        versionLabel: 'July 2026 edition',
      });
    });

    it('records NO VERSION_UPDATED when the patch fails (immutable)', async () => {
      const version = await service.createDraft(draftInput());
      await versions.save({ ...version, status: 'PUBLISHED' });
      await expectCode(service.patchDraft(version.id, { versionLabel: 'x' }), 'VERSION_IMMUTABLE');
      expect((await events.query({})).items.filter((e) => e.type === 'VERSION_UPDATED')).toHaveLength(0);
    });
  });

  describe('deleteDraft', () => {
    it('deletes DRAFTs only', async () => {
      const version = await service.createDraft(draftInput());
      await service.deleteDraft(version.id);
      await expectCode(service.getVersion(version.id), 'VERSION_NOT_FOUND');
    });

    it('DELETE on PUBLISHED → VERSION_IMMUTABLE', async () => {
      const version = await service.createDraft(draftInput());
      await versions.save({ ...version, status: 'PUBLISHED' });
      await expectCode(service.deleteDraft(version.id), 'VERSION_IMMUTABLE');
    });

    it('unknown version → VERSION_NOT_FOUND', async () => {
      await expectCode(service.deleteDraft('v-unknown'), 'VERSION_NOT_FOUND');
    });
  });

  describe('getVersion / listByDocument / getPdfUrl', () => {
    it('getVersion returns the version (DRAFT included)', async () => {
      const version = await service.createDraft(draftInput());
      expect((await service.getVersion(version.id)).id).toBe(version.id);
    });

    it('getVersion unknown → VERSION_NOT_FOUND', async () => {
      await expectCode(service.getVersion('v-unknown'), 'VERSION_NOT_FOUND');
    });

    it('listByDocument returns all versions of the document', async () => {
      await service.createDraft(draftInput());
      await service.createDraft(draftInput({ versionLabel: 'May 2026 edition' }));
      expect(await service.listByDocument('doc-1')).toHaveLength(2);
    });

    it('getPdfUrl returns a pre-signed URL', async () => {
      const version = await service.createDraft(draftInput());
      expect(await service.getPdfUrl(version.id)).toContain('expires=900');
    });
  });
});
