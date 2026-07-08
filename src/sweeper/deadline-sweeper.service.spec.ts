import { FixedClock } from '../domain/clock';
import { consentTextHashFor } from '../domain/consent-rules';
import type { AgreementVersionRepo } from '../domain/ports';
import { aState, anActiveVersion, aVersion } from '../domain/testing/fixtures';
import type { AgreementVersion, CustomerVersionState } from '../domain/types';
import { InMemoryAcceptanceRepo } from '../persistence/inmemory/acceptance.repo';
import { InMemoryCustomerVersionStateRepo } from '../persistence/inmemory/customer-version-state.repo';
import type { AcceptanceConfirmationService } from '../plugins/email/core/acceptance-confirmation.service';
import { DeadlineSweeperService } from './deadline-sweeper.service';

/** Minimal fake: only findById is needed by the sweeper; can be made to throw deliberately for error tests. */
class FakeAgreementVersionRepo implements AgreementVersionRepo {
  private readonly versions = new Map<string, AgreementVersion>();
  private failingId?: string;

  seed(version: AgreementVersion): void {
    this.versions.set(version.id, version);
  }

  failOn(id: string): void {
    this.failingId = id;
  }

  async findById(id: string) {
    if (id === this.failingId) {
      throw new Error(`Boom while loading ${id}`);
    }
    return this.versions.get(id);
  }

  async save(): Promise<AgreementVersion> {
    throw new Error('not implemented');
  }

  async findByDocument(): Promise<AgreementVersion[]> {
    throw new Error('not implemented');
  }

  async findCurrentPublished(): Promise<AgreementVersion | undefined> {
    throw new Error('not implemented');
  }

  async findUpcomingPublishedList(): Promise<AgreementVersion[]> {
    throw new Error('not implemented');
  }

  async delete(): Promise<void> {
    throw new Error('not implemented');
  }
}

/**
 * Fake for race-condition tests: a real in-memory store, but `findDueForSweep` returns a settable
 * (possibly stale) candidate list — simulates the snapshot gap between findDue and processing.
 */
class StaleDueCustomerVersionStateRepo extends InMemoryCustomerVersionStateRepo {
  private dueStates: CustomerVersionState[] = [];

  setDue(states: CustomerVersionState[]): void {
    this.dueStates = states;
  }

  override async findDueForSweep(): Promise<CustomerVersionState[]> {
    return this.dueStates;
  }
}

const T0 = new Date('2026-07-21T09:00:00Z');

