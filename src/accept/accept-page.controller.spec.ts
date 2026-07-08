import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DomainErrorFilter } from '../common/http/domain-error.filter';
import { FixedClock } from '../domain/clock';
import { acceptanceLinkTokenHash } from '../domain/acceptance-links';
import {
  aCustomer,
  aDocument,
  anAcceptanceLink,
  anActiveVersion,
  anAudience,
  aState,
} from '../domain/testing/fixtures';
import { PDF_URL_PROVIDER } from '../compliance/ports/pdf-url-provider';
import { FakePdfUrlProvider } from '../compliance/testing/fake-pdf-url-provider';
import { PendingAgreementsService } from '../compliance/pending-agreements.service';
import { AcceptanceService } from '../consent/acceptance.service';
import { NotificationService } from '../consent/notification.service';
import { InMemoryIdempotencyStore, SequentialIdGenerator } from '../consent/inmemory';
import { CONSENT_TOKENS } from '../consent/ports';
import {
  InMemoryAcceptanceLinkRepo,
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryNotificationEventRepo,
  InMemoryObjectionRepo,
} from '../persistence/inmemory';
import { TOKENS } from '../persistence/tokens';
import { ACCEPT_PAGE_RATE_LIMITER, AcceptPageController } from './accept-page.controller';
import { AcceptPageService } from './accept-page.service';
import { SlidingWindowRateLimiter } from './rate-limiter';

const NOW = new Date('2026-07-08T08:00:00Z');
const CONSENT_TEXT = 'I have read the new revision and agree.';
const TOKEN = 'raw-token-1';
const RATE_LIMIT = 5;

