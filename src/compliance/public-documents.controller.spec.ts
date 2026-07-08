/**
 * PublicDocumentsController — @nestjs/testing + supertest. NO auth: the URL is meant to be
 * rendered into static places (offers); every request redirects to a fresh presigned URL of the
 * CURRENTLY EFFECTIVE published version, with a uniform 404 for every miss and zero side effects.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FixedClock } from '../domain/clock';
import { aDocument, aState, aVersion } from '../domain/testing/fixtures';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import { PublicDocumentsController } from './public-documents.controller';
import { PublicDocumentsService } from './public-documents.service';
import { FakePdfUrlProvider } from './testing/fake-pdf-url-provider';

const T0 = new Date('2026-07-07T09:00:00Z');
const FLIP = new Date('2026-08-01T00:00:00Z');

const presignedUrlFor = (storageKey: string): string =>
  `https://fake-storage.test/presigned/${encodeURIComponent(storageKey)}?expires=900`;

describe('PublicDocumentsController (e2e)', () => {
  let app: INestApplication;
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let clock: FixedClock;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    states = new InMemoryCustomerVersionStateRepo();
    clock = new FixedClock(T0);
    const service = new PublicDocumentsService(versions, clock, new FakePdfUrlProvider());

    await documents.save(aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' }));

    const moduleRef = await Test.createTestingModule({
      controllers: [PublicDocumentsController],
      providers: [{ provide: PublicDocumentsService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const getLatestPdf = (type = 'dpa', audience = 'customer') =>
    request(app.getHttpServer()).get(`/documents/${type}/${audience}/latest.pdf`);

  it('302-redirects to a working presigned URL of the currently effective published version (no auth required)', async () => {
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-c', storageKey: 's3://bucket/v-1.pdf' }));

    const response = await getLatestPdf();

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(presignedUrlFor('s3://bucket/v-1.pdf'));
  });

  it('the stable URL flips with the compliance baseline: before validFrom the OLD PDF is served, after the flip the NEW one', async () => {
    await versions.save(
      aVersion({ id: 'v-old', documentId: 'doc-dpa-c', storageKey: 's3://bucket/v-old.pdf', validFrom: new Date('2026-06-01T00:00:00Z'), publishedAt: new Date('2026-06-01T00:00:00Z') }),
    );
    await versions.save(
      aVersion({ id: 'v-next', documentId: 'doc-dpa-c', storageKey: 's3://bucket/v-next.pdf', validFrom: FLIP, publishedAt: T0 }),
    );

    const before = await getLatestPdf();
    expect(before.status).toBe(302);
    expect(before.headers.location).toBe(presignedUrlFor('s3://bucket/v-old.pdf'));

    clock.set(FLIP);
    const after = await getLatestPdf();
    expect(after.status).toBe(302);
    expect(after.headers.location).toBe(presignedUrlFor('s3://bucket/v-next.pdf'));
  });

  it.each([
    ['unknown document type', () => getLatestPdf('unknown-type', 'customer')],
    ['unknown audience', () => getLatestPdf('dpa', 'unknown-audience')],
    ['document without any published version', () => getLatestPdf()],
  ])('uniform 404: %s', async (_label, fire) => {
    // Only a DRAFT exists → nothing effective to serve.
    await versions.save(aVersion({ id: 'v-draft', documentId: 'doc-dpa-c', status: 'DRAFT' }));

    const response = await fire();

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'VERSION_NOT_FOUND', message: 'No published document at this address' });
  });

  it('uniform 404 when ONLY an upcoming (not yet effective) version is published — offers must reference what is in force', async () => {
    await versions.save(aVersion({ id: 'v-next', documentId: 'doc-dpa-c', validFrom: FLIP, publishedAt: T0 }));

    const response = await getLatestPdf();

    expect(response.status).toBe(404);
  });

  it('is side-effect-free: a GET never touches customer version states', async () => {
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-c' }));
    await states.save(aState({ id: 'cvs-1', customerId: 'c-1', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));

    await getLatestPdf().expect(302);

    const state = await states.findById('cvs-1');
    expect(state).toMatchObject({ state: 'PENDING_NOTIFICATION', remindersSent: 0 });
    expect(state?.notifiedAt).toBeUndefined();
    expect(state?.deadlineAt).toBeUndefined();
  });
});
