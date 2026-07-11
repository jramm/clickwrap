import { INestApplication, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { ADMIN_AUDIT_TOKEN, InMemoryAdminAuditRepo } from '../agreements/audit.js';
import { FileStoragePdfAdapter } from '../agreements/file-storage-pdf.adapter.js';
import { AGREEMENTS_TOKENS } from '../agreements/ports.js';
import { AdminGuard } from '../common/auth/admin.guard.js';
import { DomainErrorFilter } from '../common/http/domain-error.filter.js';
import { FixedClock } from '../domain/clock.js';
import { aCustomer, aDocumentTypeDef, anAudience } from '../domain/testing/fixtures.js';
import { InMemoryFileStorage } from '../plugins/file-storage/memory/in-memory-file-storage.js';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryDocumentTypeRepo,
  InMemorySignedDocumentRepo,
} from '../persistence/inmemory/index.js';
import { TOKENS } from '../persistence/tokens.js';
import { SignedDocumentsAdminController } from './signed-documents-admin.controller.js';
import { SignedDocumentsIntegrationController } from './signed-documents-integration.controller.js';
import { SignedDocumentService } from './signed-document.service.js';

const T0 = new Date('2026-07-08T09:00:00Z');
const PDF = Buffer.from('%PDF-1.7 signed offer');
const PDF_BASE64 = PDF.toString('base64');
const EXPECTED_HASH = `sha256:${createHash('sha256').update(PDF).digest('hex')}`;
const SERVICE_TOKEN = 'test-service-token';

const allowAdmin: CanActivate = {
  canActivate: (ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest().adminActor = { userId: 'admin-1' };
    return true;
  },
};

