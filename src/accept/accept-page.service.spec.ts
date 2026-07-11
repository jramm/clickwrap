import { FixedClock } from '../domain/clock.js';
import { acceptanceLinkTokenHash } from '../domain/acceptance-links.js';
import {
  aCustomer,
  aDocument,
  anAcceptanceLink,
  anActiveVersion,
  anAudience,
  aState,
  aVersion,
} from '../domain/testing/fixtures.js';
import { FakePdfUrlProvider } from '../compliance/testing/fake-pdf-url-provider.js';
import { PendingAgreementsService } from '../compliance/pending-agreements.service.js';
import { AcceptanceService } from '../consent/acceptance.service.js';
import { NotificationService } from '../consent/notification.service.js';
import { InMemoryIdempotencyStore, SequentialIdGenerator } from '../consent/inmemory.js';
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
} from '../persistence/inmemory/index.js';
import { InMemoryEscalationLog } from '../common/escalation/escalation-log.inmemory.js';
import { ObjectionService } from '../consent/objection.service.js';
import { AcceptPageService } from './accept-page.service.js';

const NOW = new Date('2026-07-08T08:00:00Z');
const CONSENT_TEXT = 'I have read the new revision and agree.';
const TOKEN = 'raw-token-1';

describe('AcceptPageService', () => {
  let links: InMemoryAcceptanceLinkRepo;
  let customers: InMemoryCustomerRepo;
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let events: InMemoryNotificationEventRepo;
  let acceptances: InMemoryAcceptanceRepo;
  let objections: InMemoryObjectionRepo;
  let clock: FixedClock;
  let service: AcceptPageService;

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

  const acceptRequest = (overrides: Partial<Parameters<AcceptPageService['accept']>[1]> = {}) => ({
    versionId: 'v-1',
    displayedConsentText: CONSENT_TEXT,
    signerName: 'Max Mustermann',
    signerEmail: 'max@acme.example',
    ipAddress: '198.51.100.4',
    userAgent: 'Mobile Safari test',
    ...overrides,
  });

  const objectRequest = (overrides: Partial<Parameters<AcceptPageService['object']>[1]> = {}) => ({
    versionId: 'v-1',
    reason: 'We do not agree to the new sub-processor.',
    signerName: 'Max Mustermann',
    signerEmail: 'max@acme.example',
    ipAddress: '198.51.100.4',
    userAgent: 'Mobile Safari test',
    ...overrides,
  });

  beforeEach(async () => {
    links = new InMemoryAcceptanceLinkRepo();
    customers = new InMemoryCustomerRepo();
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    states = new InMemoryCustomerVersionStateRepo();
    events = new InMemoryNotificationEventRepo();
    acceptances = new InMemoryAcceptanceRepo();
    objections = new InMemoryObjectionRepo();
    clock = new FixedClock(NOW);
    const audiences = new InMemoryAudienceRepo(documents, customers);
    const ids = new SequentialIdGenerator();
    const pending = new PendingAgreementsService(
      customers,
      audiences,
      documents,
      versions,
      states,
      clock,
      new FakePdfUrlProvider(),
    );
    const notifications = new NotificationService(versions, states, events, ids, clock);
    const acceptanceService = new AcceptanceService(
      versions,
      documents,
      customers,
      states,
      acceptances,
      new InMemoryIdempotencyStore(),
      ids,
      clock,
    );
    const objectionService = new ObjectionService(
      versions,
      states,
      objections,
      new InMemoryEscalationLog(),
      new InMemoryIdempotencyStore(),
      ids,
      clock,
    );
    service = new AcceptPageService(
      links,
      customers,
      versions,
      documents,
      pending,
      notifications,
      acceptanceService,
      objectionService,
      clock,
    );

    await audiences.save(anAudience({ id: 'aud-customer', key: 'customer' }));
    await audiences.save(anAudience({ id: 'aud-partner', key: 'partner' }));
    await customers.save(aCustomer({ roles: ['customer', 'partner'] }));
    await documents.save(aDocument());
    await versions.save(anActiveVersion({ id: 'v-1', consentText: CONSENT_TEXT }));
    await states.save(aState({ id: 'cvs-1', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));
  });

  describe('loadPage', () => {
    it('renders pending items with consent text + PDF link and records the access proof (LINK event, deadline starts)', async () => {
      await seedLink();

      const view = await service.loadPage(TOKEN);

      expect(view).toBeDefined();
      expect(view?.customerName).toBe('Acme GmbH');
      expect(view?.items).toHaveLength(1);
      expect(view?.items[0]).toMatchObject({
        versionId: 'v-1',
        documentName: 'DPA — Customers',
        documentType: 'dpa',
        versionLabel: 'June 2026 edition',
        changeSummary: 'New sub-processor for e-mail delivery.',
        mode: 'ACTIVE',
        consentText: CONSENT_TEXT,
        blocking: false,
      });
      expect(view?.items[0].pdfUrl).toContain('fake-storage.test/presigned');

      // Access proof exactly like the portal popup: NOTIFIED + server-side deadline + LINK event.
      const state = await states.findByCustomerAndVersion('c-123', 'v-1');
      expect(state?.state).toBe('NOTIFIED');
      expect(state?.notifiedAt).toEqual(NOW);
      expect(view?.items[0].deadlineAt).toEqual(state?.deadlineAt);
      const stored = await events.findByState('cvs-1');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ channel: 'LINK', recipient: 'link:al-1', occurredAt: NOW });
    });

    it('touches lastUsedAt on render', async () => {
      await seedLink();
      await service.loadPage(TOKEN);
      expect((await links.findByTokenHash(acceptanceLinkTokenHash(TOKEN)))?.lastUsedAt).toEqual(NOW);
    });

    it('repeated rendering never resets notifiedAt/deadline and records no second event (first access wins)', async () => {
      await seedLink();
      const first = await service.loadPage(TOKEN);
      clock.advanceDays(3);
      const second = await service.loadPage(TOKEN);

      expect(second?.items[0].deadlineAt).toEqual(first?.items[0].deadlineAt);
      expect(await events.findByState('cvs-1')).toHaveLength(1);
    });

    it('carry-over block (ACTIVE): the page shows blocking; access never moves the absolute hard deadline', async () => {
      const HARD = new Date('2026-07-15T00:00:00Z');
      await states.save(
        aState({ id: 'cvs-1', versionId: 'v-1', state: 'PENDING_NOTIFICATION', carryOverBlocking: true, deadlineAt: HARD }),
      );
      await seedLink();

      const view = await service.loadPage(TOKEN);

      expect(view?.items[0].blocking).toBe(true);
      // ACTIVE: the deadline is the version's absolute hard deadline, stamped at rollout — access
      // records evidence (notifiedAt) but never recomputes it.
      expect(view?.items[0].deadlineAt).toEqual(HARD);
    });

    it('audience scope: a scoped link only shows documents of that audience', async () => {
      await documents.save(aDocument({ id: 'doc-terms-partner', type: 'terms', audience: 'partner', name: 'ToS — Partners' }));
      await versions.save(
        anActiveVersion({ id: 'v-2', documentId: 'doc-terms-partner', consentText: 'Partner consent.' }),
      );
      await states.save(aState({ id: 'cvs-2', versionId: 'v-2', state: 'PENDING_NOTIFICATION' }));
      await seedLink({ audienceKey: 'customer' });

      const view = await service.loadPage(TOKEN);

      expect(view?.items.map((i) => i.versionId)).toEqual(['v-1']);
      // No access proof for the out-of-scope document either.
      expect(await events.findByState('cvs-2')).toHaveLength(0);
    });

    it('nothing pending → items [] (friendly "everything is accepted" page)', async () => {
      await states.save(aState({ id: 'cvs-1', versionId: 'v-1', state: 'ACCEPTED' }));
      await seedLink();
      const view = await service.loadPage(TOKEN);
      expect(view?.items).toEqual([]);
    });

    it('PASSIVE documents are listed without consent text (informational; deadline still starts)', async () => {
      await versions.save(aVersion({ id: 'v-1', acceptanceMode: 'PASSIVE', objectionPeriodDays: 14, consentText: undefined }));

      await seedLink();
      const view = await service.loadPage(TOKEN);

      expect(view?.items[0]).toMatchObject({ mode: 'PASSIVE', consentText: undefined });
      expect((await states.findByCustomerAndVersion('c-123', 'v-1'))?.state).toBe('NOTIFIED');
    });

    it('scheduled publish: current and upcoming version are both listed — the upcoming one flagged with its validFrom and its absolute hard deadline', async () => {
      const VALID_FROM = new Date('2026-08-01T00:00:00Z');
      const HARD = new Date('2026-08-20T00:00:00Z');
      await versions.save(
        anActiveVersion({ id: 'v-next', consentText: CONSENT_TEXT, validFrom: VALID_FROM, hardDeadlineAt: HARD, publishedAt: NOW }),
      );
      // ACTIVE state carries the absolute hard deadline from rollout (>= validFrom).
      await states.save(aState({ id: 'cvs-next', versionId: 'v-next', state: 'PENDING_NOTIFICATION', deadlineAt: HARD }));
      await seedLink();

      const view = await service.loadPage(TOKEN);

      expect(view?.items).toHaveLength(2);
      const currentItem = view?.items.find((i) => i.versionId === 'v-1');
      const upcomingItem = view?.items.find((i) => i.versionId === 'v-next');
      expect(currentItem).toMatchObject({ upcoming: false });
      expect(upcomingItem).toMatchObject({ upcoming: true, validFrom: VALID_FROM });
      // ACTIVE: the deadline is the absolute hard deadline, independent of access.
      expect(upcomingItem?.deadlineAt).toEqual(HARD);
    });

    it.each([
      ['unknown token', () => Promise.resolve()],
      ['expired link', async () => void (await seedLink({ expiresAt: new Date('2026-07-01T00:00:00Z') }))],
      [
        'revoked link',
        async () => void (await seedLink({ revokedAt: new Date('2026-07-02T00:00:00Z') })),
      ],
    ])('uniform 404: %s → undefined (no distinguishable signal)', async (_label, seed) => {
      await seed();
      expect(await service.loadPage(TOKEN)).toBeUndefined();
      // And no access proof was recorded.
      expect(await events.findByState('cvs-1')).toHaveLength(0);
    });
  });

  describe('accept', () => {
    it('records the acceptance with channel LINK, self-declared actor and evidence note', async () => {
      await seedLink();

      const response = await service.accept(TOKEN, acceptRequest());

      expect(response.state).toBe('ACCEPTED');
      const acceptance = await acceptances.findEffective('c-123', 'v-1');
      expect(acceptance).toMatchObject({
        method: 'ACTIVE_CONSENT',
        channel: 'LINK',
        actor: { userId: 'link:al-1', name: 'Max Mustermann', email: 'max@acme.example' },
        evidenceNote: 'identity self-declared via acceptance link al-1',
        consentText: CONSENT_TEXT,
        contentHash: 'sha256:9c1e',
        ipAddress: '198.51.100.4',
        userAgent: 'Mobile Safari test',
        acceptedAt: NOW,
      });
      expect((await links.findByTokenHash(acceptanceLinkTokenHash(TOKEN)))?.lastUsedAt).toEqual(NOW);
    });

    it.each([
      ['unknown token', () => Promise.resolve()],
      ['expired link', async () => void (await seedLink({ expiresAt: new Date('2026-07-01T00:00:00Z') }))],
      ['revoked link', async () => void (await seedLink({ revokedAt: new Date('2026-07-02T00:00:00Z') }))],
    ])('uniform LINK_NOT_FOUND: %s', async (_label, seed) => {
      await seed();
      await expect(service.accept(TOKEN, acceptRequest())).rejects.toMatchObject({ code: 'LINK_NOT_FOUND' });
      expect(await acceptances.findByCustomer('c-123')).toHaveLength(0);
    });

    it('advance acceptance through the hosted page: an upcoming version is acceptable before its validFrom', async () => {
      await versions.save(
        anActiveVersion({ id: 'v-next', consentText: CONSENT_TEXT, validFrom: new Date('2026-08-01T00:00:00Z'), publishedAt: NOW }),
      );
      await states.save(aState({ id: 'cvs-next', versionId: 'v-next', state: 'PENDING_NOTIFICATION' }));
      await seedLink();

      const response = await service.accept(TOKEN, acceptRequest({ versionId: 'v-next' }));

      expect(response.state).toBe('ACCEPTED');
      expect(await acceptances.findEffective('c-123', 'v-next')).toMatchObject({ channel: 'LINK' });
    });

    it('blank signer name → INVALID_STATE', async () => {
      await seedLink();
      await expect(service.accept(TOKEN, acceptRequest({ signerName: '   ' }))).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
    });

    it('invalid signer e-mail → INVALID_STATE', async () => {
      await seedLink();
      await expect(service.accept(TOKEN, acceptRequest({ signerEmail: 'not-an-email' }))).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
    });

    it('CONSENT_TEXT_MISMATCH when the page echoes a different text', async () => {
      await seedLink();
      await expect(
        service.accept(TOKEN, acceptRequest({ displayedConsentText: 'tampered text' })),
      ).rejects.toMatchObject({ code: 'CONSENT_TEXT_MISMATCH' });
    });

    it('second acceptance → ALREADY_ACCEPTED (friendly page state)', async () => {
      await seedLink();
      await service.accept(TOKEN, acceptRequest({ idempotencyKey: 'k-1' }));
      await expect(service.accept(TOKEN, acceptRequest({ idempotencyKey: 'k-2' }))).rejects.toMatchObject({
        code: 'ALREADY_ACCEPTED',
      });
    });

    it('a scoped link cannot accept versions of another audience → VERSION_NOT_FOUND', async () => {
      await documents.save(aDocument({ id: 'doc-terms-partner', type: 'terms', audience: 'partner', name: 'ToS — Partners' }));
      await versions.save(
        anActiveVersion({ id: 'v-2', documentId: 'doc-terms-partner', consentText: 'Partner consent.' }),
      );
      await states.save(aState({ id: 'cvs-2', versionId: 'v-2', state: 'PENDING_NOTIFICATION' }));
      await seedLink({ audienceKey: 'customer' });

      await expect(
        service.accept(TOKEN, acceptRequest({ versionId: 'v-2', displayedConsentText: 'Partner consent.' })),
      ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
      expect(await acceptances.findByCustomer('c-123')).toHaveLength(0);
    });
  });

  describe('loadPage (objection surface, #30)', () => {
    const seedPassive = async () => {
      await versions.save(
        aVersion({
          id: 'v-1',
          acceptanceMode: 'PASSIVE',
          objectionPeriodDays: 14,
          consentText: undefined,
          objectionConsequence: 'Your current tariff stays in effect while we clarify next steps.',
        }),
      );
      await seedLink();
    };

    it('a PASSIVE, in-effect item is objectable and carries its consequence text', async () => {
      await seedPassive();
      const view = await service.loadPage(TOKEN);
      expect(view?.items[0]).toMatchObject({
        mode: 'PASSIVE',
        canObject: true,
        objectionConsequence: 'Your current tariff stays in effect while we clarify next steps.',
      });
    });

    it('an ACTIVE item is not objectable', async () => {
      await seedLink();
      const view = await service.loadPage(TOKEN);
      expect(view?.items[0].canObject).toBe(false);
    });
  });

  describe('object (#30)', () => {
    const seedPassive = async () => {
      await versions.save(
        aVersion({ id: 'v-1', acceptanceMode: 'PASSIVE', objectionPeriodDays: 14, consentText: undefined }),
      );
      await seedLink();
      // Provable access starts the objection period and moves the state to NOTIFIED.
      await service.loadPage(TOKEN);
    };

    it('records an objection with channel LINK actor, the reason and moves the state to OBJECTED', async () => {
      await seedPassive();

      const response = await service.object(TOKEN, objectRequest());

      expect(response.state).toBe('OBJECTED');
      expect((await states.findByCustomerAndVersion('c-123', 'v-1'))?.state).toBe('OBJECTED');
      const stored = await objections.findByCustomer('c-123');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        versionId: 'v-1',
        reason: 'We do not agree to the new sub-processor.',
        actor: { userId: 'link:al-1', name: 'Max Mustermann', email: 'max@acme.example' },
        objectedAt: NOW,
      });
      expect((await links.findByTokenHash(acceptanceLinkTokenHash(TOKEN)))?.lastUsedAt).toEqual(NOW);
    });

    it.each([
      ['unknown token', () => Promise.resolve()],
      ['expired link', async () => void (await seedLink({ expiresAt: new Date('2026-07-01T00:00:00Z') }))],
      ['revoked link', async () => void (await seedLink({ revokedAt: new Date('2026-07-02T00:00:00Z') }))],
    ])('uniform LINK_NOT_FOUND: %s', async (_label, seed) => {
      await seed();
      await expect(service.object(TOKEN, objectRequest())).rejects.toMatchObject({ code: 'LINK_NOT_FOUND' });
      expect(await objections.findByCustomer('c-123')).toHaveLength(0);
    });

    it('a scoped link cannot object to a version of another audience → VERSION_NOT_FOUND', async () => {
      await documents.save(aDocument({ id: 'doc-terms-partner', type: 'terms', audience: 'partner', name: 'ToS — Partners' }));
      await versions.save(
        aVersion({ id: 'v-2', documentId: 'doc-terms-partner', acceptanceMode: 'PASSIVE', objectionPeriodDays: 14, consentText: undefined }),
      );
      await states.save(aState({ id: 'cvs-2', versionId: 'v-2', state: 'NOTIFIED', notifiedAt: NOW }));
      await seedLink({ audienceKey: 'customer' });

      await expect(service.object(TOKEN, objectRequest({ versionId: 'v-2' }))).rejects.toMatchObject({
        code: 'VERSION_NOT_FOUND',
      });
      expect(await objections.findByCustomer('c-123')).toHaveLength(0);
    });
  });
});
