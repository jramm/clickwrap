import { INestApplication, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminGuard } from '../common/auth/admin.guard.js';
import { DomainErrorFilter } from '../common/http/domain-error.filter.js';
import { FixedClock } from '../domain/clock.js';
import { aCustomer, aDocumentTypeDef, anAudience, aVersion } from '../domain/testing/fixtures.js';
import { TOKENS } from '../persistence/tokens.js';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryDocumentTypeRepo,
} from '../persistence/inmemory/index.js';
import { AgreementsAdminController } from './agreements-admin.controller.js';
import { DocumentService } from './document.service.js';
import { InMemoryPdfStorage } from './pdf-storage.inmemory.js';
import { AGREEMENTS_TOKENS } from './ports.js';
import { VersionService } from './version.service.js';

const T0 = new Date('2026-07-07T09:00:00Z');
const PDF_BASE64 = Buffer.from('%PDF-1.7 test').toString('base64');

const allowAdmin: CanActivate = {
  canActivate: (ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest().adminActor = { userId: 'admin-1' };
    return true;
  },
};

describe('AgreementsAdminController', () => {
  let app: INestApplication;
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let documentTypes: InMemoryDocumentTypeRepo;
  let audiences: InMemoryAudienceRepo;
  let customers: InMemoryCustomerRepo;
  let pdf: InMemoryPdfStorage;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    documentTypes = new InMemoryDocumentTypeRepo(documents);
    customers = new InMemoryCustomerRepo();
    audiences = new InMemoryAudienceRepo(documents, customers);
    pdf = new InMemoryPdfStorage();
    await documentTypes.save(aDocumentTypeDef());
    await audiences.save(anAudience());

    const moduleRef = await Test.createTestingModule({
      controllers: [AgreementsAdminController],
      providers: [
        DocumentService,
        VersionService,
        { provide: TOKENS.AgreementDocumentRepo, useValue: documents },
        { provide: TOKENS.AgreementVersionRepo, useValue: versions },
        { provide: TOKENS.DocumentTypeRepo, useValue: documentTypes },
        { provide: TOKENS.AudienceRepo, useValue: audiences },
        { provide: TOKENS.CustomerRepo, useValue: customers },
        { provide: TOKENS.Clock, useValue: new FixedClock(T0) },
        { provide: AGREEMENTS_TOKENS.PdfStorage, useValue: pdf },
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
    await app.close();
  });

  it('POST /admin/documents creates a document (201)', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/documents')
      .send({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' })
      .expect(201);
    expect(res.body).toMatchObject({ type: 'dpa', audience: 'customer' });
  });

  it('POST /admin/documents duplicate → 422 INVALID_STATE', async () => {
    await request(app.getHttpServer()).post('/admin/documents').send({ type: 'dpa', audience: 'customer', name: 'x' });
    const res = await request(app.getHttpServer())
      .post('/admin/documents')
      .send({ type: 'dpa', audience: 'customer', name: 'y' })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_STATE' });
  });

  it('POST /admin/documents/:id/versions (multipart/form-data) creates a DRAFT version', async () => {
    const doc = await documents.save({ id: 'doc-1', type: 'dpa', audience: 'customer', name: 'DPA' });
    const res = await request(app.getHttpServer())
      .post(`/admin/documents/${doc.id}/versions`)
      .field('versionLabel', 'June 2026 edition')
      .field('changeSummary', 'New')
      .field('acceptanceMode', 'ACTIVE')
      .field('consentText', 'I agree.')
      .field('hardDeadlineAt', '2026-08-01T00:00:00.000Z')
      .field('validFrom', '2026-07-01')
      .attach('file', Buffer.from('%PDF-1.7 multipart'), 'dpa-multipart.pdf')
      .expect(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', fileName: 'dpa-multipart.pdf' });
    expect(res.body.contentHash).toMatch(/^sha256:/);
    // hardDeadlineAt arrived as a multipart ISO string and must be parsed to a Date (ACTIVE only).
    const stored = await versions.findById(res.body.versionId);
    expect(stored?.hardDeadlineAt).toEqual(new Date('2026-08-01T00:00:00.000Z'));
  });

  it('POST /admin/documents/:id/versions (base64 fallback) creates a DRAFT version and returns contentHash', async () => {
    const doc = await documents.save({ id: 'doc-1', type: 'dpa', audience: 'customer', name: 'DPA' });
    const res = await request(app.getHttpServer())
      .post(`/admin/documents/${doc.id}/versions`)
      .send({
        file: PDF_BASE64,
        fileName: 'dpa.pdf',
        versionLabel: 'June 2026 edition',
        changeSummary: 'New',
        acceptanceMode: 'ACTIVE',
        consentText: 'I agree.',
        gracePeriodDays: 14,
        validFrom: '2026-07-01',
      })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', fileName: 'dpa.pdf' });
    expect(res.body.contentHash).toMatch(/^sha256:/);
  });

  it('POST /admin/documents/:id/versions without a PDF (neither multipart nor base64) → 400', async () => {
    const doc = await documents.save({ id: 'doc-1', type: 'dpa', audience: 'customer', name: 'DPA' });
    await request(app.getHttpServer())
      .post(`/admin/documents/${doc.id}/versions`)
      .send({
        versionLabel: 'June 2026 edition',
        changeSummary: 'New',
        acceptanceMode: 'ACTIVE',
        validFrom: '2026-07-01',
      })
      .expect(400);
  });

  it('GET /admin/versions/:id returns the detail including a pre-signed pdfUrl', async () => {
    const stored = await pdf.store({ buffer: Buffer.from('x'), fileName: 'a.pdf' });
    await documents.save({ id: 'doc-1', type: 'dpa', audience: 'customer', name: 'DPA' });
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-1', status: 'DRAFT', storageKey: stored.storageKey }));

    const res = await request(app.getHttpServer()).get('/admin/versions/v-1').expect(200);
    expect(res.body).toMatchObject({ id: 'v-1', status: 'DRAFT' });
    expect(res.body.pdfUrl).toContain('expires=900');
  });

  it('GET /admin/versions/:id unknown → 404 VERSION_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/admin/versions/v-unknown').expect(404);
    expect(res.body).toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('GET /admin/versions/:id/affected-customers counts customers with the document audience role', async () => {
    await documents.save({ id: 'doc-1', type: 'dpa', audience: 'customer', name: 'DPA' });
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-1', status: 'DRAFT' }));
    await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
    await customers.save(aCustomer({ id: 'c-2', roles: ['customer', 'partner'] }));
    await customers.save(aCustomer({ id: 'c-3', roles: ['partner'] })); // not affected

    const res = await request(app.getHttpServer()).get('/admin/versions/v-1/affected-customers').expect(200);
    expect(res.body).toEqual({ audience: 'customer', count: 2 });
  });

  it('GET /admin/versions/:id/affected-customers unknown → 404 VERSION_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/admin/versions/v-unknown/affected-customers').expect(404);
    expect(res.body).toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('PATCH /admin/versions/:id on PUBLISHED → 409 VERSION_IMMUTABLE', async () => {
    await documents.save({ id: 'doc-1', type: 'dpa', audience: 'customer', name: 'DPA' });
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-1', status: 'PUBLISHED' }));
    const res = await request(app.getHttpServer()).patch('/admin/versions/v-1').send({ versionLabel: 'new' }).expect(409);
    expect(res.body).toMatchObject({ code: 'VERSION_IMMUTABLE' });
  });

  it('DELETE /admin/versions/:id deletes a DRAFT (204)', async () => {
    await documents.save({ id: 'doc-1', type: 'dpa', audience: 'customer', name: 'DPA' });
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-1', status: 'DRAFT' }));
    await request(app.getHttpServer()).delete('/admin/versions/v-1').expect(204);
    expect(await versions.findById('v-1')).toBeUndefined();
  });

  it('GET /admin/documents returns a flat list { id, type, audience, name, currentVersion }', async () => {
    const stored = await pdf.store({ buffer: Buffer.from('%PDF cur'), fileName: 'cur.pdf' });
    await documents.save({ id: 'doc-1', type: 'dpa', audience: 'customer', name: 'DPA' });
    await versions.save(
      aVersion({ id: 'v-cur', documentId: 'doc-1', status: 'PUBLISHED', storageKey: stored.storageKey, validFrom: T0 }),
    );
    const res = await request(app.getHttpServer()).get('/admin/documents').expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: 'doc-1', type: 'dpa', audience: 'customer', name: 'DPA' });
    expect(res.body.items[0].currentVersion).toMatchObject({ id: 'v-cur' });
    expect(res.body.items[0].currentVersion.pdfUrl).toContain('expires=900');
    expect(res.body.items[0].currentVersion).not.toHaveProperty('storageKey');
    expect(res.body.items[0]).not.toHaveProperty('document');
  });

  it('GET /admin/documents/:id/versions returns version DTOs with pdfUrl and without storageKey', async () => {
    const stored = await pdf.store({ buffer: Buffer.from('%PDF v'), fileName: 'v.pdf' });
    await documents.save({ id: 'doc-1', type: 'dpa', audience: 'customer', name: 'DPA' });
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-1', status: 'DRAFT', storageKey: stored.storageKey }));

    const res = await request(app.getHttpServer()).get('/admin/documents/doc-1/versions').expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: 'v-1', documentId: 'doc-1', status: 'DRAFT' });
    expect(res.body.items[0].pdfUrl).toContain('expires=900');
    expect(res.body.items[0]).not.toHaveProperty('storageKey');
  });
});
