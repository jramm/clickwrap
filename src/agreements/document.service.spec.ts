import { DomainError } from '../common/errors';
import { FixedClock } from '../domain/clock';
import { aDocumentTypeDef, anAudience, aVersion } from '../domain/testing/fixtures';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryDocumentTypeRepo,
  InMemoryEventRepo,
} from '../persistence/inmemory';
import { EventRecorder } from '../events/event-recorder';
import { DocumentService } from './document.service';
import { InMemoryPdfStorage } from './pdf-storage.inmemory';

const T0 = new Date('2026-07-07T09:00:00Z');

const expectCode = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code });
};

describe('DocumentService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let documentTypes: InMemoryDocumentTypeRepo;
  let audiences: InMemoryAudienceRepo;
  let pdf: InMemoryPdfStorage;
  let events: InMemoryEventRepo;
  let service: DocumentService;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    documentTypes = new InMemoryDocumentTypeRepo(documents);
    audiences = new InMemoryAudienceRepo(documents, new InMemoryCustomerRepo());
    pdf = new InMemoryPdfStorage();
    events = new InMemoryEventRepo();
    await documentTypes.save(aDocumentTypeDef());
    await documentTypes.save(aDocumentTypeDef({ id: 'dt-terms', key: 'terms', name: 'Terms of Service' }));
    await audiences.save(anAudience());
    await audiences.save(anAudience({ id: 'aud-partner', key: 'partner', name: 'Partners' }));
    service = new DocumentService(
      documents,
      versions,
      documentTypes,
      audiences,
      pdf,
      new FixedClock(T0),
      new EventRecorder(events, new FixedClock(T0)),
    );
  });

  describe('create', () => {
    it('creates one document per (type, audience)', async () => {
      const doc = await service.create({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
      expect(doc).toMatchObject({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
      expect(doc.id).toMatch(/^doc-/);
      expect(await documents.findByTypeAndAudience('dpa', 'customer')).toMatchObject({ id: doc.id });
    });

    it('records a DOCUMENT_CREATED event (ADMINISTRATION, ADMIN) on success', async () => {
      const doc = await service.create({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' }, 'admin-7');

      const { items } = await events.query({});
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'DOCUMENT_CREATED',
        category: 'ADMINISTRATION',
        actorKind: 'ADMIN',
        actorLabel: 'admin-7',
        documentType: 'dpa',
        audience: 'customer',
        metadata: { documentId: doc.id },
      });
    });

    it('records NO event when creation fails (duplicate)', async () => {
      await service.create({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
      await expectCode(service.create({ type: 'dpa', audience: 'customer', name: 'dup' }), 'INVALID_STATE');
      expect((await events.query({})).total).toBe(1); // only the first create emitted
    });

    it('allows the same type for another audience', async () => {
      await service.create({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
      const partner = await service.create({ type: 'dpa', audience: 'partner', name: 'DPA — Partners' });
      expect(partner.audience).toBe('partner');
    });

    it('duplicate per (type, audience) → DomainError INVALID_STATE', async () => {
      await service.create({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
      await expectCode(
        service.create({ type: 'dpa', audience: 'customer', name: 'DPA — Customers (2)' }),
        'INVALID_STATE',
      );
    });

    it('unknown document type key → DomainError UNKNOWN_DOCUMENT_TYPE', async () => {
      await expectCode(
        service.create({ type: 'sla', audience: 'customer', name: 'SLA — Customers' }),
        'UNKNOWN_DOCUMENT_TYPE',
      );
    });

    it('external document type → DomainError DOCUMENT_TYPE_EXTERNAL (no versions/documents allowed)', async () => {
      await documentTypes.save(aDocumentTypeDef({ id: 'dt-signed', key: 'signed-offer', name: 'Signed offer', external: true }));
      await expectCode(
        service.create({ type: 'signed-offer', audience: 'customer', name: 'Signed offer — Customers' }),
        'DOCUMENT_TYPE_EXTERNAL',
      );
    });

    it('unknown audience key → DomainError UNKNOWN_AUDIENCE', async () => {
      await expectCode(
        service.create({ type: 'dpa', audience: 'reseller', name: 'DPA — Resellers' }),
        'UNKNOWN_AUDIENCE',
      );
    });
  });

  describe('list', () => {
    it('returns a flat entry { id, type, audience, name, currentVersion } including the current version DTO with pdfUrl', async () => {
      const doc = await service.create({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
      const stored = await pdf.store({ buffer: Buffer.from('%PDF current'), fileName: 'current.pdf' });
      await versions.save(
        aVersion({
          id: 'v-current',
          documentId: doc.id,
          status: 'PUBLISHED',
          storageKey: stored.storageKey,
          validFrom: new Date('2026-07-01T00:00:00Z'),
        }),
      );
      const list = await service.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: doc.id, type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
      expect(list[0].currentVersion?.id).toBe('v-current');
      expect(list[0].currentVersion?.pdfUrl).toContain('expires=900');
      // storageKey must never be exposed.
      expect(list[0].currentVersion).not.toHaveProperty('storageKey');
    });

    it('currentVersion is null when only DRAFTs exist', async () => {
      const doc = await service.create({ type: 'terms', audience: 'partner', name: 'Terms — Partners' });
      await versions.save(aVersion({ id: 'v-draft', documentId: doc.id, status: 'DRAFT' }));
      const list = await service.list();
      expect(list[0].currentVersion).toBeNull();
      expect(list[0].upcomingVersions).toEqual([]);
    });

    it('upcomingVersions carries the next scheduled published version (validFrom in the future) alongside currentVersion', async () => {
      const doc = await service.create({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
      const current = await pdf.store({ buffer: Buffer.from('%PDF current'), fileName: 'current.pdf' });
      const next = await pdf.store({ buffer: Buffer.from('%PDF next'), fileName: 'next.pdf' });
      await versions.save(
        aVersion({ id: 'v-current', documentId: doc.id, storageKey: current.storageKey, validFrom: new Date('2026-07-01T00:00:00Z') }),
      );
      await versions.save(
        aVersion({ id: 'v-next', documentId: doc.id, storageKey: next.storageKey, validFrom: new Date('2026-08-01T00:00:00Z'), publishedAt: T0 }),
      );

      const list = await service.list();

      expect(list[0].currentVersion?.id).toBe('v-current');
      expect(list[0].upcomingVersions.map((v) => v.id)).toEqual(['v-next']);
      expect(list[0].upcomingVersions[0]?.validFrom).toEqual(new Date('2026-08-01T00:00:00Z'));
      expect(list[0].upcomingVersions[0]).not.toHaveProperty('storageKey');
    });

    it('upcomingVersions lists MULTIPLE future scheduled versions ordered by validFrom asc', async () => {
      const doc = await service.create({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
      const current = await pdf.store({ buffer: Buffer.from('%PDF current'), fileName: 'current.pdf' });
      const near = await pdf.store({ buffer: Buffer.from('%PDF near'), fileName: 'near.pdf' });
      const far = await pdf.store({ buffer: Buffer.from('%PDF far'), fileName: 'far.pdf' });
      await versions.save(
        aVersion({ id: 'v-current', documentId: doc.id, storageKey: current.storageKey, validFrom: new Date('2026-07-01T00:00:00Z') }),
      );
      await versions.save(
        aVersion({ id: 'v-far', documentId: doc.id, storageKey: far.storageKey, validFrom: new Date('2026-10-01T00:00:00Z'), publishedAt: T0 }),
      );
      await versions.save(
        aVersion({ id: 'v-near', documentId: doc.id, storageKey: near.storageKey, validFrom: new Date('2026-08-01T00:00:00Z'), publishedAt: T0 }),
      );

      const list = await service.list();

      expect(list[0].currentVersion?.id).toBe('v-current');
      expect(list[0].upcomingVersions.map((v) => v.id)).toEqual(['v-near', 'v-far']);
    });

    describe('latestPdfUrl (stable public link for offers)', () => {
      afterEach(() => {
        delete process.env.PUBLIC_BASE_URL;
      });

      it('is built from PUBLIC_BASE_URL and the document keys when a current published version exists', async () => {
        process.env.PUBLIC_BASE_URL = 'https://clickwrap.example.org/';
        const doc = await service.create({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
        const stored = await pdf.store({ buffer: Buffer.from('%PDF current'), fileName: 'current.pdf' });
        await versions.save(aVersion({ id: 'v-current', documentId: doc.id, storageKey: stored.storageKey }));

        const list = await service.list();

        expect(list[0].latestPdfUrl).toBe('https://clickwrap.example.org/documents/dpa/customer/latest.pdf');
      });

      it('is null when PUBLIC_BASE_URL is unset', async () => {
        const doc = await service.create({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
        const stored = await pdf.store({ buffer: Buffer.from('%PDF current'), fileName: 'current.pdf' });
        await versions.save(aVersion({ id: 'v-current', documentId: doc.id, storageKey: stored.storageKey }));

        expect((await service.list())[0].latestPdfUrl).toBeNull();
      });

      it('is null when no published version is in effect (drafts or only an upcoming one)', async () => {
        process.env.PUBLIC_BASE_URL = 'https://clickwrap.example.org';
        const doc = await service.create({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
        const stored = await pdf.store({ buffer: Buffer.from('%PDF next'), fileName: 'next.pdf' });
        await versions.save(
          aVersion({ id: 'v-next', documentId: doc.id, storageKey: stored.storageKey, validFrom: new Date('2026-08-01T00:00:00Z'), publishedAt: T0 }),
        );

        expect((await service.list())[0].latestPdfUrl).toBeNull();
      });
    });
  });
});
