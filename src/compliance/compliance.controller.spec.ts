/**
 * ComplianceController — @nestjs/testing + supertest, with a real ServiceGuard context
 * (x-service-token/x-customer-id headers, as used for the tools' service-to-service auth).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainErrorFilter } from '../common/http/domain-error.filter';
import { FixedClock } from '../domain/clock';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import { aCustomer, aDocument, aState, aVersion, anAudience } from '../domain/testing/fixtures';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';

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
    await customers.save(aCustomer({ id: 'c-123', roles: ['customer'] }));
    const document = aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' });
    await documentsRepo.save(document);
    const version = aVersion({ id: 'v-dpa-c', documentId: 'doc-dpa-c', versionLabel: 'June 2026 edition' });
    await versionsRepo.save(version);
    await statesRepo.save(aState({ customerId: 'c-123', versionId: version.id, state: 'ACCEPTED' }));

    const moduleRef = await Test.createTestingModule({
      controllers: [ComplianceController],
      providers: [{ provide: ComplianceService, useValue: complianceService }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the compliance response when path customerId and auth context match', async () => {
    const response = await request(app.getHttpServer())
      .get('/customers/c-123/compliance')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-customer-id', 'c-123')
      .set('x-actor-user-id', 'u-1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      customerId: 'c-123',
      audience: 'customer',
      roles: ['customer'],
      compliant: true,
      details: {
        DPA_CUSTOMER: {
          requiredVersionId: 'v-dpa-c',
          requiredVersionLabel: 'June 2026 edition',
          state: 'ACCEPTED',
        },
      },
    });
  });

  it('FORBIDDEN (403) when the path customerId differs from the auth context', async () => {
    const response = await request(app.getHttpServer())
      .get('/customers/c-123/compliance')
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-customer-id', 'c-999')
      .set('x-actor-user-id', 'u-1');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('401 when the service token is missing/wrong (ServiceGuard)', async () => {
    const response = await request(app.getHttpServer())
      .get('/customers/c-123/compliance')
      .set('x-service-token', 'wrong-token')
      .set('x-customer-id', 'c-123');

    expect(response.status).toBe(401);
  });

  it('422 UNKNOWN_AUDIENCE for an audience key that does not exist in the repo', async () => {
    const response = await request(app.getHttpServer())
      .get('/customers/c-123/compliance')
      .query({ audience: 'admin' })
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-customer-id', 'c-123')
      .set('x-actor-user-id', 'u-1');

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
  });

  it('404 CUSTOMER_NOT_FOUND for an unknown customer', async () => {
    const response = await request(app.getHttpServer())
      .get('/customers/c-ghost/compliance')
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-customer-id', 'c-ghost')
      .set('x-actor-user-id', 'u-1');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });
});
