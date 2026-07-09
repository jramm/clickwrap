import type { CustomerContext } from '../common/auth/actor';
import { FixedClock } from '../domain/clock';
import { aDocument, anActiveVersion, aState, aVersion, testActor } from '../domain/testing/fixtures';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryEventRepo,
  InMemoryObjectionRepo,
} from '../persistence/inmemory';
import { InMemoryEscalationLog } from '../common/escalation/escalation-log.inmemory';
import { EventRecorder } from '../events/event-recorder';
import { InMemoryIdempotencyStore, SequentialIdGenerator } from './inmemory';
import { ObjectionService } from './objection.service';

const NOTIFIED_AT = new Date('2026-07-01T00:00:00Z');
const DEADLINE_AT = new Date('2026-07-15T00:00:00Z'); // notifiedAt + 14d (PASSIVE)
const BEFORE_DEADLINE = new Date('2026-07-08T00:00:00Z');
const AFTER_DEADLINE = new Date('2026-07-20T00:00:00Z');

const context = (customerId = 'c-123'): CustomerContext => ({
  customerId,
  actor: testActor(),
});

describe('ObjectionService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let objections: InMemoryObjectionRepo;
  let escalations: InMemoryEscalationLog;
  let idempotency: InMemoryIdempotencyStore;
  let eventRepo: InMemoryEventRepo;
  let clock: FixedClock;
  let service: ObjectionService;

  const input = (overrides: Partial<Parameters<ObjectionService['object']>[0]> = {}) => ({
    customerId: 'c-123',
    versionId: 'v-1',
    reason: 'Sub-processor XY is not accepted.',
    idempotencyKey: 'key-1',
    context: context(),
    ...overrides,
  });

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    states = new InMemoryCustomerVersionStateRepo();
    objections = new InMemoryObjectionRepo();
    escalations = new InMemoryEscalationLog();
    idempotency = new InMemoryIdempotencyStore();
    eventRepo = new InMemoryEventRepo();
    clock = new FixedClock(BEFORE_DEADLINE);
    service = new ObjectionService(
      versions,
      states,
      objections,
      escalations,
      idempotency,
      new SequentialIdGenerator(),
      clock,
      new EventRecorder(eventRepo, clock),
    );
    // PASSIVE version + NOTIFIED state within the period.
    await documents.save(aDocument());
    await versions.save(aVersion({ id: 'v-1', acceptanceMode: 'PASSIVE', objectionPeriodDays: 14 }));
    await states.save(aState({ state: 'NOTIFIED', notifiedAt: NOTIFIED_AT, deadlineAt: DEADLINE_AT }));
  });

  it('happy path: objection within the period → OBJECTED, objection appended', async () => {
    const response = await service.object(input());

    expect(response).toEqual({ objectionId: 'o-1', state: 'OBJECTED' });
    expect((await states.findByCustomerAndVersion('c-123', 'v-1'))?.state).toBe('OBJECTED');
    const stored = await objections.findByCustomerAndVersion('c-123', 'v-1');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ channel: 'PORTAL', reason: input().reason, objectedAt: BEFORE_DEADLINE });
  });

  it('records an OBJECTION_RAISED event on a successful objection', async () => {
    const response = await service.object(input());

    expect(response).toEqual({ objectionId: 'o-1', state: 'OBJECTED' });
    const { items } = await eventRepo.query({});
    expect(items[0]).toMatchObject({ type: 'OBJECTION_RAISED', category: 'CONSENT', actorKind: 'CUSTOMER' });
  });

  it('idempotency replay: same key → identical response, only one objection', async () => {
    const first = await service.object(input({ idempotencyKey: 'key-x' }));
    const second = await service.object(input({ idempotencyKey: 'key-x' }));

    expect(second).toEqual(first);
    expect(await objections.findByCustomer('c-123')).toHaveLength(1);
  });

  it('OBJECTION_NOT_APPLICABLE for an ACTIVE version — no objection, no escalation note', async () => {
    await versions.save(anActiveVersion({ id: 'v-1' }));

    await expect(service.object(input())).rejects.toMatchObject({ code: 'OBJECTION_NOT_APPLICABLE' });
    expect(await objections.findByCustomer('c-123')).toHaveLength(0);
    expect(await escalations.findByCustomer('c-123')).toHaveLength(0);
  });

  it('OBJECTION_PERIOD_EXPIRED after the deadline: error + escalation note, but no objection', async () => {
    clock.set(AFTER_DEADLINE);

    await expect(service.object(input())).rejects.toMatchObject({ code: 'OBJECTION_PERIOD_EXPIRED' });
    expect(await objections.findByCustomer('c-123')).toHaveLength(0);
    const notes = await escalations.findByCustomer('c-123');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ versionId: 'v-1', occurredAt: AFTER_DEADLINE });
  });

  it('VERSION_NOT_FOUND for an unknown version', async () => {
    await expect(service.object(input({ versionId: 'nope' }))).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    });
  });

  it('INVALID_STATE when no rollout state exists', async () => {
    await expect(
      service.object(input({ customerId: 'c-999', context: context('c-999') })),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('race: state becomes ACCEPTED between read and write → INVALID_STATE, no objection, no overwrite', async () => {
    class StaleReadStateRepo extends InMemoryCustomerVersionStateRepo {
      staleSnapshot?: ReturnType<typeof aState>;

      override async findByCustomerAndVersion(customerId: string, versionId: string) {
        return this.staleSnapshot ?? super.findByCustomerAndVersion(customerId, versionId);
      }
    }
    const staleStates = new StaleReadStateRepo();
    const staleSnapshot = aState({ state: 'NOTIFIED', notifiedAt: NOTIFIED_AT, deadlineAt: DEADLINE_AT });
    await staleStates.save({ ...staleSnapshot, state: 'ACCEPTED' });
    staleStates.staleSnapshot = staleSnapshot;
    const raceService = new ObjectionService(
      versions,
      staleStates,
      objections,
      escalations,
      idempotency,
      new SequentialIdGenerator(),
      clock,
    );

    await expect(raceService.object(input())).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await staleStates.findById('cvs-1'))?.state).toBe('ACCEPTED');
    expect(await objections.findByCustomer('c-123')).toHaveLength(0);
  });
});
