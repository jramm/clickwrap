/**
 * IntegrationPendingAgreementsController — the (externalRef, audience)-keyed pending-agreements
 * feed used by an upstream system (the metergrid Main Portal) that only knows the customer by its
 * own external reference. Auth is the shared `x-service-token` (ServiceTokenGuard) — no
 * `x-customer-id`, the customer is resolved from the external reference. It delegates to the SAME
 * PendingAgreementsService as the per-customerId popup endpoint. @nestjs/testing + supertest.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainErrorFilter } from '../common/http/domain-error.filter';
import { FixedClock } from '../domain/clock';
import { TOKENS } from '../persistence/tokens';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import { aCustomer, aDocument, aState, anActiveVersion, anAudience } from '../domain/testing/fixtures';
import { IntegrationPendingAgreementsController } from './integration-pending-agreements.controller';
import { PendingAgreementsService } from './pending-agreements.service';
import { FakePdfUrlProvider } from './testing/fake-pdf-url-provider';

const SERVICE_TOKEN = 'test-service-token';
const T0 = new Date('2026-07-07T09:00:00Z');
const DEADLINE = new Date('2026-07-21T09:00:00Z');

describe('IntegrationPendingAgreementsController (e2e)', () => {
  let app: INestApplication;

  beforeAll(() => {
    process.env.SERVICE_API_TOKEN = SERVICE_TOKEN;
  });

  afterAll(() => {
    delete process.env.SERVICE_API_TOKEN;
  });

  beforeEach(async () => {
    const customers = new InMemoryCustomerRepo();
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
    await audiencesRepo.save(anAudience({ id: 'aud-partner', key: 'partner', name: 'Partners' }));
    const document = aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' });
    await documentsRepo.save(document);
    const version = anActiveVersion({
      id: 'v-dpa-c',
      documentId: 'doc-dpa-c',
      versionLabel: 'June 2026 edition',
      changeSummary: 'New sub-processor for e-mail delivery.',
    });
    await versionsRepo.save(version);

    // A customer with an open (blocking) item.
    await customers.save(aCustomer({ id: 'c-pending', externalRef: 'crm-pending', roles: ['customer'] }));
    await statesRepo.save(
      aState({
        id: 'cvs-pending',
        customerId: 'c-pending',
        versionId: 'v-dpa-c',
        state: 'EXPIRED_BLOCKING',
        notifiedAt: T0,
        deadlineAt: DEADLINE,
      }),
    );

    // A compliant customer (state ACCEPTED → nothing outstanding).
    await customers.save(aCustomer({ id: 'c-ok', externalRef: 'crm-ok', roles: ['customer'] }));
    await statesRepo.save(aState({ id: 'cvs-ok', customerId: 'c-ok', versionId: 'v-dpa-c', state: 'ACCEPTED' }));

    // A soft-deleted customer (must resolve to 404).
    await customers.save(aCustomer({ id: 'c-soft', externalRef: 'crm-soft', roles: ['customer'], deletedAt: T0 }));

    // A customer-audience record whose externalRef is also queried for the 'partner' audience
    // (no partner record carries it → 404 for the partner query).
    await customers.save(aCustomer({ id: 'c-shared', externalRef: 'crm-shared', roles: ['customer'] }));

    const moduleRef = await Test.createTestingModule({
      controllers: [IntegrationPendingAgreementsController],
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

  it('401 without a service token', async () => {
    await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-pending/pending-agreements')
      .query({ audience: 'customer' })
      .expect(401);
  });

  it('returns the outstanding items for a customer resolved by (externalRef, audience)', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-pending/pending-agreements')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        versionId: 'v-dpa-c',
        documentType: 'dpa',
        audience: 'customer',
        versionLabel: 'June 2026 edition',
        mode: 'ACTIVE',
        blocking: true,
      }),
    ]);
  });

  it('returns an empty array for a compliant customer', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-ok/pending-agreements')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('404 CUSTOMER_NOT_FOUND for an unknown externalRef', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/by-external-ref/ghost/pending-agreements')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .expect(404);
    expect(res.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('404 CUSTOMER_NOT_FOUND for a soft-deleted match', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-soft/pending-agreements')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .expect(404);
    expect(res.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('404 for a different-audience customer sharing the externalRef', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-shared/pending-agreements')
      .query({ audience: 'partner' })
      .set('x-service-token', SERVICE_TOKEN)
      .expect(404);
    expect(res.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('400 when the audience query param is missing', async () => {
    await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-pending/pending-agreements')
      .set('x-service-token', SERVICE_TOKEN)
      .expect(400);
  });

  it('422 UNKNOWN_AUDIENCE for an audience key that does not exist', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers/by-external-ref/crm-pending/pending-agreements')
      .query({ audience: 'ghost' })
      .set('x-service-token', SERVICE_TOKEN)
      .expect(422);
    expect(res.body).toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
  });
});
