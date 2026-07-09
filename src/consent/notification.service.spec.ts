import type { CustomerContext } from '../common/auth/actor';
import { FixedClock } from '../domain/clock';
import { aDocument, aState, aVersion, testActor } from '../domain/testing/fixtures';
import { EventRecorder } from '../events/event-recorder';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryEventRepo,
  InMemoryNotificationEventRepo,
} from '../persistence/inmemory';
import { SequentialIdGenerator } from './inmemory';
import { NotificationService } from './notification.service';

const NOW = new Date('2026-07-08T08:00:00Z');
const DEADLINE = new Date('2026-07-22T08:00:00Z'); // NOW + 14d (PASSIVE)

const context = (customerId = 'c-123'): CustomerContext => ({
  customerId,
  actor: testActor(),
});

describe('NotificationService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let events: InMemoryNotificationEventRepo;
  let eventRepo: InMemoryEventRepo;
  let clock: FixedClock;
  let service: NotificationService;

  const input = (overrides: Partial<Parameters<NotificationService['notify']>[0]> = {}) => ({
    customerId: 'c-123',
    versionId: 'v-1',
    channel: 'PORTAL' as const,
    context: context(),
    ...overrides,
  });

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    states = new InMemoryCustomerVersionStateRepo();
    events = new InMemoryNotificationEventRepo();
    eventRepo = new InMemoryEventRepo();
    clock = new FixedClock(NOW);
    service = new NotificationService(
      versions,
      states,
      events,
      new SequentialIdGenerator(),
      clock,
      new EventRecorder(eventRepo, clock),
    );
    await documents.save(aDocument());
    await versions.save(aVersion({ id: 'v-1', acceptanceMode: 'PASSIVE', objectionPeriodDays: 14 }));
  });

  it('happy path: first access → NOTIFIED, notifiedAt = server time, deadlineAt computed, PORTAL event', async () => {
    await states.save(aState({ state: 'PENDING_NOTIFICATION' }));

    const response = await service.notify(input());

    expect(response).toEqual({ state: 'NOTIFIED', notifiedAt: NOW, deadlineAt: DEADLINE });
    const stored = await events.findByState('cvs-1');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ channel: 'PORTAL', recipient: 'u-42', occurredAt: NOW });
  });

  it('channel LINK (hosted page render): NOTIFIED with server time + LINK event attributed to the link', async () => {
    await states.save(aState({ state: 'PENDING_NOTIFICATION' }));

    const response = await service.notify(
      input({
        channel: 'LINK',
        context: { customerId: 'c-123', actor: { userId: 'link:al-1' } },
      }),
    );

    expect(response).toEqual({ state: 'NOTIFIED', notifiedAt: NOW, deadlineAt: DEADLINE });
    const stored = await events.findByState('cvs-1');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ channel: 'LINK', recipient: 'link:al-1', occurredAt: NOW });
  });

  it('uses server time instead of the client-supplied displayedAt (even with a large deviation)', async () => {
    await states.save(aState({ state: 'PENDING_NOTIFICATION' }));

    const response = await service.notify(input({ displayedAt: new Date('2026-06-01T00:00:00Z') }));

    expect(response.notifiedAt).toEqual(NOW);
    expect(response.deadlineAt).toEqual(DEADLINE);
  });

  it('carry-over: a carryOverBlocking state starts blocking immediately (deadlineAt = notifiedAt)', async () => {
    await states.save(aState({ state: 'PENDING_NOTIFICATION', carryOverBlocking: true }));

    const response = await service.notify(input());

    expect(response.notifiedAt).toEqual(NOW);
    expect(response.deadlineAt).toEqual(NOW);
  });

  it('idempotent: repeated access does not reset notifiedAt, only one event', async () => {
    await states.save(aState({ state: 'PENDING_NOTIFICATION' }));

    await service.notify(input());
    clock.advanceDays(3);
    const second = await service.notify(input());

    expect(second.notifiedAt).toEqual(NOW);
    expect(second.deadlineAt).toEqual(DEADLINE);
    expect(await events.findByState('cvs-1')).toHaveLength(1);
  });

  it('VERSION_NOT_FOUND for an unknown version', async () => {
    await states.save(aState({ state: 'PENDING_NOTIFICATION' }));

    await expect(service.notify(input({ versionId: 'nope' }))).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    });
  });

  it('INVALID_STATE when no rollout state exists', async () => {
    await expect(service.notify(input())).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('access on a SUPERSEDED state: no-op — no NOTIFIED rewrite, no NotificationEvent', async () => {
    await states.save(aState({ state: 'SUPERSEDED' }));

    const response = await service.notify(input());

    expect(response.state).toBe('SUPERSEDED');
    expect(response.notifiedAt).toBeUndefined();
    expect((await states.findById('cvs-1'))?.state).toBe('SUPERSEDED');
    expect(await events.findByState('cvs-1')).toHaveLength(0);
  });

  it('race: supersede between state read and write → no resurrection, no event', async () => {
    // Repo that returns a stale PENDING snapshot on read while the store already holds
    // SUPERSEDED — simulates publishing the successor version in parallel with the delivery evidence.
    class StaleReadStateRepo extends InMemoryCustomerVersionStateRepo {
      staleSnapshot?: import('../domain/types').CustomerVersionState;

      override async findByCustomerAndVersion(customerId: string, versionId: string) {
        return this.staleSnapshot ?? super.findByCustomerAndVersion(customerId, versionId);
      }
    }
    const staleStates = new StaleReadStateRepo();
    const staleSnapshot = aState({ state: 'PENDING_NOTIFICATION' });
    await staleStates.save({ ...staleSnapshot, state: 'SUPERSEDED' });
    staleStates.staleSnapshot = staleSnapshot;
    const raceService = new NotificationService(versions, staleStates, events, new SequentialIdGenerator(), clock);

    const response = await raceService.notify(input());

    expect(response.state).toBe('SUPERSEDED');
    expect((await staleStates.findById('cvs-1'))?.state).toBe('SUPERSEDED');
    expect(await events.findByState('cvs-1')).toHaveLength(0);
  });

  describe('event recording', () => {
    it('records a PAGE_ACCESSED event on the first provable access', async () => {
      await states.save(aState({ state: 'PENDING_NOTIFICATION' }));

      const response = await service.notify(input());

      expect(response).toEqual({ state: 'NOTIFIED', notifiedAt: NOW, deadlineAt: DEADLINE });
      expect((await eventRepo.query({})).items[0]).toMatchObject({
        type: 'PAGE_ACCESSED',
        category: 'ACCESS',
        actorKind: 'CUSTOMER',
      });
    });
  });
});
