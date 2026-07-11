/**
 * IntegrationComplianceController — the (externalRef, audience)-keyed compliance gate used by an
 * upstream system that only knows the customer by its own external reference. Auth is the shared
 * `x-service-token` (ServiceTokenGuard) — no `x-customer-id`, the customer is resolved from the
 * external reference. @nestjs/testing + supertest against a real ComplianceService.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainErrorFilter } from '../common/http/domain-error.filter.js';
import { FixedClock } from '../domain/clock.js';
import { TOKENS } from '../persistence/tokens.js';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory/index.js';
import { aCustomer, aDocument, aState, aVersion, anAudience } from '../domain/testing/fixtures.js';
import { ComplianceService } from './compliance.service.js';
import { IntegrationComplianceController } from './integration-compliance.controller.js';

const SERVICE_TOKEN = 'test-service-token';
const T0 = new Date('2026-07-07T09:00:00Z');
const DEADLINE = new Date('2026-06-30T00:00:00Z');

describe('IntegrationComplianceController (e2e)', () => {
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
    await audiencesRepo.save(anAudience({ id: 'aud-partner', key: 'partner', name: 'Partners' }));
    const document = aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' });
    await documentsRepo.save(document);
    const version = aVersion({ id: 'v-dpa-c', documentId: 'doc-dpa-c', versionLabel: 'June 2026 edition' });
    await versionsRepo.save(version);

    // Compliant customer.
    await customers.save(aCustomer({ id: 'c-ok', externalRef: 'crm-ok', roles: ['customer'] }));
    await statesRepo.save(aState({ id: 'cvs-ok', customerId: 'c-ok', versionId: 'v-dpa-c', state: 'ACCEPTED' }));

    // Blocked customer (EXPIRED_BLOCKING on the current version).
    await customers.save(aCustomer({ id: 'c-block', externalRef: 'crm-block', roles: ['customer'] }));
    await statesRepo.save(
      aState({ id: 'cvs-block', customerId: 'c-block', versionId: 'v-dpa-c', state: 'EXPIRED_BLOCKING', deadlineAt: DEADLINE }),
    );

    // A soft-deleted customer (must resolve to 404).
    await customers.save(aCustomer({ id: 'c-soft', externalRef: 'crm-soft', roles: ['customer'], deletedAt: T0 }));

    // A customer-audience record whose externalRef is also queried for the 'partner' audience.
    await customers.save(aCustomer({ id: 'c-cust', externalRef: 'crm-shared', roles: ['customer'] }));

    const moduleRef = await Test.createTestingModule({
      controllers: [IntegrationComplianceController],
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

  it('401 without a service token', async () => {
    await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-ok/compliance')
      .query({ audience: 'customer' })
      .expect(401);
  });

  it('returns 200 { compliant: true } for a compliant customer resolved by (externalRef, audience)', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-ok/compliance')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .expect(200);
    expect(res.body).toMatchObject({
      customerId: 'c-ok',
      audience: 'customer',
      roles: ['customer'],
      compliant: true,
      details: { DPA_CUSTOMER: { requiredVersionId: 'v-dpa-c', state: 'ACCEPTED' } },
    });
  });

  it('returns 200 { compliant: false } with the outstanding detail for an EXPIRED_BLOCKING customer', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-block/compliance')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .expect(200);
    expect(res.body.compliant).toBe(false);
    expect(res.body.details.DPA_CUSTOMER).toMatchObject({
      requiredVersionId: 'v-dpa-c',
      state: 'EXPIRED_BLOCKING',
      deadlineAt: DEADLINE.toISOString(),
    });
  });

  it('404 CUSTOMER_NOT_FOUND for an unknown externalRef', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/by-external-ref/ghost/compliance')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .expect(404);
    expect(res.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('404 CUSTOMER_NOT_FOUND for a soft-deleted match', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-soft/compliance')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .expect(404);
    expect(res.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('404 for a different-audience customer sharing the externalRef (not matched for the queried audience)', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-shared/compliance')
      .query({ audience: 'partner' })
      .set('x-service-token', SERVICE_TOKEN)
      .expect(404);
    expect(res.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('400 when the audience query param is missing', async () => {
    await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-ok/compliance')
      .set('x-service-token', SERVICE_TOKEN)
      .expect(400);
  });

  it('422 UNKNOWN_AUDIENCE for an audience key that does not exist', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-ok/compliance')
      .query({ audience: 'ghost' })
      .set('x-service-token', SERVICE_TOKEN)
      .expect(422);
    expect(res.body).toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
  });
});
