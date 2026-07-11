import { INestApplication, type CanActivate } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminGuard } from '../common/auth/admin.guard.js';
import { DomainErrorFilter } from '../common/http/domain-error.filter.js';
import { anEvent } from '../domain/testing/fixtures.js';
import { InMemoryEventRepo } from '../persistence/inmemory/index.js';
import { TOKENS } from '../persistence/tokens.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

const allowAdmin: CanActivate = { canActivate: () => true };

describe('EventsController', () => {
  let app: INestApplication;
  let events: InMemoryEventRepo;

  beforeEach(async () => {
    events = new InMemoryEventRepo();

    const moduleRef = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [EventsService, { provide: TOKENS.EventRepo, useValue: events }],
    })
      .overrideGuard(AdminGuard)
      .useValue(allowAdmin)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();

    await events.append(
      anEvent({ id: 'evt-acc', type: 'VERSION_ACCEPTED', category: 'CONSENT', customerId: 'c-123', occurredAt: new Date('2026-07-09T14:00:00Z') }),
    );
    await events.append(
      anEvent({ id: 'evt-obj', type: 'OBJECTION_RAISED', category: 'CONSENT', customerId: 'c-456', occurredAt: new Date('2026-07-10T10:00:00Z') }),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /admin/events returns the table-backed list newest-first', async () => {
    const res = await request(app.getHttpServer()).get('/admin/events').expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((e: { id: string }) => e.id)).toEqual(['evt-obj', 'evt-acc']);
  });

  it('GET /admin/events?customerId=&category= filters before pagination', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/events')
      .query({ customerId: 'c-123', category: 'CONSENT' })
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ id: 'evt-acc', customerId: 'c-123', category: 'CONSENT' });
  });
});
