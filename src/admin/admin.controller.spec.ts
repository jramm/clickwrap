import { INestApplication, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AcceptanceLinkAdminService } from '../accept/acceptance-link-admin.service';
import { InMemoryAdminAuditRepo } from '../agreements/audit';
import { ADMIN_AUDIT_TOKEN } from '../agreements/audit';
import { InMemoryPdfStorage } from '../agreements/pdf-storage.inmemory';
import { AGREEMENTS_TOKENS } from '../agreements/ports';
import { PublishService } from '../agreements/publish.service';
import { InMemoryRolloutNotifier } from '../agreements/rollout-notifier.inmemory';
import { AdminGuard } from '../common/auth/admin.guard';
import { DomainErrorFilter } from '../common/http/domain-error.filter';
import { FixedClock } from '../domain/clock';
import {
  aCustomer,
  aDocument,
  aDocumentTypeDef,
  anAudience,
  aState,
  aVersion,
  anActiveVersion,
} from '../domain/testing/fixtures';
import { TOKENS } from '../persistence/tokens';
import {
  InMemoryAcceptanceLinkRepo,
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryDocumentTypeRepo,
  InMemoryEmailTemplateRepo,
  InMemoryNotificationEventRepo,
  InMemoryObjectionRepo,
  InMemorySignedDocumentRepo,
} from '../persistence/inmemory';
import { CustomerAdminService } from '../customers/customer-admin.service';
import { AdminController } from './admin.controller';
import { AudienceAdminService } from './audience-admin.service';
import { CustomerVersionStateAdminService } from './customer-version-state-admin.service';
import { DocumentTypeAdminService } from './document-type-admin.service';
import { EmailTemplateAdminService } from './email-template-admin.service';
import { HistoryService } from './history.service';
import { ManualAcceptanceService } from './manual-acceptance.service';
import { DashboardService } from './dashboard.service';
import { OverviewService } from './overview.service';
import { VersionCustomersService } from './version-customers.service';

const T0 = new Date('2026-07-07T09:00:00Z');
const EVIDENCE_BASE64 = Buffer.from('letter-scan').toString('base64');

const allowAdmin: CanActivate = {
  canActivate: (ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest().adminActor = { userId: 'admin-1' };
    return true;
  },
};

