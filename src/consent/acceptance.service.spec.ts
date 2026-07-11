import type { CustomerContext } from '../common/auth/actor.js';
import { FixedClock } from '../domain/clock.js';
import {
  aCustomer,
  aDocument,
  anActiveVersion,
  aState,
  aVersion,
  testActor,
} from '../domain/testing/fixtures.js';
import type { AgreementVersion } from '../domain/types.js';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryEventRepo,
} from '../persistence/inmemory/index.js';
import { EventRecorder } from '../events/event-recorder.js';
import type { AcceptanceConfirmationService } from '../plugins/email/core/acceptance-confirmation.service.js';
import { AcceptanceService } from './acceptance.service.js';
import { InMemoryIdempotencyStore, SequentialIdGenerator } from './inmemory.js';

const NOW = new Date('2026-07-08T08:00:00Z');
const CONSENT_TEXT = 'I have read the new revision and agree.';

const context = (customerId = 'c-123'): CustomerContext => ({
  customerId,
  actor: testActor(),
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0 test',
});

describe('AcceptanceService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let customers: InMemoryCustomerRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let acceptances: InMemoryAcceptanceRepo;
  let idempotency: InMemoryIdempotencyStore;
  let clock: FixedClock;
  let events: InMemoryEventRepo;
  let service: AcceptanceService;

  const seedVersion = async (overrides: Partial<AgreementVersion> = {}): Promise<AgreementVersion> => {
    const version = anActiveVersion({ id: 'v-1', consentText: CONSENT_TEXT, ...overrides });
    return versions.save(version);
  };

  const acceptInput = (overrides: Partial<Parameters<AcceptanceService['accept']>[0]> = {}) => ({
    customerId: 'c-123',
    versionId: 'v-1',
    displayedConsentText: CONSENT_TEXT,
    idempotencyKey: 'key-1',
    context: context(),
    ...overrides,
  });

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    customers = new InMemoryCustomerRepo();
    states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    idempotency = new InMemoryIdempotencyStore();
    clock = new FixedClock(NOW);
    events = new InMemoryEventRepo();
    service = new AcceptanceService(
      versions,
      documents,
      customers,
      states,
      acceptances,
      idempotency,
      new SequentialIdGenerator(),
      clock,
      undefined,
      new EventRecorder(events, clock),
    );
    await documents.save(aDocument());
    await customers.save(aCustomer());
  });

  describe('acceptance confirmation trigger', () => {
    it.each(['PORTAL', 'LINK'] as const)(
      'invokes the acceptance-confirmation sender for channel %s',
      async (channel) => {
        const confirmation = { sendForAcceptance: jest.fn().mockResolvedValue(undefined) };
        const serviceWithConfirmation = new AcceptanceService(
          versions,
          documents,
          customers,
          states,
          acceptances,
          idempotency,
          new SequentialIdGenerator(),
          clock,
          confirmation as unknown as AcceptanceConfirmationService,
        );
        const version = await seedVersion();

        await serviceWithConfirmation.accept(acceptInput({ channel }));

        expect(confirmation.sendForAcceptance).toHaveBeenCalledTimes(1);
        expect(confirmation.sendForAcceptance).toHaveBeenCalledWith(
          expect.objectContaining({ id: version.id }),
          expect.objectContaining({ method: 'ACTIVE_CONSENT', channel }),
        );
      },
    );
  });

  it('happy path (onboarding without a state): creates the state, records the acceptance with server-side evidence chain', async () => {
    await seedVersion();

    const response = await service.accept(acceptInput());

    expect(response).toEqual({ acceptanceId: 'a-1', state: 'ACCEPTED' });
    const savedState = await states.findByCustomerAndVersion('c-123', 'v-1');
    expect(savedState?.state).toBe('ACCEPTED');
    const acceptance = await acceptances.findEffective('c-123', 'v-1');
    expect(acceptance).toMatchObject({
      method: 'ACTIVE_CONSENT',
      channel: 'PORTAL',
      consentText: CONSENT_TEXT,
      consentTextHash: expect.stringMatching(/^sha256:/),
      contentHash: 'sha256:9c1e',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 test',
      actor: { userId: 'u-42' },
      acceptedAt: NOW,
    });
  });

  it('channel LINK (hosted acceptance page): self-declared actor + evidence note are recorded verbatim', async () => {
    await seedVersion();

    const response = await service.accept(
      acceptInput({
        channel: 'LINK',
        evidenceNote: 'identity self-declared via acceptance link al-1',
        context: {
          customerId: 'c-123',
          actor: { userId: 'link:al-1', name: 'Max Mustermann', email: 'max@acme.example' },
          ipAddress: '198.51.100.4',
          userAgent: 'Mobile Safari test',
        },
      }),
    );

    expect(response.state).toBe('ACCEPTED');
    const acceptance = await acceptances.findEffective('c-123', 'v-1');
    expect(acceptance).toMatchObject({
      method: 'ACTIVE_CONSENT',
      channel: 'LINK',
      actor: { userId: 'link:al-1', name: 'Max Mustermann', email: 'max@acme.example' },
      evidenceNote: 'identity self-declared via acceptance link al-1',
      // The evidence chain stays fully server-side: consent text + hashes from the version.
      consentText: CONSENT_TEXT,
      consentTextHash: expect.stringMatching(/^sha256:/),
      contentHash: 'sha256:9c1e',
      ipAddress: '198.51.100.4',
      userAgent: 'Mobile Safari test',
    });
  });

  it('the portal path never records an evidence note and stays channel PORTAL (unchanged default)', async () => {
    await seedVersion();
    await service.accept(acceptInput());
    const acceptance = await acceptances.findEffective('c-123', 'v-1');
    expect(acceptance?.channel).toBe('PORTAL');
    expect(acceptance?.evidenceNote).toBeUndefined();
  });

  it('uses an existing state (no onboarding) and accepts from NOTIFIED', async () => {
    await seedVersion();
    await states.save(aState({ state: 'NOTIFIED', notifiedAt: NOW }));

    const response = await service.accept(acceptInput());

    expect(response.state).toBe('ACCEPTED');
    expect((await states.findByCustomerAndVersion('c-123', 'v-1'))?.state).toBe('ACCEPTED');
  });

  it('idempotency replay: same key → identical 201 response, only one acceptance', async () => {
    await seedVersion();

    const first = await service.accept(acceptInput({ idempotencyKey: 'key-x' }));
    const second = await service.accept(acceptInput({ idempotencyKey: 'key-x' }));

    expect(second).toEqual(first);
    expect(await acceptances.findByCustomer('c-123')).toHaveLength(1);
  });

  it('parallel requests with the same idempotency key → both receive the 201 replay (no 409), only one acceptance', async () => {
    await seedVersion();

    const [first, second] = await Promise.all([
      service.accept(acceptInput({ idempotencyKey: 'key-par' })),
      service.accept(acceptInput({ idempotencyKey: 'key-par' })),
    ]);

    expect(second).toEqual(first);
    expect(await acceptances.findByCustomer('c-123')).toHaveLength(1);
  });

  it('after a failed request the key reservation is released — a retry with the same key works', async () => {
    await seedVersion();

    await expect(
      service.accept(acceptInput({ idempotencyKey: 'key-retry', displayedConsentText: 'different text' })),
    ).rejects.toMatchObject({ code: 'CONSENT_TEXT_MISMATCH' });

    const response = await service.accept(acceptInput({ idempotencyKey: 'key-retry' }));
    expect(response.state).toBe('ACCEPTED');
  });

  it('without a key match on an already accepted version → ALREADY_ACCEPTED', async () => {
    await seedVersion();
    await service.accept(acceptInput({ idempotencyKey: 'key-1' }));

    await expect(service.accept(acceptInput({ idempotencyKey: 'key-2' }))).rejects.toMatchObject({
      code: 'ALREADY_ACCEPTED',
    });
  });

  it('VERSION_NOT_FOUND for an unknown version', async () => {
    await expect(service.accept(acceptInput({ versionId: 'nope' }))).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    });
  });

  it('VERSION_NOT_CURRENT when a newer revision exists', async () => {
    await seedVersion({ validFrom: new Date('2026-07-01T00:00:00Z') });
    await seedVersion({ id: 'v-2', validFrom: new Date('2026-07-05T00:00:00Z') });

    await expect(service.accept(acceptInput({ versionId: 'v-1' }))).rejects.toMatchObject({
      code: 'VERSION_NOT_CURRENT',
    });
  });

  it('advance acceptance: an upcoming version (PUBLISHED, validFrom in the future) is acceptable while the current one is still in effect', async () => {
    await seedVersion({ validFrom: new Date('2026-07-01T00:00:00Z') });
    await seedVersion({ id: 'v-next', validFrom: new Date('2026-08-01T00:00:00Z'), publishedAt: NOW });
    await states.save(aState({ id: 'cvs-next', versionId: 'v-next', state: 'PENDING_NOTIFICATION' }));

    const response = await service.accept(acceptInput({ versionId: 'v-next' }));

    expect(response.state).toBe('ACCEPTED');
    expect((await states.findByCustomerAndVersion('c-123', 'v-next'))?.state).toBe('ACCEPTED');
    expect(await acceptances.findEffective('c-123', 'v-next')).toMatchObject({ method: 'ACTIVE_CONSENT' });
    // The current version remains open — both may be accepted independently.
    await states.save(aState({ id: 'cvs-cur', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));
    const currentResponse = await service.accept(acceptInput({ versionId: 'v-1', idempotencyKey: 'key-2' }));
    expect(currentResponse.state).toBe('ACCEPTED');
  });

  it('advance acceptance: the FAR (second) future version is acceptable, not only the nearest upcoming one', async () => {
    await seedVersion({ validFrom: new Date('2026-07-01T00:00:00Z') });
    await seedVersion({ id: 'v-near', validFrom: new Date('2026-08-01T00:00:00Z'), publishedAt: NOW });
    await seedVersion({ id: 'v-far', validFrom: new Date('2026-10-01T00:00:00Z'), publishedAt: NOW });
    await states.save(aState({ id: 'cvs-far', versionId: 'v-far', state: 'PENDING_NOTIFICATION' }));

    const response = await service.accept(acceptInput({ versionId: 'v-far' }));

    expect(response.state).toBe('ACCEPTED');
    expect((await states.findByCustomerAndVersion('c-123', 'v-far'))?.state).toBe('ACCEPTED');
  });

  it('a RETIRED old revision stays rejected as VERSION_NOT_CURRENT (only current or upcoming are acceptable)', async () => {
    await seedVersion({ id: 'v-old', status: 'RETIRED', validFrom: new Date('2026-06-01T00:00:00Z') });
    await seedVersion({ validFrom: new Date('2026-07-01T00:00:00Z') });

    await expect(service.accept(acceptInput({ versionId: 'v-old' }))).rejects.toMatchObject({
      code: 'VERSION_NOT_CURRENT',
    });
  });

  it('ROLE_MISMATCH when the customer does not have the audience role', async () => {
    await seedVersion();
    await customers.save(aCustomer({ roles: ['partner'] }));

    await expect(service.accept(acceptInput())).rejects.toMatchObject({ code: 'ROLE_MISMATCH' });
  });

  it('CONSENT_TEXT_MISMATCH when the displayed text deviates', async () => {
    await seedVersion();

    await expect(
      service.accept(acceptInput({ displayedConsentText: 'different text' })),
    ).rejects.toMatchObject({ code: 'CONSENT_TEXT_MISMATCH' });
  });

  it('ACTIVE version still requires the displayed consent text — omitting it throws CONSENT_TEXT_REQUIRED', async () => {
    await seedVersion();

    await expect(
      service.accept(acceptInput({ displayedConsentText: undefined })),
    ).rejects.toMatchObject({ code: 'CONSENT_TEXT_REQUIRED' });
  });

  describe('PASSIVE early active acceptance (before the objection deadline)', () => {
    // Default aVersion() is PASSIVE (acceptanceMode PASSIVE, no consentText).
    const seedPassiveVersion = async () => versions.save(aVersion({ id: 'v-1' }));

    it('accepts with no consentText, records method ACTIVE_CONSENT + the fixed affirmation, no CONSENT_TEXT_REQUIRED', async () => {
      await seedPassiveVersion();
      await states.save(aState({ state: 'NOTIFIED', notifiedAt: NOW }));

      const response = await service.accept(acceptInput({ displayedConsentText: undefined }));

      expect(response.state).toBe('ACCEPTED');
      const acceptance = await acceptances.findEffective('c-123', 'v-1');
      expect(acceptance).toMatchObject({
        method: 'ACTIVE_CONSENT',
        channel: 'PORTAL',
        evidenceNote: 'Actively accepted before the objection deadline',
      });
      expect(acceptance?.consentText).toBeUndefined();
      expect(acceptance?.consentTextHash).toBeUndefined();
    });

    it('via LINK: keeps the self-declared evidence note AND appends the affirmation', async () => {
      await seedPassiveVersion();
      await states.save(aState({ state: 'NOTIFIED', notifiedAt: NOW }));

      await service.accept(
        acceptInput({
          displayedConsentText: undefined,
          channel: 'LINK',
          evidenceNote: 'identity self-declared via acceptance link al-1',
        }),
      );

      const acceptance = await acceptances.findEffective('c-123', 'v-1');
      expect(acceptance?.evidenceNote).toBe(
        'identity self-declared via acceptance link al-1 — Actively accepted before the objection deadline',
      );
    });

    it('still fires VERSION_ACCEPTED (CONSENT / CUSTOMER)', async () => {
      await seedPassiveVersion();
      await states.save(aState({ state: 'NOTIFIED', notifiedAt: NOW }));

      await service.accept(acceptInput({ displayedConsentText: undefined }));

      const { items } = await events.query({});
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'VERSION_ACCEPTED',
        category: 'CONSENT',
        actorKind: 'CUSTOMER',
        channel: 'PORTAL',
        versionId: 'v-1',
      });
    });
  });

  it('CUSTOMER_NOT_FOUND for an unknown customer', async () => {
    await seedVersion();

    await expect(
      service.accept(acceptInput({ customerId: 'c-unknown', context: context('c-unknown') })),
    ).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('race: state becomes SUPERSEDED between read and write → INVALID_STATE, no acceptance, no overwrite', async () => {
    await seedVersion();
    // Repo with a stale read: the store already holds SUPERSEDED (publish in parallel to the consent).
    class StaleReadStateRepo extends InMemoryCustomerVersionStateRepo {
      staleSnapshot?: ReturnType<typeof aState>;

      override async findByCustomerAndVersion(customerId: string, versionId: string) {
        return this.staleSnapshot ?? super.findByCustomerAndVersion(customerId, versionId);
      }
    }
    const staleStates = new StaleReadStateRepo();
    const staleSnapshot = aState({ state: 'NOTIFIED', notifiedAt: NOW });
    await staleStates.save({ ...staleSnapshot, state: 'SUPERSEDED' });
    staleStates.staleSnapshot = staleSnapshot;
    const raceService = new AcceptanceService(
      versions,
      documents,
      customers,
      staleStates,
      acceptances,
      idempotency,
      new SequentialIdGenerator(),
      clock,
    );

    await expect(raceService.accept(acceptInput())).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await staleStates.findById('cvs-1'))?.state).toBe('SUPERSEDED');
    expect(await acceptances.findByCustomer('c-123')).toHaveLength(0);
  });

  it('race: state becomes ACCEPTED between read and write → ALREADY_ACCEPTED, no second acceptance', async () => {
    await seedVersion();
    class StaleReadStateRepo extends InMemoryCustomerVersionStateRepo {
      staleSnapshot?: ReturnType<typeof aState>;

      override async findByCustomerAndVersion(customerId: string, versionId: string) {
        return this.staleSnapshot ?? super.findByCustomerAndVersion(customerId, versionId);
      }
    }
    const staleStates = new StaleReadStateRepo();
    const staleSnapshot = aState({ state: 'NOTIFIED', notifiedAt: NOW });
    await staleStates.save({ ...staleSnapshot, state: 'ACCEPTED' });
    staleStates.staleSnapshot = staleSnapshot;
    const raceService = new AcceptanceService(
      versions,
      documents,
      customers,
      staleStates,
      acceptances,
      idempotency,
      new SequentialIdGenerator(),
      clock,
    );

    await expect(raceService.accept(acceptInput())).rejects.toMatchObject({ code: 'ALREADY_ACCEPTED' });
    expect(await acceptances.findByCustomer('c-123')).toHaveLength(0);
  });

  describe('event recording', () => {
    it('records a CONSENT / VERSION_ACCEPTED / CUSTOMER event on a successful acceptance', async () => {
      await seedVersion();
      await service.accept(acceptInput());
      const { items } = await events.query({});
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'VERSION_ACCEPTED',
        category: 'CONSENT',
        actorKind: 'CUSTOMER',
        customerId: 'c-123',
        versionId: 'v-1',
        documentType: aDocument().type,
        channel: 'PORTAL',
      });
    });

    it('records NO event when acceptance validation fails', async () => {
      await seedVersion();
      await expect(service.accept(acceptInput({ displayedConsentText: 'tampered' }))).rejects.toBeDefined();
      expect((await events.query({})).total).toBe(0);
    });
  });
});
