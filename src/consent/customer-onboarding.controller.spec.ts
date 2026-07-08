import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { InMemoryAdminAuditRepo, ADMIN_AUDIT_TOKEN } from '../agreements/audit';
import { DomainErrorFilter } from '../common/http/domain-error.filter';
import { FixedClock } from '../domain/clock';
import { anAudience, aVersion } from '../domain/testing/fixtures';
import { CustomerAdminService } from '../customers/customer-admin.service';
import { TOKENS } from '../persistence/tokens';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import { CustomerOnboardingController } from './customer-onboarding.controller';

const T0 = new Date('2026-07-07T09:00:00Z');
const SERVICE_TOKEN = 'onboarding-service-token';

describe('CustomerOnboardingController (integration surface)', () => {
  let app: INestApplication;
  let customers: InMemoryCustomerRepo;
  let acceptances: InMemoryAcceptanceRepo;
  let audit: InMemoryAdminAuditRepo;

  beforeEach(async () => {
    process.env.SERVICE_API_TOKEN = SERVICE_TOKEN;
    const documents = new InMemoryAgreementDocumentRepo();
    customers = new InMemoryCustomerRepo();
    const audiences = new InMemoryAudienceRepo(documents, customers);
    const versions = new InMemoryAgreementVersionRepo(documents);
    const states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    audit = new InMemoryAdminAuditRepo();
    await audiences.save(anAudience({ id: 'aud-customer', key: 'customer', name: 'Customers' }));
    await documents.save({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
    await versions.save(aVersion({ id: 'v-pub', documentId: 'doc-dpa-c', status: 'PUBLISHED' }));

    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerOnboardingController],
      providers: [
        CustomerAdminService,
        { provide: TOKENS.CustomerRepo, useValue: customers },
        { provide: TOKENS.AudienceRepo, useValue: audiences },
        { provide: TOKENS.AgreementVersionRepo, useValue: versions },
        { provide: TOKENS.AgreementDocumentRepo, useValue: documents },
        { provide: TOKENS.CustomerVersionStateRepo, useValue: states },
        { provide: TOKENS.AcceptanceRepo, useValue: acceptances },
        { provide: ADMIN_AUDIT_TOKEN, useValue: audit },
        { provide: TOKENS.Clock, useValue: new FixedClock(T0) },
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
      .post('/customers')
      .send({ externalRef: 'ext-1', roles: [], contactEmails: [] })
      .expect(401);
  });

  it('creates a customer (201) with the service token — no x-customer-id needed', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .set('x-service-token', SERVICE_TOKEN)
      .send({ externalRef: 'ext-1', name: 'Acme', roles: ['customer'], contactEmails: ['legal@acme.io'] })
      .expect(201);
    expect(res.body).toMatchObject({
      externalRef: 'ext-1',
      name: 'Acme',
      roles: ['customer'],
      contactEmails: ['legal@acme.io'],
      importedAcceptances: [],
    });
    // Audit entry records the integration source and the forwarded/service actor.
    expect((await audit.findByTarget('Customer', res.body.id))[0]).toMatchObject({
      action: 'CUSTOMER_CREATE',
      actor: 'service',
      metadata: expect.objectContaining({ source: 'integration' }),
    });
  });

  it('uses the forwarded x-actor-user-id as the audit/evidence actor', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .set('x-service-token', SERVICE_TOKEN)
      .set('x-actor-user-id', 'sales-1')
      .send({
        externalRef: 'ext-2',
        roles: ['customer'],
        contactEmails: [],
        acceptedVersions: [{ versionId: 'v-pub', acceptedAt: '2026-07-01T00:00:00Z', reference: 'HubSpot deal 12345' }],
      })
      .expect(201);
    expect((await audit.findByTarget('Customer', res.body.id))[0]).toMatchObject({ actor: 'sales-1' });
    const [acceptance] = await acceptances.findByCustomer(res.body.id);
    expect(acceptance).toMatchObject({
      method: 'IMPORT',
      channel: 'ADMIN',
      evidenceNote: 'HubSpot deal 12345',
      acceptedAt: new Date('2026-07-01T00:00:00Z'),
    });
    expect(acceptance.actor).toMatchObject({ userId: 'sales-1' });
  });

  it('duplicate externalRef within the same audience → 422 INVALID_STATE (idempotency signal for integrators)', async () => {
    await request(app.getHttpServer())
      .post('/customers')
      .set('x-service-token', SERVICE_TOKEN)
      .send({ externalRef: 'ext-1', roles: ['customer'], contactEmails: [] })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/customers')
      .set('x-service-token', SERVICE_TOKEN)
      .send({ externalRef: 'ext-1', roles: ['customer'], contactEmails: [] })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects unknown body fields with 400 (strict schema — actor cannot come from the body)', async () => {
    await request(app.getHttpServer())
      .post('/customers')
      .set('x-service-token', SERVICE_TOKEN)
      .send({ externalRef: 'ext-1', roles: [], contactEmails: [], actorUserId: 'evil' })
      .expect(400);
  });
});
