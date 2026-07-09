import { INestApplication, type CanActivate } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { InMemoryAdminAuditRepo, ADMIN_AUDIT_TOKEN } from '../agreements/audit';
import { AdminGuard } from '../common/auth/admin.guard';
import { DomainErrorFilter } from '../common/http/domain-error.filter';
import { aCustomer, aDocument, aState, aVersion, anAcceptance, anObjection } from '../domain/testing/fixtures';
import { TOKENS } from '../persistence/tokens';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryNotificationEventRepo,
  InMemoryObjectionRepo,
} from '../persistence/inmemory';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

const allowAdmin: CanActivate = { canActivate: () => true };

describe('EventsController', () => {
  let app: INestApplication;
  let customers: InMemoryCustomerRepo;
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let acceptances: InMemoryAcceptanceRepo;
  let objections: InMemoryObjectionRepo;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    customers = new InMemoryCustomerRepo();
    states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    objections = new InMemoryObjectionRepo();

    const moduleRef = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        EventsService,
        { provide: TOKENS.AcceptanceRepo, useValue: acceptances },
        { provide: TOKENS.ObjectionRepo, useValue: objections },
        { provide: TOKENS.NotificationEventRepo, useValue: new InMemoryNotificationEventRepo() },
        { provide: TOKENS.CustomerRepo, useValue: customers },
        { provide: TOKENS.CustomerVersionStateRepo, useValue: states },
        { provide: TOKENS.AgreementVersionRepo, useValue: versions },
        { provide: TOKENS.AgreementDocumentRepo, useValue: documents },
        { provide: ADMIN_AUDIT_TOKEN, useValue: new InMemoryAdminAuditRepo() },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue(allowAdmin)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();

    await documents.save(aDocument({ id: 'doc-dpa-customer', type: 'dpa', audience: 'customer' }));
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-customer' }));
    await customers.save(aCustomer({ id: 'c-123' }));
    await customers.save(aCustomer({ id: 'c-456', externalRef: 'crm-456', roles: ['partner'] }));
    await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1' }));
    await acceptances.append(anAcceptance({ id: 'a-1', customerId: 'c-123', versionId: 'v-1', acceptedAt: new Date('2026-07-09T14:00:00Z') }));
    await objections.append(anObjection({ id: 'o-1', customerId: 'c-456', versionId: 'v-1', objectedAt: new Date('2026-07-10T10:00:00Z') }));
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /admin/events returns the aggregated list newest-first', async () => {
    const res = await request(app.getHttpServer()).get('/admin/events').expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((e: { id: string }) => e.id)).toEqual(['obj:o-1', 'acc:a-1']);
  });

  it('GET /admin/events?customerId=&category= filters before pagination', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/events')
      .query({ customerId: 'c-123', category: 'CONSENT' })
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ id: 'acc:a-1', customerId: 'c-123', category: 'CONSENT' });
  });
});
