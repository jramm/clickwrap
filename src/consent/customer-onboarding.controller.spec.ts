import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { InMemoryAdminAuditRepo, ADMIN_AUDIT_TOKEN } from '../agreements/audit';
import { AGREEMENTS_TOKENS, type RolloutNotifier } from '../agreements/ports';
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
  let notified: string[];

  beforeEach(async () => {
    process.env.SERVICE_API_TOKEN = SERVICE_TOKEN;
    const documents = new InMemoryAgreementDocumentRepo();
    customers = new InMemoryCustomerRepo();
    const audiences = new InMemoryAudienceRepo(documents, customers);
    const versions = new InMemoryAgreementVersionRepo(documents);
    const states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    audit = new InMemoryAdminAuditRepo();
    notified = [];
    const notifier: RolloutNotifier = {
      async notifyVersionPublished(_customer, version) {
        notified.push(version.id);
      },
      async remind() {
        /* unused */
      },
    };
    await audiences.save(anAudience({ id: 'aud-customer', key: 'customer', name: 'Customers' }));
    await audiences.save(anAudience({ id: 'aud-partner', key: 'partner', name: 'Partners' }));
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
        { provide: AGREEMENTS_TOKENS.RolloutNotifier, useValue: notifier },
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
      .send({ externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: ['legal@acme.io'] })
      .expect(201);
    expect(res.body).toMatchObject({
      externalRef: 'ext-1',
      companyName: 'Acme',
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

  describe('PUT /customers/by-external-ref/:externalRef (inbound upsert)', () => {
    const body = { companyName: 'Acme', roles: ['customer'], contactEmails: ['legal@acme.io'], source: 'mainportal' };

    it('401 without a service token', async () => {
      await request(app.getHttpServer()).put('/customers/by-external-ref/crm-1').send(body).expect(401);
    });

    it('returns 200 and the customer row, and is idempotent across two identical calls', async () => {
      const first = await request(app.getHttpServer())
        .put('/customers/by-external-ref/crm-1')
        .set('x-service-token', SERVICE_TOKEN)
        .send(body)
        .expect(200);
      expect(first.body).toMatchObject({ externalRef: 'crm-1', companyName: 'Acme', roles: ['customer'] });
      expect(first.body).not.toHaveProperty('importedAcceptances');

      const second = await request(app.getHttpServer())
        .put('/customers/by-external-ref/crm-1')
        .set('x-service-token', SERVICE_TOKEN)
        .send(body)
        .expect(200);
      expect(second.body.id).toBe(first.body.id);
      // Only one customer exists for this externalRef.
      expect(await customers.findAllByExternalRef('crm-1')).toHaveLength(1);
    });

    it('unknown role → 422 UNKNOWN_AUDIENCE', async () => {
      const res = await request(app.getHttpServer())
        .put('/customers/by-external-ref/crm-1')
        .set('x-service-token', SERVICE_TOKEN)
        .send({ roles: ['ghost'], contactEmails: [] })
        .expect(422);
      expect(res.body).toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
    });

    it('rejects unknown body fields with 400 (strict schema)', async () => {
      await request(app.getHttpServer())
        .put('/customers/by-external-ref/crm-1')
        .set('x-service-token', SERVICE_TOKEN)
        .send({ roles: [], contactEmails: [], actorUserId: 'evil' })
        .expect(400);
    });

    it('creates separate records for different audiences sharing an externalRef (resolution is by audience, not source)', async () => {
      const asCustomer = await request(app.getHttpServer())
        .put('/customers/by-external-ref/crm-1')
        .set('x-service-token', SERVICE_TOKEN)
        .send({ roles: ['customer'], contactEmails: [], source: 'mainportal' })
        .expect(200);
      const asPartner = await request(app.getHttpServer())
        .put('/customers/by-external-ref/crm-1')
        .set('x-service-token', SERVICE_TOKEN)
        .send({ roles: ['partner'], contactEmails: [], source: 'mainportal' })
        .expect(200);
      expect(asPartner.body.id).not.toBe(asCustomer.body.id);
      expect(await customers.findAllByExternalRef('crm-1')).toHaveLength(2);
    });
  });

  describe('DELETE /customers/by-external-ref/:externalRef (inbound deactivate)', () => {
    it('401 without a service token', async () => {
      await request(app.getHttpServer()).delete('/customers/by-external-ref/crm-1?audience=customer').expect(401);
    });

    it('returns 204 and soft-deletes, and is idempotent on a second call', async () => {
      await request(app.getHttpServer())
        .put('/customers/by-external-ref/crm-1')
        .set('x-service-token', SERVICE_TOKEN)
        .send({ roles: ['customer'], contactEmails: [], source: 'mainportal' })
        .expect(200);

      await request(app.getHttpServer())
        .delete('/customers/by-external-ref/crm-1?audience=customer')
        .set('x-service-token', SERVICE_TOKEN)
        .expect(204);
      const deleted = (await customers.findAllByExternalRef('crm-1'))[0];
      expect(deleted?.deletedAt).toBeDefined();

      // Idempotent: a second call still 204.
      await request(app.getHttpServer())
        .delete('/customers/by-external-ref/crm-1?audience=customer')
        .set('x-service-token', SERVICE_TOKEN)
        .expect(204);
    });

    it('returns 204 for an unknown externalRef (idempotent no-op)', async () => {
      await request(app.getHttpServer())
        .delete('/customers/by-external-ref/ghost?audience=customer')
        .set('x-service-token', SERVICE_TOKEN)
        .expect(204);
    });

    it('returns 400 when the audience query param is missing', async () => {
      await request(app.getHttpServer())
        .delete('/customers/by-external-ref/crm-1')
        .set('x-service-token', SERVICE_TOKEN)
        .expect(400);
    });

    it('scopes by audience: leaves a different-audience customer sharing the externalRef untouched', async () => {
      const asCustomer = await request(app.getHttpServer())
        .put('/customers/by-external-ref/crm-1')
        .set('x-service-token', SERVICE_TOKEN)
        .send({ roles: ['customer'], contactEmails: [], source: 'mainportal' })
        .expect(200);
      const asPartner = await request(app.getHttpServer())
        .put('/customers/by-external-ref/crm-1')
        .set('x-service-token', SERVICE_TOKEN)
        .send({ roles: ['partner'], contactEmails: [], source: 'mainportal' })
        .expect(200);

      await request(app.getHttpServer())
        .delete('/customers/by-external-ref/crm-1?audience=partner')
        .set('x-service-token', SERVICE_TOKEN)
        .expect(204);
      expect((await customers.findById(asPartner.body.id))?.deletedAt).toBeDefined();
      expect((await customers.findById(asCustomer.body.id))?.deletedAt).toBeUndefined();
    });
  });
});
