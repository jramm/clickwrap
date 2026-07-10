/**
 * IntegrationAcceptanceController — the (externalRef, audience)-keyed accept endpoint used by an
 * upstream system (the metergrid Main Portal) that only knows the customer by its own external
 * reference. Auth is the shared `x-service-token` (ServiceTokenGuard) — no `x-customer-id`, the
 * customer is resolved from the external reference. It reuses the SAME AcceptanceService as the
 * per-customerId accept route (idempotency, version-current + consent-text rules). The portal
 * user's identity is carried by the body (`signerName`/`signerEmail`) and/or the `x-actor-*`
 * headers; channel = PORTAL. @nestjs/testing + supertest with a real ServiceTokenGuard.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainErrorFilter } from '../common/http/domain-error.filter';
import { FixedClock } from '../domain/clock';
import { TOKENS } from '../persistence/tokens';
import { aCustomer, aDocument, aState, aVersion, anActiveVersion, anAudience } from '../domain/testing/fixtures';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import { AcceptanceService } from './acceptance.service';
import { IntegrationAcceptanceController } from './integration-acceptance.controller';
import { InMemoryIdempotencyStore, SequentialIdGenerator } from './inmemory';

const SERVICE_TOKEN = 'test-service-token';
const NOW = new Date('2026-07-08T08:00:00Z');
const CONSENT_TEXT = 'I have read the new revision and agree.';

describe('IntegrationAcceptanceController (e2e)', () => {
  let app: INestApplication;
  let acceptances: InMemoryAcceptanceRepo;

  beforeAll(() => {
    process.env.SERVICE_API_TOKEN = SERVICE_TOKEN;
  });

  afterAll(() => {
    delete process.env.SERVICE_API_TOKEN;
  });

  beforeEach(async () => {
    const documents = new InMemoryAgreementDocumentRepo();
    const versions = new InMemoryAgreementVersionRepo(documents);
    const customers = new InMemoryCustomerRepo();
    const audiences = new InMemoryAudienceRepo(documents, customers);
    const states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    const idempotency = new InMemoryIdempotencyStore();
    const ids = new SequentialIdGenerator();
    const clock = new FixedClock(NOW);

    await audiences.save(anAudience({ id: 'aud-customer', key: 'customer' }));
    await documents.save(aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' }));
    // Current ACTIVE version (validFrom 2026-07-01 <= NOW → current).
    await versions.save(anActiveVersion({ id: 'v-cur', documentId: 'doc-dpa-c', consentText: CONSENT_TEXT }));
    // A stale DRAFT of the same document → VERSION_NOT_CURRENT when accepted.
    await versions.save(aVersion({ id: 'v-stale', documentId: 'doc-dpa-c', status: 'DRAFT' }));

    await customers.save(aCustomer({ id: 'c-1', externalRef: 'crm-1', roles: ['customer'] }));
    await states.save(aState({ id: 'cvs-1', customerId: 'c-1', versionId: 'v-cur', state: 'PENDING_NOTIFICATION' }));

    const acceptanceService = new AcceptanceService(
      versions,
      documents,
      customers,
      states,
      acceptances,
      idempotency,
      ids,
      clock,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [IntegrationAcceptanceController],
      providers: [
        { provide: AcceptanceService, useValue: acceptanceService },
        { provide: TOKENS.CustomerRepo, useValue: customers },
        { provide: TOKENS.AudienceRepo, useValue: audiences },
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
      .post('/customers/by-external-ref/crm-1/acceptances')
      .query({ audience: 'customer' })
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-cur', displayedConsentText: CONSENT_TEXT })
      .expect(401);
  });

  it('records the acceptance (201 { acceptanceId, state }) with the portal user identity', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers/by-external-ref/crm-1/acceptances')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-actor-user-id', 'portal-user-1')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-cur', signerName: 'Bob Portal', signerEmail: 'bob@operator.example', displayedConsentText: CONSENT_TEXT })
      .expect(201);
    expect(res.body).toEqual({ acceptanceId: expect.any(String), state: 'ACCEPTED' });

    const stored = await acceptances.findEffective('c-1', 'v-cur');
    expect(stored).toBeDefined();
    expect(stored?.channel).toBe('PORTAL');
    expect(stored?.actor).toMatchObject({ userId: 'portal-user-1', name: 'Bob Portal', email: 'bob@operator.example' });
  });

  it('replays the identical response for the same Idempotency-Key', async () => {
    const first = await request(app.getHttpServer())
      .post('/customers/by-external-ref/crm-1/acceptances')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-actor-user-id', 'portal-user-1')
      .set('Idempotency-Key', 'key-replay')
      .send({ versionId: 'v-cur', displayedConsentText: CONSENT_TEXT })
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post('/customers/by-external-ref/crm-1/acceptances')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-actor-user-id', 'portal-user-1')
      .set('Idempotency-Key', 'key-replay')
      .send({ versionId: 'v-cur', displayedConsentText: CONSENT_TEXT })
      .expect(201);

    expect(replay.body).toEqual(first.body);
  });

  it('422 VERSION_NOT_CURRENT for a stale version', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers/by-external-ref/crm-1/acceptances')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-actor-user-id', 'portal-user-1')
      .set('Idempotency-Key', 'key-stale')
      .send({ versionId: 'v-stale', displayedConsentText: CONSENT_TEXT })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'VERSION_NOT_CURRENT' });
  });

  it('422 CONSENT_TEXT_MISMATCH for an ACTIVE version with a deviating text', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers/by-external-ref/crm-1/acceptances')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-actor-user-id', 'portal-user-1')
      .set('Idempotency-Key', 'key-mismatch')
      .send({ versionId: 'v-cur', displayedConsentText: 'wrong text' })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'CONSENT_TEXT_MISMATCH' });
  });

  it('404 CUSTOMER_NOT_FOUND for an unknown externalRef', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers/by-external-ref/ghost/acceptances')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-actor-user-id', 'portal-user-1')
      .set('Idempotency-Key', 'key-ghost')
      .send({ versionId: 'v-cur', displayedConsentText: CONSENT_TEXT })
      .expect(404);
    expect(res.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('400 when the audience query param is missing', async () => {
    await request(app.getHttpServer())
      .post('/customers/by-external-ref/crm-1/acceptances')
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-actor-user-id', 'portal-user-1')
      .set('Idempotency-Key', 'key-noaud')
      .send({ versionId: 'v-cur', displayedConsentText: CONSENT_TEXT })
      .expect(400);
  });

  it('400 when the Idempotency-Key header is missing', async () => {
    await request(app.getHttpServer())
      .post('/customers/by-external-ref/crm-1/acceptances')
      .query({ audience: 'customer' })
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-actor-user-id', 'portal-user-1')
      .send({ versionId: 'v-cur', displayedConsentText: CONSENT_TEXT })
      .expect(400);
  });

  it('422 UNKNOWN_AUDIENCE for an audience key that does not exist', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers/by-external-ref/crm-1/acceptances')
      .query({ audience: 'ghost' })
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-actor-user-id', 'portal-user-1')
      .set('Idempotency-Key', 'key-badaud')
      .send({ versionId: 'v-cur', displayedConsentText: CONSENT_TEXT })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
  });
});
