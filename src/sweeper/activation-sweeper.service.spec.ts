import { FixedClock } from '../domain/clock';
import { sweep } from '../domain/state-machine';
import { aDocument, aState, aVersion } from '../domain/testing/fixtures';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import { ActivationSweeperService } from './activation-sweeper.service';

const T0 = new Date('2026-07-07T09:00:00Z');
const VALID_FROM = new Date('2026-08-01T00:00:00Z');
const AFTER_FLIP = new Date('2026-08-01T06:00:00Z');

describe('ActivationSweeperService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let clock: FixedClock;
  let service: ActivationSweeperService;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    states = new InMemoryCustomerVersionStateRepo();
    clock = new FixedClock(T0);
    service = new ActivationSweeperService(documents, versions, states, clock);
    await documents.save(aDocument({ id: 'doc-dpa-customer', type: 'dpa', audience: 'customer' }));
  });

  afterEach(() => {
    delete process.env.SWEEPER_ENABLED;
  });

  /** Scheduled-publish scenario: predecessor still PUBLISHED, successor PUBLISHED with future validFrom. */
  const seedScheduledPair = async (): Promise<void> => {
    await versions.save(aVersion({ id: 'v-old', status: 'PUBLISHED', validFrom: new Date('2026-06-01T00:00:00Z'), publishedAt: new Date('2026-06-01T00:00:00Z') }));
    await versions.save(aVersion({ id: 'v-next', status: 'PUBLISHED', validFrom: VALID_FROM, publishedAt: T0 }));
  };

  it('before validFrom: a no-op — the predecessor stays PUBLISHED and its states stay open', async () => {
    await seedScheduledPair();
    await states.save(aState({ id: 'cvs-old', customerId: 'c-1', versionId: 'v-old', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));

    await service.run();

    expect((await versions.findById('v-old'))?.status).toBe('PUBLISHED');
    expect((await states.findById('cvs-old'))?.state).toBe('NOTIFIED');
  });

  it('at/after validFrom: retires the predecessor and supersedes its open states — the sweeper never books TACIT afterwards', async () => {
    await seedScheduledPair();
    await states.save(aState({ id: 'cvs-old', customerId: 'c-1', versionId: 'v-old', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));
    clock.set(AFTER_FLIP);

    await service.run();

    expect((await versions.findById('v-old'))?.status).toBe('RETIRED');
    expect((await versions.findById('v-next'))?.status).toBe('PUBLISHED');
    const superseded = await states.findById('cvs-old');
    expect(superseded?.state).toBe('SUPERSEDED');
    // SUPERSEDED is terminal for the deadline sweeper: never a TACIT booking afterwards.
    clock.set(new Date('2026-09-01T00:00:00Z'));
    expect(sweep(superseded!, aVersion({ id: 'v-old' }), clock).outcome).toBe('NOOP');
  });

  it('block carry-over at the flip: EXPIRED_BLOCKING predecessor state → carryOverBlocking=true on the successor state', async () => {
    await seedScheduledPair();
    await states.save(aState({ id: 'cvs-blocked', customerId: 'c-1', versionId: 'v-old', state: 'EXPIRED_BLOCKING' }));
    await states.save(aState({ id: 'cvs-next', customerId: 'c-1', versionId: 'v-next', state: 'PENDING_NOTIFICATION' }));
    clock.set(AFTER_FLIP);

    await service.run();

    expect((await states.findById('cvs-blocked'))?.state).toBe('SUPERSEDED');
    expect((await states.findById('cvs-next'))?.carryOverBlocking).toBe(true);
  });

  it('block carry-over reaches a successor state that is already NOTIFIED (blocks immediately via isBlocking)', async () => {
    await seedScheduledPair();
    await states.save(aState({ id: 'cvs-blocked', customerId: 'c-1', versionId: 'v-old', state: 'EXPIRED_BLOCKING' }));
    await states.save(
      aState({ id: 'cvs-next', customerId: 'c-1', versionId: 'v-next', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-08-15T00:00:00Z') }),
    );
    clock.set(AFTER_FLIP);

    await service.run();

    expect(await states.findById('cvs-next')).toMatchObject({ state: 'NOTIFIED', carryOverBlocking: true });
  });

  it('block carry-over never touches a successor state that was already ACCEPTED in advance', async () => {
    await seedScheduledPair();
    await states.save(aState({ id: 'cvs-blocked', customerId: 'c-1', versionId: 'v-old', state: 'EXPIRED_BLOCKING' }));
    await states.save(aState({ id: 'cvs-next', customerId: 'c-1', versionId: 'v-next', state: 'ACCEPTED' }));
    clock.set(AFTER_FLIP);

    await service.run();

    expect(await states.findById('cvs-next')).toMatchObject({ state: 'ACCEPTED' });
    expect((await states.findById('cvs-next'))?.carryOverBlocking).toBeUndefined();
  });

  it('creates a carry-over successor state when the rollout state is missing (defensive: the block never silently disappears)', async () => {
    await seedScheduledPair();
    await states.save(aState({ id: 'cvs-blocked', customerId: 'c-1', versionId: 'v-old', state: 'EXPIRED_BLOCKING' }));
    clock.set(AFTER_FLIP);

    await service.run();

    const successor = await states.findByCustomerAndVersion('c-1', 'v-next');
    expect(successor).toMatchObject({ state: 'PENDING_NOTIFICATION', carryOverBlocking: true });
  });

  it('is idempotent: a second run after the flip changes nothing', async () => {
    await seedScheduledPair();
    await states.save(aState({ id: 'cvs-old', customerId: 'c-1', versionId: 'v-old', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));
    clock.set(AFTER_FLIP);

    await service.run();
    await service.run();

    expect((await versions.findById('v-old'))?.status).toBe('RETIRED');
    expect((await states.findById('cvs-old'))?.state).toBe('SUPERSEDED');
  });

  it('leaves a LATER upcoming version untouched (only versions whose validFrom has passed are retired)', async () => {
    await seedScheduledPair();
    await versions.save(aVersion({ id: 'v-later', status: 'PUBLISHED', validFrom: new Date('2026-10-01T00:00:00Z'), publishedAt: T0 }));
    clock.set(AFTER_FLIP);

    await service.run();

    expect((await versions.findById('v-old'))?.status).toBe('RETIRED');
    expect((await versions.findById('v-next'))?.status).toBe('PUBLISHED');
    expect((await versions.findById('v-later'))?.status).toBe('PUBLISHED');
  });

  it('kill switch: SWEEPER_ENABLED=false → complete no-op', async () => {
    await seedScheduledPair();
    clock.set(AFTER_FLIP);
    process.env.SWEEPER_ENABLED = 'false';

    await service.run();

    expect((await versions.findById('v-old'))?.status).toBe('PUBLISHED');
  });

  it('per-entry error isolation: a failing document does not abort the run for the others', async () => {
    await documents.save(aDocument({ id: 'doc-terms-customer', type: 'terms', audience: 'customer', name: 'Terms — Customers' }));
    await seedScheduledPair();
    await versions.save(aVersion({ id: 'v-terms-old', documentId: 'doc-terms-customer', status: 'PUBLISHED', validFrom: new Date('2026-06-01T00:00:00Z') }));
    await versions.save(aVersion({ id: 'v-terms-next', documentId: 'doc-terms-customer', status: 'PUBLISHED', validFrom: VALID_FROM, publishedAt: T0 }));
    clock.set(AFTER_FLIP);

    const originalFindByDocument = versions.findByDocument.bind(versions);
    jest.spyOn(versions, 'findByDocument').mockImplementation(async (documentId: string) => {
      if (documentId === 'doc-dpa-customer') {
        throw new Error('Boom while loading doc-dpa-customer');
      }
      return originalFindByDocument(documentId);
    });

    await service.run();

    // The failing document is skipped (nothing retired) — the other one is still processed.
    expect((await versions.findById('v-old'))?.status).toBe('PUBLISHED');
    expect((await versions.findById('v-terms-old'))?.status).toBe('RETIRED');
  });
});
