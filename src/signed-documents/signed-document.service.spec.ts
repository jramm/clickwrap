import { createHash } from 'node:crypto';
import { InMemoryAdminAuditRepo } from '../agreements/audit';
import { FileStoragePdfAdapter } from '../agreements/file-storage-pdf.adapter';
import type { Actor } from '../common/auth/actor';
import { DomainError } from '../common/errors';
import { FixedClock } from '../domain/clock';
import { aCustomer, aDocumentTypeDef, anAudience } from '../domain/testing/fixtures';
import { EventRecorder } from '../events/event-recorder';
import { InMemoryFileStorage } from '../plugins/file-storage/memory/in-memory-file-storage';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryDocumentTypeRepo,
  InMemoryEventRepo,
  InMemorySignedDocumentRepo,
} from '../persistence/inmemory';
import { SignedDocumentService, type UploadSignedDocumentInput } from './signed-document.service';

const T0 = new Date('2026-07-08T09:00:00Z');
const PDF = Buffer.from('%PDF-1.7 signed offer');
const actor: Actor = { userId: 'admin-1', name: 'Alice Admin' };

const anUpload = (overrides: Partial<UploadSignedDocumentInput> = {}): UploadSignedDocumentInput => ({
  documentTypeKey: 'signed-offer',
  signedAt: new Date('2026-06-15T00:00:00Z'),
  file: { buffer: PDF, fileName: 'signed-offer.pdf' },
  signerName: 'Jane Doe',
  reference: 'HubSpot deal 12345',
  audience: 'customer',
  note: 'Counter-signed.',
  ...overrides,
});