describe('DeadlineSweeperService', () => {
  const originalEnabled = process.env.SWEEPER_ENABLED;

  afterEach(() => {
    process.env.SWEEPER_ENABLED = originalEnabled;
  });

  it('PASSIVE + deadline reached: records Acceptance(TACIT, SYSTEM) and sets state to ACCEPTED', async () => {
    process.env.SWEEPER_ENABLED = 'true';
    const version = aVersion({ id: 'v-1', objectionPeriodDays: 14, consentText: undefined });
    const versionRepo = new FakeAgreementVersionRepo();
    versionRepo.seed(version);
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    await stateRepo.save(
      aState({
        id: 'cvs-1',
        customerId: 'c-123',
        versionId: 'v-1',
        state: 'NOTIFIED',
        notifiedAt: new Date('2026-07-07T09:00:00Z'),
        deadlineAt: new Date('2026-07-21T09:00:00Z'),
      }),
    );
    const acceptanceRepo = new InMemoryAcceptanceRepo();
    const clock = new FixedClock(T0);
    const service = new DeadlineSweeperService(stateRepo, versionRepo, acceptanceRepo, clock);

    await service.run();

    const state = await stateRepo.findById('cvs-1');
    expect(state?.state).toBe('ACCEPTED');

    const acceptance = await acceptanceRepo.findEffective('c-123', 'v-1');
    expect(acceptance).toMatchObject({
      method: 'TACIT',
      channel: 'SYSTEM',
      customerId: 'c-123',
      versionId: 'v-1',
      isEffective: true,
      contentHash: version.contentHash,
    });
    expect(acceptance?.actor.userId).toBe('system:deadline-sweeper');
    expect(acceptance?.acceptedAt.toISOString()).toBe(T0.toISOString());
  });

  it('TACIT acceptance: invokes the acceptance-confirmation sender with the version + acceptance', async () => {
    process.env.SWEEPER_ENABLED = 'true';
    const version = aVersion({ id: 'v-1', objectionPeriodDays: 14, consentText: undefined });
    const versionRepo = new FakeAgreementVersionRepo();
    versionRepo.seed(version);
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    await stateRepo.save(
      aState({
        id: 'cvs-1',
        customerId: 'c-123',
        versionId: 'v-1',
        state: 'NOTIFIED',
        notifiedAt: new Date('2026-07-07T09:00:00Z'),
        deadlineAt: new Date('2026-07-21T09:00:00Z'),
      }),
    );
    const acceptanceRepo = new InMemoryAcceptanceRepo();
    const confirmation = { sendForAcceptance: jest.fn().mockResolvedValue(undefined) };
    const service = new DeadlineSweeperService(
      stateRepo,
      versionRepo,
      acceptanceRepo,
      new FixedClock(T0),
      confirmation as unknown as AcceptanceConfirmationService,
    );

    await service.run();

    expect(confirmation.sendForAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'v-1' }),
      expect.objectContaining({ method: 'TACIT', channel: 'SYSTEM' }),
    );
  });

  it('carries over consentText/consentTextHash from the version, if present', async () => {
    process.env.SWEEPER_ENABLED = 'true';
    const version = aVersion({ id: 'v-1', objectionPeriodDays: 14, consentText: 'Notice text PASSIVE' });
    const versionRepo = new FakeAgreementVersionRepo();
    versionRepo.seed(version);
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    await stateRepo.save(
      aState({
        id: 'cvs-1',
        customerId: 'c-123',
        versionId: 'v-1',
        state: 'NOTIFIED',
        notifiedAt: new Date('2026-07-07T09:00:00Z'),
        deadlineAt: new Date('2026-07-21T09:00:00Z'),
      }),
    );
    const acceptanceRepo = new InMemoryAcceptanceRepo();
    const clock = new FixedClock(T0);
    const service = new DeadlineSweeperService(stateRepo, versionRepo, acceptanceRepo, clock);

    await service.run();

    const acceptance = await acceptanceRepo.findEffective('c-123', 'v-1');
    expect(acceptance?.consentText).toBe('Notice text PASSIVE');
    expect(acceptance?.consentTextHash).toBe(consentTextHashFor(version));
  });

  it('ACTIVE + grace period reached: sets state to EXPIRED_BLOCKING without an acceptance', async () => {
    process.env.SWEEPER_ENABLED = 'true';
    const version = anActiveVersion({ id: 'v-1', gracePeriodDays: 14 });
    const versionRepo = new FakeAgreementVersionRepo();
    versionRepo.seed(version);
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    await stateRepo.save(
      aState({
        id: 'cvs-1',
        customerId: 'c-123',
        versionId: 'v-1',
        state: 'NOTIFIED',
        notifiedAt: new Date('2026-07-07T09:00:00Z'),
        deadlineAt: new Date('2026-07-21T09:00:00Z'),
      }),
    );
    const acceptanceRepo = new InMemoryAcceptanceRepo();
    const clock = new FixedClock(T0);
    const service = new DeadlineSweeperService(stateRepo, versionRepo, acceptanceRepo, clock);

    await service.run();

    const state = await stateRepo.findById('cvs-1');
    expect(state?.state).toBe('EXPIRED_BLOCKING');
    expect(await acceptanceRepo.findEffective('c-123', 'v-1')).toBeUndefined();
  });

  it('kill switch: SWEEPER_ENABLED=false → a full no-op', async () => {
    process.env.SWEEPER_ENABLED = 'false';
    const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
    const versionRepo = new FakeAgreementVersionRepo();
    versionRepo.seed(version);
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    await stateRepo.save(
      aState({
        id: 'cvs-1',
        customerId: 'c-123',
        versionId: 'v-1',
        state: 'NOTIFIED',
        notifiedAt: new Date('2026-07-07T09:00:00Z'),
        deadlineAt: new Date('2026-07-21T09:00:00Z'),
      }),
    );
    const acceptanceRepo = new InMemoryAcceptanceRepo();
    const clock = new FixedClock(T0);
    const service = new DeadlineSweeperService(stateRepo, versionRepo, acceptanceRepo, clock);

    await service.run();

    const state = await stateRepo.findById('cvs-1');
    expect(state?.state).toBe('NOTIFIED');
    expect(await acceptanceRepo.findEffective('c-123', 'v-1')).toBeUndefined();
  });

  it('a superseded version (SUPERSEDED) NEVER produces a TACIT acceptance (defense in depth)', async () => {
    process.env.SWEEPER_ENABLED = 'true';
    const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
    const versionRepo = new FakeAgreementVersionRepo();
    versionRepo.seed(version);
    const stateRepo = new StaleDueCustomerVersionStateRepo();
    const supersededState = aState({
      id: 'cvs-1',
      customerId: 'c-123',
      versionId: 'v-1',
      state: 'SUPERSEDED',
      notifiedAt: new Date('2026-07-07T09:00:00Z'),
      deadlineAt: new Date('2026-07-21T09:00:00Z'),
    });
    await stateRepo.save(supersededState);
    stateRepo.setDue([supersededState]);
    const acceptanceRepo = new InMemoryAcceptanceRepo();
    const clock = new FixedClock(T0);
    const service = new DeadlineSweeperService(stateRepo, versionRepo, acceptanceRepo, clock);

    await service.run();

    expect((await stateRepo.findById('cvs-1'))?.state).toBe('SUPERSEDED');
    expect(await acceptanceRepo.findEffective('c-123', 'v-1')).toBeUndefined();
  });

  it('race condition: state became ACCEPTED between findDue and processing → no overwrite, no TACIT acceptance', async () => {
    process.env.SWEEPER_ENABLED = 'true';
    const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
    const versionRepo = new FakeAgreementVersionRepo();
    versionRepo.seed(version);
    const stateRepo = new StaleDueCustomerVersionStateRepo();
    const staleSnapshot = aState({
      id: 'cvs-1',
      customerId: 'c-123',
      versionId: 'v-1',
      state: 'NOTIFIED',
      notifiedAt: new Date('2026-07-07T09:00:00Z'),
      deadlineAt: new Date('2026-07-21T09:00:00Z'),
    });
    // The store already holds the NEWER state (active acceptance after the findDue snapshot).
    await stateRepo.save({ ...staleSnapshot, state: 'ACCEPTED' });
    stateRepo.setDue([staleSnapshot]);
    const acceptanceRepo = new InMemoryAcceptanceRepo();
    const clock = new FixedClock(T0);
    const service = new DeadlineSweeperService(stateRepo, versionRepo, acceptanceRepo, clock);

    await service.run();

    expect((await stateRepo.findById('cvs-1'))?.state).toBe('ACCEPTED');
    expect(await acceptanceRepo.findEffective('c-123', 'v-1')).toBeUndefined();
  });

  it('robustness: an error on one entry does not abort the run — the rest are still processed', async () => {
    process.env.SWEEPER_ENABLED = 'true';
    const versionRepo = new FakeAgreementVersionRepo();
    versionRepo.seed(aVersion({ id: 'v-1', objectionPeriodDays: 14, consentText: undefined }));
    versionRepo.seed(aVersion({ id: 'v-3', objectionPeriodDays: 14, consentText: undefined }));
    versionRepo.failOn('v-2');
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const dueBase = { state: 'NOTIFIED' as const, notifiedAt: new Date('2026-07-07T09:00:00Z'), deadlineAt: new Date('2026-07-21T09:00:00Z') };
    await stateRepo.save(aState({ id: 'cvs-1', customerId: 'c-1', versionId: 'v-1', ...dueBase }));
    await stateRepo.save(aState({ id: 'cvs-2', customerId: 'c-2', versionId: 'v-2', ...dueBase }));
    await stateRepo.save(aState({ id: 'cvs-3', customerId: 'c-3', versionId: 'v-3', ...dueBase }));
    const acceptanceRepo = new InMemoryAcceptanceRepo();
    const clock = new FixedClock(T0);
    const service = new DeadlineSweeperService(stateRepo, versionRepo, acceptanceRepo, clock);

    await expect(service.run()).resolves.toBeUndefined();

    expect((await stateRepo.findById('cvs-1'))?.state).toBe('ACCEPTED');
    expect((await stateRepo.findById('cvs-2'))?.state).toBe('NOTIFIED'); // failed, stays for the next run
    expect((await stateRepo.findById('cvs-3'))?.state).toBe('ACCEPTED');
    expect(await acceptanceRepo.findEffective('c-1', 'v-1')).toBeDefined();
    expect(await acceptanceRepo.findEffective('c-3', 'v-3')).toBeDefined();
  });
});