describe('AcceptPageController (HTTP)', () => {
  let app: INestApplication;
  let links: InMemoryAcceptanceLinkRepo;
  let customers: InMemoryCustomerRepo;
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let acceptances: InMemoryAcceptanceRepo;

  const seedLink = async (overrides: Parameters<typeof anAcceptanceLink>[0] = {}) =>
    links.create(
      anAcceptanceLink({
        id: 'al-1',
        tokenHash: acceptanceLinkTokenHash(TOKEN),
        customerId: 'c-123',
        expiresAt: new Date('2026-07-31T00:00:00Z'),
        ...overrides,
      }),
    );

  beforeEach(async () => {
    links = new InMemoryAcceptanceLinkRepo();
    customers = new InMemoryCustomerRepo();
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    const audiences = new InMemoryAudienceRepo(documents, customers);
    const clock = new FixedClock(NOW);

    const moduleRef = await Test.createTestingModule({
      controllers: [AcceptPageController],
      providers: [
        AcceptPageService,
        PendingAgreementsService,
        AcceptanceService,
        NotificationService,
        { provide: TOKENS.AcceptanceLinkRepo, useValue: links },
        { provide: TOKENS.CustomerRepo, useValue: customers },
        { provide: TOKENS.AgreementDocumentRepo, useValue: documents },
        { provide: TOKENS.AgreementVersionRepo, useValue: versions },
        { provide: TOKENS.CustomerVersionStateRepo, useValue: states },
        { provide: TOKENS.AcceptanceRepo, useValue: acceptances },
        { provide: TOKENS.ObjectionRepo, useValue: new InMemoryObjectionRepo() },
        { provide: TOKENS.NotificationEventRepo, useValue: new InMemoryNotificationEventRepo() },
        { provide: TOKENS.AudienceRepo, useValue: audiences },
        { provide: TOKENS.Clock, useValue: clock },
        { provide: PDF_URL_PROVIDER, useValue: new FakePdfUrlProvider() },
        { provide: CONSENT_TOKENS.IdempotencyStore, useValue: new InMemoryIdempotencyStore() },
        { provide: CONSENT_TOKENS.IdGenerator, useValue: new SequentialIdGenerator() },
        {
          provide: ACCEPT_PAGE_RATE_LIMITER,
          useValue: new SlidingWindowRateLimiter(clock, RATE_LIMIT, 60_000),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();

    await audiences.save(anAudience());
    await customers.save(aCustomer());
    await documents.save(aDocument());
    await versions.save(anActiveVersion({ id: 'v-1', consentText: CONSENT_TEXT }));
    await states.save(aState({ id: 'cvs-1', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /accept/:token', () => {
    it('renders the HTML page (200, text/html) and starts the deadline', async () => {
      await seedLink();
      const res = await request(app.getHttpServer()).get(`/accept/${TOKEN}`).expect(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('DPA — Customers');
      expect(res.text).toContain(CONSENT_TEXT);
      expect((await states.findByCustomerAndVersion('c-123', 'v-1'))?.state).toBe('NOTIFIED');
    });

    it('?lang=de renders German', async () => {
      await seedLink();
      const res = await request(app.getHttpServer()).get(`/accept/${TOKEN}?lang=de`).expect(200);
      expect(res.text).toContain('<html lang="de">');
    });

    it('Accept-Language: de renders German when no query is given', async () => {
      await seedLink();
      const res = await request(app.getHttpServer())
        .get(`/accept/${TOKEN}`)
        .set('Accept-Language', 'de-DE,de;q=0.9')
        .expect(200);
      expect(res.text).toContain('<html lang="de">');
    });

    it('unknown, expired and revoked tokens render the IDENTICAL 404 HTML page', async () => {
      const unknown = await request(app.getHttpServer()).get('/accept/nope').expect(404);

      await seedLink({ expiresAt: new Date('2026-07-01T00:00:00Z') });
      const expired = await request(app.getHttpServer()).get(`/accept/${TOKEN}`).expect(404);

      expect(unknown.headers['content-type']).toContain('text/html');
      expect(expired.text).toBe(unknown.text);
      expect(unknown.text).toContain('Link not available');
    });
  });

  describe('POST /accept/:token/acceptances', () => {
    const validBody = {
      versionId: 'v-1',
      displayedConsentText: CONSENT_TEXT,
      signerName: 'Max Mustermann',
      signerEmail: 'max@acme.example',
    };

    it('201: records the LINK acceptance with the self-declared signer + request IP/UA', async () => {
      await seedLink();
      const res = await request(app.getHttpServer())
        .post(`/accept/${TOKEN}/acceptances`)
        .set('User-Agent', 'Mobile Safari test')
        .send(validBody)
        .expect(201);
      expect(res.body).toMatchObject({ state: 'ACCEPTED' });
      const acceptance = await acceptances.findEffective('c-123', 'v-1');
      expect(acceptance).toMatchObject({
        channel: 'LINK',
        actor: { userId: 'link:al-1', name: 'Max Mustermann', email: 'max@acme.example' },
        evidenceNote: 'identity self-declared via acceptance link al-1',
        userAgent: 'Mobile Safari test',
      });
      expect(acceptance?.ipAddress).toBeTruthy();
    });

    it('400 on missing signer fields (strict schema)', async () => {
      await seedLink();
      await request(app.getHttpServer())
        .post(`/accept/${TOKEN}/acceptances`)
        .send({ versionId: 'v-1', displayedConsentText: CONSENT_TEXT })
        .expect(400);
    });

    it('400 on actor-like extra fields (strict schema — identity cannot be injected)', async () => {
      await seedLink();
      await request(app.getHttpServer())
        .post(`/accept/${TOKEN}/acceptances`)
        .send({ ...validBody, actorUserId: 'u-999' })
        .expect(400);
    });

    it('404 LINK_NOT_FOUND for an unknown token (uniform, JSON for the page JS)', async () => {
      const res = await request(app.getHttpServer())
        .post('/accept/nope/acceptances')
        .send(validBody)
        .expect(404);
      expect(res.body).toMatchObject({ code: 'LINK_NOT_FOUND' });
    });

    it('409 ALREADY_ACCEPTED on a second acceptance (friendly page state)', async () => {
      await seedLink();
      await request(app.getHttpServer())
        .post(`/accept/${TOKEN}/acceptances`)
        .set('Idempotency-Key', 'k-1')
        .send(validBody)
        .expect(201);
      const res = await request(app.getHttpServer())
        .post(`/accept/${TOKEN}/acceptances`)
        .set('Idempotency-Key', 'k-2')
        .send(validBody)
        .expect(409);
      expect(res.body).toMatchObject({ code: 'ALREADY_ACCEPTED' });
    });

    it('replay with the same Idempotency-Key returns the identical 201 response', async () => {
      await seedLink();
      const first = await request(app.getHttpServer())
        .post(`/accept/${TOKEN}/acceptances`)
        .set('Idempotency-Key', 'k-1')
        .send(validBody)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(`/accept/${TOKEN}/acceptances`)
        .set('Idempotency-Key', 'k-1')
        .send(validBody)
        .expect(201);
      expect(second.body).toEqual(first.body);
      expect(await acceptances.findByCustomer('c-123')).toHaveLength(1);
    });
  });

  it('429 RATE_LIMITED once the per-token limit is exhausted (GET and POST share the budget)', async () => {
    await seedLink();
    for (let i = 0; i < RATE_LIMIT; i++) {
      await request(app.getHttpServer()).get(`/accept/${TOKEN}`).expect(200);
    }
    const res = await request(app.getHttpServer()).get(`/accept/${TOKEN}`).expect(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
    // Another token has its own budget.
    await request(app.getHttpServer()).get('/accept/other-token').expect(404);
  });
});
