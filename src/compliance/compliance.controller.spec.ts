/**
 * ComplianceController — @nestjs/testing + supertest. The customer is addressed by query parameter
 * (customerId | externalRef+audience); auth is the shared x-service-token (ServiceTokenGuard).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainErrorFilter } from '../common/http/domain-error.filter.js';
import { FixedClock } from '../domain/clock.js';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory/index.js';
import { aCustomer, aDocument, aState, aVersion, anAudience } from '../domain/testing/fixtures.js';
import { TOKENS } from '../persistence/tokens.js';
import { ComplianceController } from './compliance.controller.js';
import { ComplianceService } from './compliance.service.js';

const SERVICE_TOKEN = 'test-service-token';
const T0 = new Date('2026-07-07T09:00:00Z');

describe('ComplianceController (e2e)', () => {
  let app: INestApplication;
  let customers: InMemoryCustomerRepo;

  beforeAll(() => {
    process.env.SERVICE_API_TOKEN = SERVICE_TOKEN;
  });

  afterAll(() => {
    delete process.env.SERVICE_API_TOKEN;
  });

  beforeEach(async () => {
    customers = new InMemoryCustomerRepo();
    const documentsRepo = new InMemoryAgreementDocumentRepo();
    const audiencesRepo = new InMemoryAudienceRepo(documentsRepo, customers);
    const versionsRepo = new InMemoryAgreementVersionRepo(documentsRepo);
    const statesRepo = new InMemoryCustomerVersionStateRepo();
    const acceptancesRepo = new InMemoryAcceptanceRepo();
    const clock = new FixedClock(T0);
    const complianceService = new ComplianceService(
      customers,
      audiencesRepo,
      documentsRepo,
      versionsRepo,
      statesRepo,
      acceptancesRepo,
      clock,
    );

    await audiencesRepo.save(anAudience({ id: 'aud-customer', key: 'customer' }));
    await customers.save(aCustomer({ id: 'c-123', externalRef: 'crm-123', roles: ['customer'] }));
    const document = aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' });
    await documentsRepo.save(document);
    const version = aVersion({ id: 'v-dpa-c', documentId: 'doc-dpa-c', versionLabel: 'June 2026 edition' });
    await versionsRepo.save(version);
    await statesRepo.save(aState({ customerId: 'c-123', versionId: version.id, state: 'ACCEPTED' }));

    const moduleRef = await Test.createTestingModule({
      controllers: [ComplianceController],
      providers: [
        { provide: ComplianceService, useValue: complianceService },
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

  const get = () => request(app.getHttpServer()).get('/customers/compliance').set('x-service-token', SERVICE_TOKEN);

  it('resolves by customerId (audience optional scope)', async () => {
    const response = await get().query({ customerId: 'c-123', audience: 'customer' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      customerId: 'c-123',
      audience: 'customer',
      roles: ['customer'],
      compliant: true,
      details: { DPA_CUSTOMER: { requiredVersionId: 'v-dpa-c', state: 'ACCEPTED' } },
    });
  });

  it('resolves by externalRef + audience', async () => {
    const response = await get().query({ externalRef: 'crm-123', audience: 'customer' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ customerId: 'c-123', compliant: true });
  });

  it('400 when neither customerId nor externalRef is provided', async () => {
    expect((await get()).status).toBe(400);
  });

  it('400 when both customerId and externalRef are provided', async () => {
    expect((await get().query({ customerId: 'c-123', externalRef: 'crm-123', audience: 'customer' })).status).toBe(400);
  });

  it('400 when externalRef is given without audience', async () => {
    expect((await get().query({ externalRef: 'crm-123' })).status).toBe(400);
  });

  it('401 when the service token is missing/wrong', async () => {
    const response = await request(app.getHttpServer())
      .get('/customers/compliance')
      .query({ customerId: 'c-123' })
      .set('x-service-token', 'wrong-token');
    expect(response.status).toBe(401);
  });

  it('422 UNKNOWN_AUDIENCE for an audience key that does not exist', async () => {
    const response = await get().query({ externalRef: 'crm-123', audience: 'admin' });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
  });

  it('404 CUSTOMER_NOT_FOUND for an unknown customerId', async () => {
    const response = await get().query({ customerId: 'c-ghost' });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('404 CUSTOMER_NOT_FOUND for an unknown externalRef', async () => {
    const response = await get().query({ externalRef: 'crm-ghost', audience: 'customer' });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });
});