describe('AdminController', () => {
  let app: INestApplication;
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let customers: InMemoryCustomerRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let acceptances: InMemoryAcceptanceRepo;
  let objections: InMemoryObjectionRepo;
  let notifications: InMemoryNotificationEventRepo;
  let notifier: InMemoryRolloutNotifier;
  let audit: InMemoryAdminAuditRepo;
  let audiences: InMemoryAudienceRepo;
  let documentTypes: InMemoryDocumentTypeRepo;
  let emailTemplates: InMemoryEmailTemplateRepo;
  let acceptanceLinks: InMemoryAcceptanceLinkRepo;
  const publicBaseUrlBackup = process.env.PUBLIC_BASE_URL;

  beforeEach(async () => {
    process.env.PUBLIC_BASE_URL = 'https://clickwrap.example.org';
    acceptanceLinks = new InMemoryAcceptanceLinkRepo();
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    customers = new InMemoryCustomerRepo();
    states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    objections = new InMemoryObjectionRepo();
    notifications = new InMemoryNotificationEventRepo();
    notifier = new InMemoryRolloutNotifier();
    audit = new InMemoryAdminAuditRepo();
    audiences = new InMemoryAudienceRepo(documents, customers);
    documentTypes = new InMemoryDocumentTypeRepo(documents);
    emailTemplates = new InMemoryEmailTemplateRepo(documentTypes);

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        PublishService,
        OverviewService,
        DashboardService,
        VersionCustomersService,
        HistoryService,
        ManualAcceptanceService,
        CustomerVersionStateAdminService,
        AudienceAdminService,
        DocumentTypeAdminService,
        EmailTemplateAdminService,
        CustomerAdminService,
        AcceptanceLinkAdminService,
        { provide: TOKENS.AcceptanceLinkRepo, useValue: acceptanceLinks },
        { provide: TOKENS.EmailTemplateRepo, useValue: emailTemplates },
        { provide: TOKENS.AgreementDocumentRepo, useValue: documents },
        { provide: TOKENS.AgreementVersionRepo, useValue: versions },
        { provide: TOKENS.CustomerRepo, useValue: customers },
        { provide: TOKENS.CustomerVersionStateRepo, useValue: states },
        { provide: TOKENS.AcceptanceRepo, useValue: acceptances },
        { provide: TOKENS.ObjectionRepo, useValue: objections },
        { provide: TOKENS.NotificationEventRepo, useValue: notifications },
        { provide: TOKENS.AudienceRepo, useValue: audiences },
        { provide: TOKENS.DocumentTypeRepo, useValue: documentTypes },
        { provide: TOKENS.SignedDocumentRepo, useValue: new InMemorySignedDocumentRepo() },
        { provide: TOKENS.Clock, useValue: new FixedClock(T0) },
        { provide: AGREEMENTS_TOKENS.PdfStorage, useValue: new InMemoryPdfStorage() },
        { provide: AGREEMENTS_TOKENS.RolloutNotifier, useValue: notifier },
        { provide: ADMIN_AUDIT_TOKEN, useValue: audit },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue(allowAdmin)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();

    await documents.save(aDocument({ id: 'doc-dpa-customer', type: 'dpa', audience: 'customer', name: 'DPA — Customers' }));
  });

  afterEach(async () => {
    if (publicBaseUrlBackup === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = publicBaseUrlBackup;
    }
    await app.close();
  });

  it('POST /admin/customers/:id/acceptance-links mints a capability URL + audit entry', async () => {
    await customers.save(aCustomer({ id: 'c-123', roles: ['customer'] }));

    const res = await request(app.getHttpServer())
      .post('/admin/customers/c-123/acceptance-links')
      .send({})
      .expect(201);
    expect(res.body.url).toMatch(/^https:\/\/clickwrap\.example\.org\/accept\/[A-Za-z0-9_-]{43}$/);
    expect(res.body.linkId).toMatch(/^al-/);
    expect((await audit.findByTarget('AcceptanceLink', res.body.linkId))[0]).toMatchObject({
      action: 'ACCEPTANCE_LINK_CREATE',
      actor: 'admin-1',
    });
  });

  it('POST /admin/customers/:id/acceptance-links without PUBLIC_BASE_URL → 422 with actionable message', async () => {
    process.env.PUBLIC_BASE_URL = '';
    await customers.save(aCustomer({ id: 'c-123', roles: ['customer'] }));

    const res = await request(app.getHttpServer())
      .post('/admin/customers/c-123/acceptance-links')
      .send({})
      .expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_STATE', message: expect.stringContaining('PUBLIC_BASE_URL') });
  });

  it('POST /admin/customers/:id/acceptance-links unknown customer → 404 CUSTOMER_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/customers/c-unknown/acceptance-links')
      .send({ expiresInDays: 7 })
      .expect(404);
    expect(res.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('POST /admin/versions/:id/publish publishes + rollout + audit', async () => {
    await versions.save(anActiveVersion({ id: 'v-1', documentId: 'doc-dpa-customer', status: 'DRAFT' }));
    await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));

    const res = await request(app.getHttpServer()).post('/admin/versions/v-1/publish').expect(201);
    expect(res.body).toMatchObject({ versionId: 'v-1', status: 'PUBLISHED', rolloutCustomers: 1 });
    expect((await audit.findByTarget('AgreementVersion', 'v-1'))[0]).toMatchObject({ action: 'PUBLISH', actor: 'admin-1' });
  });

  it('GET /admin/overview?filter=non_compliant returns only blocked customers', async () => {
    await versions.save(anActiveVersion({ id: 'v-1', documentId: 'doc-dpa-customer', status: 'PUBLISHED', validFrom: new Date('2026-07-01T00:00:00Z') }));
    await customers.save(aCustomer({ id: 'c-blocked', roles: ['customer'] }));
    await customers.save(aCustomer({ id: 'c-ok', roles: ['customer'] }));
    await states.save(aState({ id: 'cvs-b', customerId: 'c-blocked', versionId: 'v-1', state: 'EXPIRED_BLOCKING' }));

    const res = await request(app.getHttpServer()).get('/admin/overview?filter=non_compliant').expect(200);
    expect(res.body.items.map((r: { customerId: string }) => r.customerId)).toEqual(['c-blocked']);
  });

  it('GET /admin/overview?search filters rows by customer name/externalRef/e-mail', async () => {
    await versions.save(anActiveVersion({ id: 'v-1', documentId: 'doc-dpa-customer', status: 'PUBLISHED', validFrom: new Date('2026-07-01T00:00:00Z') }));
    await customers.save(aCustomer({ id: 'c-acme', companyName: 'Acme GmbH', externalRef: 'crm-4711', roles: ['customer'] }));
    await customers.save(aCustomer({ id: 'c-globex', companyName: 'Globex Corp', externalRef: 'crm-8000', roles: ['customer'] }));

    const res = await request(app.getHttpServer()).get('/admin/overview?search=globex').expect(200);
    expect(res.body.items.map((r: { customerId: string }) => r.customerId)).toEqual(['c-globex']);
    expect(res.body.total).toBe(1);
  });

  it('GET /admin/dashboard returns per-version stats for the current published version', async () => {
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-customer', versionLabel: 'June 2026 edition', status: 'PUBLISHED', validFrom: new Date('2026-07-01T00:00:00Z') }));
    await customers.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
    await states.save(aState({ id: 'cvs-1', customerId: 'c-1', versionId: 'v-1', state: 'ACCEPTED' }));
    await acceptances.append({ id: 'a-1', customerId: 'c-1', versionId: 'v-1', method: 'ACTIVE_CONSENT', channel: 'PORTAL', acceptedAt: T0, actor: { userId: 'u-1' }, isEffective: true });

    const res = await request(app.getHttpServer()).get('/admin/dashboard').expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      versionId: 'v-1',
      documentName: 'DPA — Customers',
      documentType: 'dpa',
      upcoming: false,
      stats: { totalCustomers: 1, accepted: 1, acceptanceRate: 1, acceptedByChannel: { PORTAL: 1 } },
    });
  });

  it('GET /admin/versions/:id/stats returns the counters for a single version', async () => {
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-customer', status: 'PUBLISHED', validFrom: new Date('2026-07-01T00:00:00Z') }));
    await states.save(aState({ id: 'cvs-1', customerId: 'c-1', versionId: 'v-1', state: 'OBJECTED' }));

    const res = await request(app.getHttpServer()).get('/admin/versions/v-1/stats').expect(200);
    expect(res.body).toMatchObject({ versionId: 'v-1', stats: { totalCustomers: 1, objected: 1, accepted: 0 } });
  });

  it('GET /admin/versions/:id/stats unknown id → 404 VERSION_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/admin/versions/v-unknown/stats').expect(404);
    expect(res.body).toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('GET /admin/versions/:id/customers reports the state FOR THAT version (drill-down bug fix)', async () => {
    // Customer accepted the CURRENT version but is only pending on the UPCOMING one.
    await versions.save(aVersion({ id: 'v-current', documentId: 'doc-dpa-customer', versionLabel: 'June 2026 edition', status: 'PUBLISHED', validFrom: new Date('2026-06-01T00:00:00Z') }));
    await versions.save(aVersion({ id: 'v-upcoming', documentId: 'doc-dpa-customer', versionLabel: 'August 2026 edition', status: 'PUBLISHED', validFrom: new Date('2026-08-01T00:00:00Z') }));
    await customers.save(aCustomer({ id: 'c-1', companyName: 'Acme GmbH', roles: ['customer'] }));
    await states.save(aState({ id: 'cvs-cur', customerId: 'c-1', versionId: 'v-current', state: 'ACCEPTED' }));
    await acceptances.append({ id: 'a-cur', customerId: 'c-1', versionId: 'v-current', method: 'ACTIVE_CONSENT', channel: 'PORTAL', acceptedAt: T0, actor: { userId: 'u-1', name: 'Jane Doe' }, isEffective: true });
    await states.save(aState({ id: 'cvs-up', customerId: 'c-1', versionId: 'v-upcoming', state: 'PENDING_NOTIFICATION' }));

    const upcoming = await request(app.getHttpServer()).get('/admin/versions/v-upcoming/customers').expect(200);
    expect(upcoming.body.items).toEqual([expect.objectContaining({ customerId: 'c-1', state: 'PENDING_NOTIFICATION' })]);
    expect(upcoming.body.items[0].acceptance).toBeUndefined();
    expect(upcoming.body.stats).toMatchObject({ versionId: 'v-upcoming', versionLabel: 'August 2026 edition', upcoming: true });

    const current = await request(app.getHttpServer()).get('/admin/versions/v-current/customers').expect(200);
    expect(current.body.items[0]).toMatchObject({ customerId: 'c-1', state: 'ACCEPTED' });
    expect(current.body.items[0].acceptance).toMatchObject({ method: 'ACTIVE_CONSENT', channel: 'PORTAL', actorName: 'Jane Doe' });
  });

  it('GET /admin/versions/:id/customers?state=accepted filters and unknown id → 404', async () => {
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-customer', status: 'PUBLISHED', validFrom: new Date('2026-06-01T00:00:00Z') }));
    await customers.save(aCustomer({ id: 'c-acc', companyName: 'Accepted Co', roles: ['customer'] }));
    await customers.save(aCustomer({ id: 'c-pend', companyName: 'Pending Co', roles: ['customer'] }));
    await states.save(aState({ id: 's-acc', customerId: 'c-acc', versionId: 'v-1', state: 'ACCEPTED' }));
    await states.save(aState({ id: 's-pend', customerId: 'c-pend', versionId: 'v-1', state: 'NOTIFIED' }));

    const res = await request(app.getHttpServer()).get('/admin/versions/v-1/customers?state=accepted').expect(200);
    expect(res.body.items.map((r: { customerId: string }) => r.customerId)).toEqual(['c-acc']);

    const missing = await request(app.getHttpServer()).get('/admin/versions/v-unknown/customers').expect(404);
    expect(missing.body).toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('GET /admin/customers/:id/history returns the history', async () => {
    await customers.save(aCustomer({ id: 'c-123', roles: ['customer'] }));
    const res = await request(app.getHttpServer()).get('/admin/customers/c-123/history').expect(200);
    expect(res.body).toMatchObject({ acceptances: [], objections: [], notifications: [] });
  });

  it('GET /admin/customers/:id/history unknown customer → 404 CUSTOMER_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/admin/customers/c-unknown/history').expect(404);
    expect(res.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('POST /admin/customers/:id/acceptances records retroactively (201) and writes an audit log', async () => {
    await versions.save(anActiveVersion({ id: 'v-1', documentId: 'doc-dpa-customer', status: 'PUBLISHED' }));
    await customers.save(aCustomer({ id: 'c-123', roles: ['customer'] }));

    const res = await request(app.getHttpServer())
      .post('/admin/customers/c-123/acceptances')
      .send({ versionId: 'v-1', method: 'IMPORT', reason: 'by letter', evidenceDocument: EVIDENCE_BASE64, evidenceFileName: 'letter.pdf' })
      .expect(201);
    expect(res.body).toMatchObject({ state: 'ACCEPTED' });
    expect((await audit.findAll()).some((l) => l.action === 'MANUAL_ACCEPTANCE')).toBe(true);
  });

  it('POST /admin/customers/:id/acceptances WITHOUT evidenceDocument → 422, no acceptance', async () => {
    await versions.save(anActiveVersion({ id: 'v-1', documentId: 'doc-dpa-customer', status: 'PUBLISHED' }));
    await customers.save(aCustomer({ id: 'c-123', roles: ['customer'] }));

    const res = await request(app.getHttpServer())
      .post('/admin/customers/c-123/acceptances')
      .send({ versionId: 'v-1', method: 'IMPORT', reason: 'by letter', evidenceFileName: 'letter.pdf' })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_STATE' });
    expect(await acceptances.findByCustomer('c-123')).toHaveLength(0);
  });

  it('POST /admin/customers/:id/acceptances with empty evidenceDocument → 422, no acceptance', async () => {
    await versions.save(anActiveVersion({ id: 'v-1', documentId: 'doc-dpa-customer', status: 'PUBLISHED' }));
    await customers.save(aCustomer({ id: 'c-123', roles: ['customer'] }));

    const res = await request(app.getHttpServer())
      .post('/admin/customers/c-123/acceptances')
      .send({ versionId: 'v-1', method: 'IMPORT', reason: 'by letter', evidenceDocument: '', evidenceFileName: 'letter.pdf' })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_STATE' });
    expect(await acceptances.findByCustomer('c-123')).toHaveLength(0);
  });

  it('POST /admin/customers/:id/acceptances role does not match → 422 ROLE_MISMATCH', async () => {
    await versions.save(anActiveVersion({ id: 'v-1', documentId: 'doc-dpa-customer', status: 'PUBLISHED' }));
    await customers.save(aCustomer({ id: 'c-partner', roles: ['partner'] }));

    const res = await request(app.getHttpServer())
      .post('/admin/customers/c-partner/acceptances')
      .send({ versionId: 'v-1', method: 'IMPORT', reason: 'x', evidenceDocument: EVIDENCE_BASE64, evidenceFileName: 'letter.pdf' })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'ROLE_MISMATCH' });
  });

  it('PATCH /admin/customer-version-states/:id extends the deadline (200)', async () => {
    await states.save(aState({ id: 'cvs-1', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));
    const res = await request(app.getHttpServer())
      .patch('/admin/customer-version-states/cvs-1')
      .send({ deadlineAt: '2026-08-01T09:00:00Z', reason: 'Cohort postponed' })
      .expect(200);
    expect(new Date(res.body.deadlineAt)).toEqual(new Date('2026-08-01T09:00:00Z'));
  });

  it('PATCH /admin/customer-version-states/:id without reason → 422', async () => {
    await states.save(aState({ id: 'cvs-1', state: 'NOTIFIED' }));
    const res = await request(app.getHttpServer())
      .patch('/admin/customer-version-states/cvs-1')
      .send({ deadlineAt: '2026-08-01T09:00:00Z', reason: '' })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_STATE' });
  });

  it('POST /admin/customer-version-states/:id/remind increments the counter + audit (201)', async () => {
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-customer' }));
    await customers.save(aCustomer({ id: 'c-123', roles: ['customer'] }));
    await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'NOTIFIED', remindersSent: 0 }));

    const res = await request(app.getHttpServer()).post('/admin/customer-version-states/cvs-1/remind').expect(201);
    expect(res.body.remindersSent).toBe(1);
    expect(notifier.reminders).toEqual([{ customerId: 'c-123', versionId: 'v-1' }]);
    expect((await audit.findAll()).some((l) => l.action === 'REMIND')).toBe(true);
  });

  describe('/admin/customers', () => {
    beforeEach(async () => {
      await audiences.save(anAudience({ id: 'aud-customer', key: 'customer', name: 'Customers' }));
      await audiences.save(anAudience({ id: 'aud-partner', key: 'partner', name: 'Partners' }));
    });

    it('GET returns rows { id, externalRef, name, roles, contactEmails } sorted by name with total', async () => {
      await customers.save(aCustomer({ id: 'c-2', externalRef: 'ext-2', firstName: '', lastName: '', companyName: 'Beta', roles: ['customer'], contactEmails: [] }));
      await customers.save(aCustomer({ id: 'c-1', externalRef: 'ext-1', firstName: '', lastName: '', companyName: 'Alpha', roles: ['customer'], contactEmails: ['a@x.io'] }));

      const res = await request(app.getHttpServer()).get('/admin/customers').expect(200);
      expect(res.body).toEqual({
        items: [
          { id: 'c-1', externalRef: 'ext-1', firstName: '', lastName: '', companyName: 'Alpha', roles: ['customer'], contactEmails: ['a@x.io'] },
          { id: 'c-2', externalRef: 'ext-2', firstName: '', lastName: '', companyName: 'Beta', roles: ['customer'], contactEmails: [] },
        ],
        total: 2,
      });
    });

    it('GET ?search filters by a case-insensitive substring and reflects the filtered total', async () => {
      await customers.save(aCustomer({ id: 'c-1', externalRef: 'crm-4711', companyName: 'Acme GmbH', roles: ['customer'], contactEmails: ['legal@acme.example'] }));
      await customers.save(aCustomer({ id: 'c-2', externalRef: 'crm-8000', companyName: 'Globex Corp', roles: ['customer'], contactEmails: ['ops@globex.test'] }));

      const res = await request(app.getHttpServer()).get('/admin/customers?search=acme').expect(200);
      expect(res.body.items.map((r: { id: string }) => r.id)).toEqual(['c-1']);
      expect(res.body.total).toBe(1);
    });

    it('POST creates a customer (201) and writes a CUSTOMER_CREATE audit entry', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/customers')
        .send({ externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: ['legal@acme.io'] })
        .expect(201);
      expect(res.body).toMatchObject({ externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: ['legal@acme.io'] });
      expect((await audit.findByTarget('Customer', res.body.id))[0]).toMatchObject({
        action: 'CUSTOMER_CREATE',
        actor: 'admin-1',
      });
    });

    it('POST with an unknown role → 422 UNKNOWN_AUDIENCE', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/customers')
        .send({ externalRef: 'ext-1', companyName: 'x', roles: ['ghost'], contactEmails: [] })
        .expect(422);
      expect(res.body).toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
    });

    it('POST with a duplicate externalRef sharing a role → 422 INVALID_STATE', async () => {
      await customers.save(aCustomer({ id: 'c-1', externalRef: 'ext-dup', roles: ['customer'] }));
      const res = await request(app.getHttpServer())
        .post('/admin/customers')
        .send({ externalRef: 'ext-dup', companyName: 'x', roles: ['customer'], contactEmails: [] })
        .expect(422);
      expect(res.body).toMatchObject({ code: 'INVALID_STATE' });
    });

    it('POST with a duplicate externalRef but a DISJOINT role → 201 (separate partner/customer ID spaces)', async () => {
      await customers.save(aCustomer({ id: 'c-1', externalRef: 'ext-dup', roles: ['customer'] }));
      const res = await request(app.getHttpServer())
        .post('/admin/customers')
        .send({ externalRef: 'ext-dup', companyName: 'partner', roles: ['partner'], contactEmails: [] })
        .expect(201);
      expect(res.body).toMatchObject({ externalRef: 'ext-dup', roles: ['partner'] });
    });

    it('POST with an invalid contactEmail → 422 INVALID_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/customers')
        .send({ externalRef: 'ext-1', companyName: 'x', roles: [], contactEmails: ['nope'] })
        .expect(422);
      expect(res.body).toMatchObject({ code: 'INVALID_STATE' });
    });

    it('POST with acceptedVersions records IMPORT acceptances', async () => {
      await versions.save(aVersion({ id: 'v-signed', documentId: 'doc-dpa-customer', status: 'PUBLISHED' }));
      const res = await request(app.getHttpServer())
        .post('/admin/customers')
        .send({
          externalRef: 'ext-1',
          companyName: 'Acme',
          roles: ['customer'],
          contactEmails: [],
          acceptedVersions: [{ versionId: 'v-signed', acceptedAt: '2026-07-01T00:00:00Z', reference: 'signed offer 42' }],
        })
        .expect(201);
      expect(res.body.importedAcceptances).toEqual([{ versionId: 'v-signed', acceptanceId: expect.any(String) }]);
      const [acceptance] = await acceptances.findByCustomer(res.body.id);
      expect(acceptance).toMatchObject({ method: 'IMPORT', channel: 'ADMIN', evidenceNote: 'signed offer 42' });
    });

    it('PATCH updates a subset (200) and writes a CUSTOMER_UPDATE audit entry', async () => {
      await customers.save(aCustomer({ id: 'c-1', externalRef: 'ext-1', companyName: 'Old', roles: ['customer'], contactEmails: [] }));
      const res = await request(app.getHttpServer())
        .patch('/admin/customers/c-1')
        .send({ companyName: 'New' })
        .expect(200);
      expect(res.body).toMatchObject({ id: 'c-1', companyName: 'New', roles: ['customer'] });
      expect((await audit.findByTarget('Customer', 'c-1')).some((l) => l.action === 'CUSTOMER_UPDATE')).toBe(true);
    });

    it('PATCH an unknown id → 404 CUSTOMER_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer()).patch('/admin/customers/c-ghost').send({ companyName: 'x' }).expect(404);
      expect(res.body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
    });

    it('PATCH with an unexpected field → 400 (strict schema)', async () => {
      await customers.save(aCustomer({ id: 'c-1', externalRef: 'ext-1', roles: ['customer'] }));
      await request(app.getHttpServer()).patch('/admin/customers/c-1').send({ externalRef: 'ext-2' }).expect(400);
    });
  });

  describe('/admin/audiences', () => {
    it('GET returns all audiences sorted by key', async () => {
      await audiences.save(anAudience({ id: 'aud-2', key: 'partner', name: 'Partners' }));
      await audiences.save(anAudience({ id: 'aud-1', key: 'customer', name: 'Customers' }));

      const res = await request(app.getHttpServer()).get('/admin/audiences').expect(200);
      expect(res.body).toEqual([
        { id: 'aud-1', key: 'customer', name: 'Customers' },
        { id: 'aud-2', key: 'partner', name: 'Partners' },
      ]);
    });

    it('POST creates an audience (201) and writes an audit log entry', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/audiences')
        .send({ key: 'customer', name: 'Customer' })
        .expect(201);
      expect(res.body).toMatchObject({ key: 'customer', name: 'Customer' });
      expect((await audit.findByTarget('Audience', res.body.id))[0]).toMatchObject({
        action: 'AUDIENCE_CREATE',
        actor: 'admin-1',
      });
    });

    it('POST with an invalid slug key → 422 INVALID_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/audiences')
        .send({ key: 'Not A Slug', name: 'x' })
        .expect(422);
      expect(res.body).toMatchObject({ code: 'INVALID_STATE' });
    });

    it('POST with a duplicate key → 422 INVALID_STATE', async () => {
      await request(app.getHttpServer()).post('/admin/audiences').send({ key: 'customer', name: 'Customer' }).expect(201);
      const res = await request(app.getHttpServer())
        .post('/admin/audiences')
        .send({ key: 'customer', name: 'Other' })
        .expect(422);
      expect(res.body).toMatchObject({ code: 'INVALID_STATE' });
    });

    it('PATCH renames an audience (200)', async () => {
      const created = await audiences.save(anAudience({ id: 'aud-1', key: 'customer', name: 'Customers' }));
      const res = await request(app.getHttpServer())
        .patch(`/admin/audiences/${created.id}`)
        .send({ name: 'End customers' })
        .expect(200);
      expect(res.body).toEqual({ id: 'aud-1', key: 'customer', name: 'End customers' });
    });

    it('PATCH with a key in the body → 422 INVALID_STATE "key is immutable"', async () => {
      const created = await audiences.save(anAudience({ id: 'aud-1', key: 'customer', name: 'Customers' }));
      const res = await request(app.getHttpServer())
        .patch(`/admin/audiences/${created.id}`)
        .send({ key: 'partner', name: 'x' })
        .expect(422);
      expect(res.body).toMatchObject({ code: 'INVALID_STATE', message: 'key is immutable' });
    });

    it('PATCH an unknown id → 404', async () => {
      await request(app.getHttpServer()).patch('/admin/audiences/aud-ghost').send({ name: 'x' }).expect(404);
    });

    it('DELETE removes an unreferenced audience (204)', async () => {
      // "customer" is referenced by the document seeded in beforeEach — use an unrelated key.
      const created = await audiences.save(anAudience({ id: 'aud-unused', key: 'reseller', name: 'Resellers' }));
      await request(app.getHttpServer()).delete(`/admin/audiences/${created.id}`).expect(204);
      expect(await audiences.findByKey('reseller')).toBeUndefined();
      expect((await audit.findAll()).some((l) => l.action === 'AUDIENCE_DELETE')).toBe(true);
    });

    it('DELETE still referenced → 422 INVALID_STATE "audience is still in use"', async () => {
      const created = await audiences.save(anAudience({ id: 'aud-1', key: 'customer' }));
      await documents.save(aDocument({ audience: 'customer' }));
      const res = await request(app.getHttpServer()).delete(`/admin/audiences/${created.id}`).expect(422);
      expect(res.body).toMatchObject({ code: 'INVALID_STATE', message: 'audience is still in use' });
    });

    it('DELETE an unknown id → 404', async () => {
      await request(app.getHttpServer()).delete('/admin/audiences/aud-ghost').expect(404);
    });
  });

  describe('/admin/document-types', () => {
    it('GET returns all document types sorted by key', async () => {
      await documentTypes.save(aDocumentTypeDef({ id: 'dt-2', key: 'terms', name: 'Terms of Service' }));
      await documentTypes.save(aDocumentTypeDef({ id: 'dt-1', key: 'dpa', name: 'DPA' }));

      const res = await request(app.getHttpServer()).get('/admin/document-types').expect(200);
      expect(res.body).toEqual([
        { id: 'dt-1', key: 'dpa', name: 'DPA', external: false },
        { id: 'dt-2', key: 'terms', name: 'Terms of Service', external: false },
      ]);
    });

    it('POST creates a document type (201) and writes an audit log entry', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/document-types')
        .send({ key: 'dpa', name: 'Data Processing Agreement' })
        .expect(201);
      expect(res.body).toMatchObject({ key: 'dpa', name: 'Data Processing Agreement' });
      expect((await audit.findByTarget('DocumentType', res.body.id))[0]).toMatchObject({
        action: 'DOCUMENT_TYPE_CREATE',
        actor: 'admin-1',
      });
    });

    it('POST with a duplicate key → 422 INVALID_STATE', async () => {
      await request(app.getHttpServer()).post('/admin/document-types').send({ key: 'dpa', name: 'DPA' }).expect(201);
      const res = await request(app.getHttpServer())
        .post('/admin/document-types')
        .send({ key: 'dpa', name: 'Other' })
        .expect(422);
      expect(res.body).toMatchObject({ code: 'INVALID_STATE' });
    });

    it('PATCH renames a document type (200)', async () => {
      const created = await documentTypes.save(aDocumentTypeDef({ id: 'dt-1', key: 'dpa', name: 'DPA' }));
      const res = await request(app.getHttpServer())
        .patch(`/admin/document-types/${created.id}`)
        .send({ name: 'Data Processing Agreement' })
        .expect(200);
      expect(res.body).toEqual({ id: 'dt-1', key: 'dpa', name: 'Data Processing Agreement', external: false });
    });

    it('PATCH with a key in the body → 422 INVALID_STATE "key is immutable"', async () => {
      const created = await documentTypes.save(aDocumentTypeDef({ id: 'dt-1', key: 'dpa' }));
      const res = await request(app.getHttpServer())
        .patch(`/admin/document-types/${created.id}`)
        .send({ key: 'terms', name: 'x' })
        .expect(422);
      expect(res.body).toMatchObject({ code: 'INVALID_STATE', message: 'key is immutable' });
    });

    it('PATCH an unknown id → 404', async () => {
      await request(app.getHttpServer()).patch('/admin/document-types/dt-ghost').send({ name: 'x' }).expect(404);
    });

    it('DELETE removes an unreferenced document type (204)', async () => {
      // "dpa" is referenced by the document seeded in beforeEach — use an unrelated key.
      const created = await documentTypes.save(aDocumentTypeDef({ id: 'dt-unused', key: 'terms', name: 'Terms' }));
      await request(app.getHttpServer()).delete(`/admin/document-types/${created.id}`).expect(204);
      expect(await documentTypes.findByKey('terms')).toBeUndefined();
      expect((await audit.findAll()).some((l) => l.action === 'DOCUMENT_TYPE_DELETE')).toBe(true);
    });

    it('DELETE still referenced → 422 INVALID_STATE "document type is still in use"', async () => {
      const created = await documentTypes.save(aDocumentTypeDef({ id: 'dt-1', key: 'dpa' }));
      await documents.save(aDocument({ type: 'dpa' }));
      const res = await request(app.getHttpServer()).delete(`/admin/document-types/${created.id}`).expect(422);
      expect(res.body).toMatchObject({ code: 'INVALID_STATE', message: 'document type is still in use' });
    });

    it('DELETE an unknown id → 404', async () => {
      await request(app.getHttpServer()).delete('/admin/document-types/dt-ghost').expect(404);
    });

    it('PATCH assigns an e-mail template to the document type', async () => {
      const created = await documentTypes.save(aDocumentTypeDef({ id: 'dt-unused', key: 'terms', name: 'Terms' }));
      const template = await emailTemplates.save({
        id: 'tpl-n',
        name: 'N',
        kind: 'VERSION_NOTIFICATION',
        subject: 's',
        design: '{}',
        html: '<p>h</p>',
        createdAt: T0,
        updatedAt: T0,
      });
      const res = await request(app.getHttpServer())
        .patch(`/admin/document-types/${created.id}`)
        .send({ notificationTemplateId: template.id })
        .expect(200);
      expect(res.body.notificationTemplateId).toBe('tpl-n');
    });
  });

  describe('/admin/email-templates', () => {
    const body = {
      name: 'Welcome',
      kind: 'VERSION_NOTIFICATION',
      subject: 'Hi {{customerName}}',
      design: '{}',
      html: '<p>Hi {{customerName}}</p>',
    };

    it('POST creates a template (201) + audit entry', async () => {
      const res = await request(app.getHttpServer()).post('/admin/email-templates').send(body).expect(201);
      expect(res.body).toMatchObject({ name: 'Welcome', kind: 'VERSION_NOTIFICATION', isDefault: false });
      expect((await audit.findAll()).some((l) => l.action === 'EMAIL_TEMPLATE_CREATE')).toBe(true);
    });

    it('POST rejects unknown body fields (strict schema → 400)', async () => {
      await request(app.getHttpServer())
        .post('/admin/email-templates')
        .send({ ...body, sneaky: true })
        .expect(400);
    });

    it('GET lists templates', async () => {
      await request(app.getHttpServer()).post('/admin/email-templates').send(body).expect(201);
      const res = await request(app.getHttpServer()).get('/admin/email-templates').expect(200);
      expect(res.body.some((t: { name: string }) => t.name === 'Welcome')).toBe(true);
    });

    it('PATCH updates a template', async () => {
      const created = await request(app.getHttpServer()).post('/admin/email-templates').send(body).expect(201);
      const res = await request(app.getHttpServer())
        .patch(`/admin/email-templates/${created.body.id}`)
        .send({ name: 'Renamed' })
        .expect(200);
      expect(res.body.name).toBe('Renamed');
    });

    it('POST :id/preview renders subject/html/text', async () => {
      const created = await request(app.getHttpServer()).post('/admin/email-templates').send(body).expect(201);
      const res = await request(app.getHttpServer())
        .post(`/admin/email-templates/${created.body.id}/preview`)
        .send({})
        .expect(200);
      expect(res.body.subject).toContain('Acme GmbH');
      expect(res.body.html).toContain('Acme GmbH');
      expect(typeof res.body.text).toBe('string');
    });

    it('DELETE removes an unassigned template (204)', async () => {
      const created = await request(app.getHttpServer()).post('/admin/email-templates').send(body).expect(201);
      await request(app.getHttpServer()).delete(`/admin/email-templates/${created.body.id}`).expect(204);
    });

    it('DELETE a template assigned to a document type → 422 INVALID_STATE', async () => {
      const created = await request(app.getHttpServer()).post('/admin/email-templates').send(body).expect(201);
      await documentTypes.save(aDocumentTypeDef({ id: 'dt-1', key: 'terms', notificationTemplateId: created.body.id }));
      await request(app.getHttpServer()).delete(`/admin/email-templates/${created.body.id}`).expect(422);
    });

    it('DELETE an unknown id → 404', async () => {
      await request(app.getHttpServer()).delete('/admin/email-templates/tpl-ghost').expect(404);
    });
  });
});
