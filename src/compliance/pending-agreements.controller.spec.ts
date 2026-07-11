/**
 * PendingAgreementsController — @nestjs/testing + supertest, with a real ServiceGuard context.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainErrorFilter } from '../common/http/domain-error.filter.js';
import { FixedClock } from '../domain/clock.js';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory/index.js';
import { aCustomer, aDocument, aState, anActiveVersion, anAudience } from '../domain/testing/fixtures.js';
import { TOKENS } from '../persistence/tokens.js';
import { PendingAgreementsController } from './pending-agreements.controller.js';
import { PendingAgreementsService } from './pending-agreements.service.js';
import { FakePdfUrlProvider } from './testing/fake-pdf-url-provider.js';

const SERVICE_TOKEN = 'test-service-token';
const T0 = new Date('2026-07-07T09:00:00Z');
const DEADLINE = new Date('2026-07-21T09:00:00Z');

describe('PendingAgreementsController (e2e)', () => {
  let app: INestApplication;

  beforeAll(() => {
    process.env.SERVICE_API_TOKEN = SERVICE_TOKEN;
  });

  afterAll(() => {
    delete process.env.SERVICE_API_TOKEN;
  });

  let customers: InMemoryCustomerRepo;

  beforeEach(async () => {
    customers = new InMemoryCustomerRepo();
    const documentsRepo = new InMemoryAgreementDocumentRepo();
    const audiencesRepo = new InMemoryAudienceRepo(documentsRepo, customers);
    const versionsRepo = new InMemoryAgreementVersionRepo(documentsRepo);
    const statesRepo = new InMemoryCustomerVersionStateRepo();
    const clock = new FixedClock(T0);
    const service = new PendingAgreementsService(
      customers,
      audiencesRepo,
      documentsRepo,
      versionsRepo,
      statesRepo,
      clock,
      new FakePdfUrlProvider(),
    );

    await audiencesRepo.save(anAudience({ id: 'aud-customer', key: 'customer' }));
    await customers.save(aCustomer({ id: 'c-123', externalRef: 'crm-123', roles: ['customer'] }));
    const document = aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' });
    await documentsRepo.save(document);
    const version = anActiveVersion({
      id: 'v-dpa-c',
      documentId: 'doc-dpa-c',
      versionLabel: 'June 2026 edition',
      changeSummary: 'New sub-processor for e-mail delivery.',
    });
    await versionsRepo.save(version);
    await statesRepo.save(
      aState({ customerId: 'c-123', versionId: version.id, state: 'EXPIRED_BLOCKING', notifiedAt: T0, deadlineAt: DEADLINE }),
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [PendingAgreementsController],
      providers: [
        { provide: PendingAgreementsService, useValue: service },
        { provide: TOKENS.CustomerRepo, useValue: customers },
        { provide: TOKENS.AudienceRepo, useValue: audiencesRepo },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const get = () =>
    request(app.getHttpServer()).get('/customers/pending-agreements').set('x-service-token', SERVICE_TOKEN);

  const expectItem = {
    versionId: 'v-dpa-c',
    documentType: 'dpa',
    audience: 'customer',
    versionLabel: 'June 2026 edition',
    mode: 'ACTIVE',
    blocking: true,
  };

  it('resolves by customerId and returns the open, blocking version as a popup item', async () => {
    const response = await get().query({ customerId: 'c-123', audience: 'customer' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining(expectItem)]);
  });

  it('resolves by externalRef + audience', async () => {
    const response = await get().query({ externalRef: 'crm-123', audience: 'customer' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining(expectItem)]);
  });

  it('400 when neither customerId nor externalRef is provided', async () => {
    expect((await get()).status).toBe(400);
  });

  it('400 when externalRef is given without audience', async () => {
    expect((await get().query({ externalRef: 'crm-123' })).status).toBe(400);
  });

  it('401 when the service token is missing/wrong', async () => {
    const response = await request(app.getHttpServer())
      .get('/customers/pending-agreements')
      .query({ customerId: 'c-123' })
      .set('x-service-token', 'wrong-token');
    expect(response.status).toBe(401);
  });

  it('404 CUSTOMER_NOT_FOUND for an unknown customerId', async () => {
    const response = await get().query({ customerId: 'c-ghost' });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });
});