describe('SignedDocumentService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let documentTypes: InMemoryDocumentTypeRepo;
  let audiences: InMemoryAudienceRepo;
  let signedDocuments: InMemorySignedDocumentRepo;
  let customers: InMemoryCustomerRepo;
  let storage: InMemoryFileStorage;
  let audit: InMemoryAdminAuditRepo;
  let eventRepo: InMemoryEventRepo;
  let service: SignedDocumentService;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    documentTypes = new InMemoryDocumentTypeRepo(documents);
    customers = new InMemoryCustomerRepo();
    audiences = new InMemoryAudienceRepo(documents, customers);
    signedDocuments = new InMemorySignedDocumentRepo();
    storage = new InMemoryFileStorage();
    audit = new InMemoryAdminAuditRepo();
    eventRepo = new InMemoryEventRepo();
    service = new SignedDocumentService(
      customers,
      documentTypes,
      audiences,
      signedDocuments,
      new FileStoragePdfAdapter(storage),
      new FixedClock(T0),
      audit,
      new EventRecorder(eventRepo, new FixedClock(T0)),
    );

    await customers.save(aCustomer({ id: 'c-123' }));
    await audiences.save(anAudience({ id: 'aud-customer', key: 'customer', name: 'Customers' }));
    await documentTypes.save(aDocumentTypeDef({ id: 'dt-signed', key: 'signed-offer', name: 'Signed offer', external: true }));
    await documentTypes.save(aDocumentTypeDef({ id: 'dt-dpa', key: 'dpa', name: 'DPA', external: false }));
  });

  describe('upload', () => {
    it('uploads a signed document for an external type with a host-computed contentHash', async () => {
      const dto = await service.upload('c-123', anUpload(), actor, { recordAudit: true });

      expect(dto).toMatchObject({
        customerId: 'c-123',
        documentTypeKey: 'signed-offer',
        audience: 'customer',
        fileName: 'signed-offer.pdf',
        signerName: 'Jane Doe',
        reference: 'HubSpot deal 12345',
        uploadedBy: 'admin-1',
        uploadedAt: T0,
        signedAt: new Date('2026-06-15T00:00:00Z'),
        fileSize: PDF.length,
      });
      expect(dto.contentHash).toBe(`sha256:${createHash('sha256').update(PDF).digest('hex')}`);
      expect(dto.pdfUrl).toMatch(/^https:\/\/presigned\.local\//);
      expect(dto).not.toHaveProperty('storageKey');
    });

    it('stores the PDF so it is retrievable through storage', async () => {
      await service.upload('c-123', anUpload(), actor);
      const stored = await signedDocuments.findByCustomer('c-123');
      await expect(storage.retrieve(stored[0].storageKey)).resolves.toEqual(PDF);
    });

    it('records uploadedBy from the actor (never the body)', async () => {
      const dto = await service.upload('c-123', anUpload(), { userId: 'service-integrator' });
      expect(dto.uploadedBy).toBe('service-integrator');
    });

    it('writes a SIGNED_DOCUMENT_UPLOAD audit entry when recordAudit is set (admin path)', async () => {
      const dto = await service.upload('c-123', anUpload(), actor, { recordAudit: true });
      const logs = await audit.findByTarget('SignedDocument', dto.id);
      expect(logs).toMatchObject([{ action: 'SIGNED_DOCUMENT_UPLOAD', actor: 'admin-1', createdAt: T0 }]);
    });

    it('records a SIGNED_DOCUMENT_UPLOADED event on a successful admin upload', async () => {
      await service.upload('c-123', anUpload(), actor, { recordAudit: true });
      const { items } = await eventRepo.query({});
      expect(items[0]).toMatchObject({
        type: 'SIGNED_DOCUMENT_UPLOADED',
        category: 'ADMINISTRATION',
        actorKind: 'ADMIN',
      });
    });

    it('does NOT write an audit entry for the integration path (recordAudit unset)', async () => {
      const dto = await service.upload('c-123', anUpload(), actor);
      expect(await audit.findByTarget('SignedDocument', dto.id)).toEqual([]);
    });

    it('rejects an unknown customer with CUSTOMER_NOT_FOUND', async () => {
      await expect(service.upload('c-unknown', anUpload(), actor)).rejects.toMatchObject({
        code: 'CUSTOMER_NOT_FOUND',
      });
    });

    it('rejects an unknown document type with UNKNOWN_DOCUMENT_TYPE', async () => {
      await expect(service.upload('c-123', anUpload({ documentTypeKey: 'nope' }), actor)).rejects.toMatchObject({
        code: 'UNKNOWN_DOCUMENT_TYPE',
      });
    });

    it('rejects a non-external document type with DOCUMENT_TYPE_NOT_EXTERNAL', async () => {
      await expect(service.upload('c-123', anUpload({ documentTypeKey: 'dpa' }), actor)).rejects.toMatchObject({
        code: 'DOCUMENT_TYPE_NOT_EXTERNAL',
      });
    });

    it('rejects an unknown audience with UNKNOWN_AUDIENCE', async () => {
      await expect(service.upload('c-123', anUpload({ audience: 'ghosts' }), actor)).rejects.toMatchObject({
        code: 'UNKNOWN_AUDIENCE',
      });
    });

    it('allows omitting the audience', async () => {
      const dto = await service.upload('c-123', anUpload({ audience: undefined }), actor);
      expect(dto.audience).toBeUndefined();
    });

    it('rejects an empty file with INVALID_STATE', async () => {
      await expect(
        service.upload('c-123', anUpload({ file: { buffer: Buffer.alloc(0), fileName: 'x.pdf' } }), actor),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });
  });

  describe('list', () => {
    it('lists a customer’s signed documents newest first, each with a presigned pdfUrl', async () => {
      const clock = new FixedClock(new Date('2026-07-01T09:00:00Z'));
      const withClock = new SignedDocumentService(
        customers,
        documentTypes,
        audiences,
        signedDocuments,
        new FileStoragePdfAdapter(storage),
        clock,
      );
      await withClock.upload('c-123', anUpload({ reference: 'first' }), actor);
      clock.set(new Date('2026-07-05T09:00:00Z'));
      await withClock.upload('c-123', anUpload({ reference: 'second' }), actor);

      const list = await withClock.list('c-123');
      expect(list.map((d) => d.reference)).toEqual(['second', 'first']);
      expect(list[0].pdfUrl).toMatch(/^https:\/\/presigned\.local\//);
    });

    it('returns an empty array for a customer without signed documents', async () => {
      expect(await service.list('c-123')).toEqual([]);
    });
  });

  describe('getPdfUrl', () => {
    it('returns a presigned URL for a stored document', async () => {
      const dto = await service.upload('c-123', anUpload(), actor);
      await expect(service.getPdfUrl(dto.id)).resolves.toMatch(/^https:\/\/presigned\.local\//);
    });

    it('rejects an unknown id with VERSION_NOT_FOUND', async () => {
      await expect(service.getPdfUrl('sd-unknown')).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
    });
  });
});
