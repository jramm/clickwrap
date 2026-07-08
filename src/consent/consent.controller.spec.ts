import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { CustomerContext } from '../common/auth/actor';
import { ServiceGuard } from '../common/auth/service.guard';
import { DomainErrorFilter } from '../common/http/domain-error.filter';
import { FixedClock } from '../domain/clock';
import { aCustomer, aDocument, anActiveVersion, aState, aVersion } from '../domain/testing/fixtures';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryNotificationEventRepo,
  InMemoryObjectionRepo,
} from '../persistence/inmemory';
import { AcceptanceService } from './acceptance.service';
import { ConsentController } from './consent.controller';
import { InMemoryEscalationLog } from '../common/escalation/escalation-log.inmemory';
import { InMemoryIdempotencyStore, SequentialIdGenerator } from './inmemory';
import { NotificationService } from './notification.service';
import { ObjectionService } from './objection.service';

const NOW = new Date('2026-07-08T08:00:00Z');
const CONSENT_TEXT = 'I have read the new revision and agree.';

describe('ConsentController', () => {
  let app: INestApplication;
  let authCustomerId: string;

  beforeEach(async () => {
    authCustomerId = 'c-123';
    const documents = new InMemoryAgreementDocumentRepo();
    const versions = new InMemoryAgreementVersionRepo(documents);
    const customers = new InMemoryCustomerRepo();
    const states = new InMemoryCustomerVersionStateRepo();
    const acceptances = new InMemoryAcceptanceRepo();
    const objections = new InMemoryObjectionRepo();
    const events = new InMemoryNotificationEventRepo();
    const idempotency = new InMemoryIdempotencyStore();
    const escalations = new InMemoryEscalationLog();
    const ids = new SequentialIdGenerator();
    const clock = new FixedClock(NOW);

    await documents.save(aDocument({ id: 'doc-dpa-customer', type: 'dpa', audience: 'customer' }));
    await documents.save(aDocument({ id: 'doc-terms-customer', type: 'terms', audience: 'customer' }));
    await customers.save(aCustomer());
    await versions.save(
      anActiveVersion({ id: 'v-1', documentId: 'doc-dpa-customer', consentText: CONSENT_TEXT }),
    );
    await versions.save(
      aVersion({ id: 'v-2', documentId: 'doc-terms-customer', acceptanceMode: 'PASSIVE', objectionPeriodDays: 14 }),
    );
    await states.save(
      aState({
        id: 'cvs-2',
        versionId: 'v-2',
        state: 'NOTIFIED',
        notifiedAt: new Date('2026-07-01T00:00:00Z'),
        deadlineAt: new Date('2026-07-15T00:00:00Z'),
      }),
    );
    await states.save(aState({ id: 'cvs-1', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));

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
    const objectionService = new ObjectionService(
      versions,
      states,
      objections,
      escalations,
      idempotency,
      ids,
      clock,
    );
    const notificationService = new NotificationService(versions, states, events, ids, clock);

    const moduleRef = await Test.createTestingModule({
      controllers: [ConsentController],
      providers: [
        { provide: AcceptanceService, useValue: acceptanceService },
        { provide: ObjectionService, useValue: objectionService },
        { provide: NotificationService, useValue: notificationService },
      ],
    })
      .overrideGuard(ServiceGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext): boolean => {
          const req = ctx.switchToHttp().getRequest<{ customerContext: CustomerContext }>();
          req.customerContext = {
            customerId: authCustomerId,
            actor: { userId: 'u-42', name: 'Jane Doe', email: 'jane@customer.example', portalRole: 'admin' },
            ipAddress: '203.0.113.7',
            userAgent: 'Mozilla/5.0 test',
          };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /acceptances → 201 { acceptanceId, state }', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers/c-123/acceptances')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-1', displayedConsentText: CONSENT_TEXT });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ acceptanceId: expect.any(String), state: 'ACCEPTED' });
  });

  it('POST /acceptances without Idempotency-Key → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers/c-123/acceptances')
      .send({ versionId: 'v-1', displayedConsentText: CONSENT_TEXT });

    expect(res.status).toBe(400);
  });

  it('POST /acceptances with an actor in the body → 400 (strict schema)', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers/c-123/acceptances')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-1', displayedConsentText: CONSENT_TEXT, actor: { userId: 'hacker' } });

    expect(res.status).toBe(400);
  });

  it('POST /acceptances with a deviating text → 422 CONSENT_TEXT_MISMATCH', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers/c-123/acceptances')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-1', displayedConsentText: 'wrong' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CONSENT_TEXT_MISMATCH');
  });

  it('path ≠ auth context → 403 FORBIDDEN', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers/c-999/acceptances')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-1', displayedConsentText: CONSENT_TEXT });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('POST /objections → 201 { objectionId, state }', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers/c-123/objections')
      .set('Idempotency-Key', 'key-1')
      .send({ versionId: 'v-2', reason: 'Sub-processor XY' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ objectionId: expect.any(String), state: 'OBJECTED' });
  });

  it('POST /notifications → 200, notifiedAt = server time', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers/c-123/notifications')
      .send({ versionId: 'v-1', channel: 'PORTAL', displayedAt: '2026-06-01T00:00:00.000Z' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('NOTIFIED');
    expect(new Date(res.body.notifiedAt)).toEqual(NOW);
  });
});