describe('Signed documents controllers', () => {
  let app: INestApplication;
  let customers: InMemoryCustomerRepo;
  let documentTypes: InMemoryDocumentTypeRepo;
  let audiences: InMemoryAudienceRepo;
  let signedDocuments: InMemorySignedDocumentRepo;
  let audit: InMemoryAdminAuditRepo;
  let storage: InMemoryFileStorage;
  let previousToken: string | undefined;

  beforeEach(async () => {
    previousToken = process.env.SERVICE_API_TOKEN;
    process.env.SERVICE_API_TOKEN = SERVICE_TOKEN;

    const documents = new InMemoryAgreementDocumentRepo();
    customers = new InMemoryCustomerRepo();
    documentTypes = new InMemoryDocumentTypeRepo(documents);
    audiences = new InMemoryAudienceRepo(documents, customers);
    signedDocuments = new InMemorySignedDocumentRepo();
    audit = new InMemoryAdminAuditRepo();
    storage = new InMemoryFileStorage();

    await customers.save(aCustomer({ id: 'c-123' }));
    await audiences.save(anAudience({ id: 'aud-customer', key: 'customer', name: 'Customers' }));
    await documentTypes.save(aDocumentTypeDef({ id: 'dt-signed', key: 'signed-offer', name: 'Signed offer', external: true }));
    await documentTypes.save(aDocumentTypeDef({ id: 'dt-dpa', key: 'dpa', name: 'DPA', external: false }));

    const moduleRef = await Test.createTestingModule({
      controllers: [SignedDocumentsAdminController, SignedDocumentsIntegrationController],
      providers: [
        SignedDocumentService,
        { provide: TOKENS.CustomerRepo, useValue: customers },
        { provide: TOKENS.DocumentTypeRepo, useValue: documentTypes },
        { provide: TOKENS.AudienceRepo, useValue: audiences },
        { provide: TOKENS.SignedDocumentRepo, useValue: signedDocuments },
        { provide: TOKENS.Clock, useValue: new FixedClock(T0) },
        { provide: AGREEMENTS_TOKENS.PdfStorage, useValue: new FileStoragePdfAdapter(storage) },
        { provide: ADMIN_AUDIT_TOKEN, useValue: audit },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue(allowAdmin)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
  });

  afterEach(async () => {
    if (previousToken === undefined) delete process.env.SERVICE_API_TOKEN;
    else process.env.SERVICE_API_TOKEN = previousToken;
    await app.close();
  });

  describe('admin surface', () => {
    it('POST /admin/customers/:id/signed-documents (multipart) → 201 with host-computed contentHash', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/customers/c-123/signed-documents')
        .field('documentTypeKey', 'signed-offer')
        .field('signedAt', '2026-06-15T00:00:00Z')
        .field('signerName', 'Jane Doe')
        .field('reference', 'HubSpot deal 12345')
        .attach('file', PDF, 'signed-offer.pdf')
        .expect(201);

      expect(res.body).toMatchObject({
        customerId: 'c-123',
        documentTypeKey: 'signed-offer',
        signerName: 'Jane Doe',
        contentHash: EXPECTED_HASH,
        uploadedBy: 'admin-1',
      });
      expect(res.body.storageKey).toBeUndefined();
      expect(res.body.pdfUrl).toMatch(/^https:\/\/presigned\.local\//);
      // Audit entry written on the admin path.
      expect((await audit.findByTarget('SignedDocument', res.body.id))[0]).toMatchObject({
        action: 'SIGNED_DOCUMENT_UPLOAD',
        actor: 'admin-1',
      });
    });

    it('POST base64 fallback also works', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/customers/c-123/signed-documents')
        .send({ file: PDF_BASE64, fileName: 'offer.pdf', documentTypeKey: 'signed-offer', signedAt: '2026-06-15T00:00:00Z' })
        .expect(201);
      expect(res.body.contentHash).toBe(EXPECTED_HASH);
    });

    it('POST to a non-external type → 422 DOCUMENT_TYPE_NOT_EXTERNAL', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/customers/c-123/signed-documents')
        .field('documentTypeKey', 'dpa')
        .field('signedAt', '2026-06-15T00:00:00Z')
        .attach('file', PDF, 'x.pdf')
        .expect(422);
      expect(res.body).toMatchObject({ code: 'DOCUMENT_TYPE_NOT_EXTERNAL' });
    });

    it('POST for an unknown customer → 404 CUSTOMER_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/customers/c-ghost/signed-documents')
        .field('documentTypeKey', 'signed-offer')
        .field('signedAt', '2026-06-15T00:00:00Z')
        .attach('file', PDF, 'x.pdf')
        .expect(404);
      expect(res.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
    });

    it('GET list returns newest first', async () => {
      await request(app.getHttpServer())
        .post('/admin/customers/c-123/signed-documents')
        .field('documentTypeKey', 'signed-offer')
        .field('signedAt', '2026-06-15T00:00:00Z')
        .attach('file', PDF, 'a.pdf')
        .expect(201);
      const res = await request(app.getHttpServer()).get('/admin/customers/c-123/signed-documents').expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ documentTypeKey: 'signed-offer' });
    });

    it('GET /admin/signed-documents/:id/pdf → 302 to a presigned URL', async () => {
      const created = await request(app.getHttpServer())
        .post('/admin/customers/c-123/signed-documents')
        .field('documentTypeKey', 'signed-offer')
        .field('signedAt', '2026-06-15T00:00:00Z')
        .attach('file', PDF, 'a.pdf')
        .expect(201);
      const res = await request(app.getHttpServer())
        .get(`/admin/signed-documents/${created.body.id}/pdf`)
        .expect(302);
      expect(res.headers.location).toMatch(/^https:\/\/presigned\.local\//);
    });
  });

  describe('integration surface', () => {
    it('rejects a request without a service token with 401', async () => {
      await request(app.getHttpServer())
        .post('/customers/c-123/signed-documents')
        .field('documentTypeKey', 'signed-offer')
        .field('signedAt', '2026-06-15T00:00:00Z')
        .attach('file', PDF, 'x.pdf')
        .expect(401);
    });

    it('uploads with a valid service token and records uploadedBy from the actor headers (no admin audit)', async () => {
      const res = await request(app.getHttpServer())
        .post('/customers/c-123/signed-documents')
        .set('x-service-token', SERVICE_TOKEN)
        .set('x-actor-user-id', 'integrator-9')
        .field('documentTypeKey', 'signed-offer')
        .field('signedAt', '2026-06-15T00:00:00Z')
        .attach('file', PDF, 'offer.pdf')
        .expect(201);

      expect(res.body).toMatchObject({ uploadedBy: 'integrator-9', contentHash: EXPECTED_HASH });
      // Integration path never writes the admin audit log.
      expect(await audit.findByTarget('SignedDocument', res.body.id)).toEqual([]);
    });

    it('lists a customer’s signed documents with a valid token', async () => {
      await request(app.getHttpServer())
        .post('/customers/c-123/signed-documents')
        .set('x-service-token', SERVICE_TOKEN)
        .field('documentTypeKey', 'signed-offer')
        .field('signedAt', '2026-06-15T00:00:00Z')
        .attach('file', PDF, 'offer.pdf')
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/customers/c-123/signed-documents')
        .set('x-service-token', SERVICE_TOKEN)
        .expect(200);
      expect(res.body.items).toHaveLength(1);
    });
  });
});
