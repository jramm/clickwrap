import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainErrorFilter } from '../common/http/domain-error.filter.js';
import { FixedClock } from '../domain/clock.js';
import { aCustomer, aDocument, anActiveVersion, anAudience, aState, aVersion } from '../domain/testing/fixtures.js';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryNotificationEventRepo,
  InMemoryObjectionRepo,
} from '../persistence/inmemory/index.js';
import { TOKENS } from '../persistence/tokens.js';
import { AcceptanceService } from './acceptance.service.js';
import { ConsentController } from './consent.controller.js';
import { InMemoryEscalationLog } from '../common/escalation/escalation-log.inmemory.js';
import { InMemoryIdempotencyStore, SequentialIdGenerator } from './inmemory.js';
import { NotificationService } from './notification.service.js';
import { ObjectionService } from './objection.service.js';

const NOW = new Date('2026-07-08T08:00:00Z');
const CONSENT_TEXT = 'I have read the new revision and agree.';
const SERVICE_TOKEN = 'test-service-token';

describe('ConsentController', () => {
  let app: INestApplication;

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
    const acceptances = new InMemoryAcceptanceRepo();
    const objections = new InMemoryObjectionRepo();
    const events = new InMemoryNotificationEventRepo();
    const idempotency = new InMemoryIdempotencyStore();
    const escalations = new InMemoryEscalationLog();
    const ids = new SequentialIdGenerator();
    const clock = new FixedClock(NOW);

    await audiences.save(anAudience({ id: 'aud-customer', key: 'customer' }));
    await documents.save(aDocument({ id: 'doc-dpa-customer', type: 'dpa', audience: 'customer' }));
    await documents.save(aDocument({ id: 'doc-terms-customer', type: 'terms', audience: 'customer' }));
    await customers.save(aCustomer({ id: 'c-123', externalRef: 'crm-123', roles: ['customer'] }));
    await versions.save(anActiveVersion({ id: 'v-1', documentId: 'doc-dpa-customer', consentText: CONSENT_TEXT }));
    await versions.save(aVersion({ id: 'v-2', documentId: 'doc-terms-customer', acceptanceMode: 'PASSIVE', objectionPeriodDays: 14 }));
    await states.save(
      aState({ id: 'cvs-2', versionId: 'v-2', state: 'NOTIFIED', notifiedAt: new Date('2026-07-01T00:00:00Z'), deadlineAt: new Date('2026-07-15T00:00:00Z') }),
    );
    await states.save(aState({ id: 'cvs-1', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));

    const acceptanceService = new AcceptanceService(versions, documents, customers, states, acceptances, idempotency, ids, clock);
    const objectionService = new ObjectionService(versions, states, objections, escalations, idempotency, ids, clock);
    const notificationService = new NotificationService(versions, states, events, ids, clock);

    const moduleRef = await Test.createTestingModule({
      controllers: [ConsentController],
      providers: [
        { provide: AcceptanceService, useValue: acceptanceService },
        { provide: ObjectionService, useValue: objectionService },
        { provide: NotificationService, useValue: notificationService },
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

  const post = (path: string) => request(app.getHttpServer()).post(path).set('x-service-token', SERVICE_TOKEN).set('x-actor-user-id', 'u-42');

  it('POST /customers/acceptances?customerId=... → 201 { acceptanceId, state }', async () => {
    const res = await post('/customers/acceptances?customerId=c-123')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-1', displayedConsentText: CONSENT_TEXT });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ acceptanceId: expect.any(String), state: 'ACCEPTED' });
  });

  it('POST /customers/acceptances?externalRef=...&audience=... → 201', async () => {
    const res = await post('/customers/acceptances?externalRef=crm-123&audience=customer')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-1', displayedConsentText: CONSENT_TEXT });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ acceptanceId: expect.any(String), state: 'ACCEPTED' });
  });

  it('400 when neither customerId nor externalRef is provided', async () => {
    const res = await post('/customers/acceptances')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-1', displayedConsentText: CONSENT_TEXT });
    expect(res.status).toBe(400);
  });

  it('404 CUSTOMER_NOT_FOUND for an unknown customerId', async () => {
    const res = await post('/customers/acceptances?customerId=c-ghost')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-1', displayedConsentText: CONSENT_TEXT });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('POST /customers/acceptances without Idempotency-Key → 400', async () => {
    const res = await post('/customers/acceptances?customerId=c-123').send({ versionId: 'v-1', displayedConsentText: CONSENT_TEXT });
    expect(res.status).toBe(400);
  });

  it('POST /customers/acceptances with an actor in the body → 400 (strict schema)', async () => {
    const res = await post('/customers/acceptances?customerId=c-123')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-1', displayedConsentText: CONSENT_TEXT, actor: { userId: 'hacker' } });
    expect(res.status).toBe(400);
  });

  it('POST /customers/acceptances with a deviating text → 422 CONSENT_TEXT_MISMATCH', async () => {
    const res = await post('/customers/acceptances?customerId=c-123')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-1', displayedConsentText: 'wrong' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CONSENT_TEXT_MISMATCH');
  });

  it('POST /customers/objections?customerId=... → 201 { objectionId, state }', async () => {
    const res = await post('/customers/objections?customerId=c-123')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-2', reason: 'Sub-processor XY' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ objectionId: expect.any(String), state: 'OBJECTED' });
  });

  it('POST /customers/notifications?customerId=... → 200, notifiedAt = server time', async () => {
    const res = await post('/customers/notifications?customerId=c-123').send({
      versionId: 'v-1',
      channel: 'PORTAL',
      displayedAt: '2026-06-01T00:00:00.000Z',
    });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('NOTIFIED');
    expect(new Date(res.body.notifiedAt)).toEqual(NOW);
  });
});
