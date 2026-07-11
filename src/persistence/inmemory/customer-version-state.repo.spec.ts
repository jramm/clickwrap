import { DomainError } from '../../common/errors.js';
import { aState } from '../../domain/testing/fixtures.js';
import { InMemoryCustomerVersionStateRepo } from './customer-version-state.repo.js';

const T0 = new Date('2026-07-07T09:00:00Z');
const DEADLINE = new Date('2026-07-21T09:00:00Z');

describe('InMemoryCustomerVersionStateRepo', () => {
  let repo: InMemoryCustomerVersionStateRepo;

  beforeEach(() => {
    repo = new InMemoryCustomerVersionStateRepo();
  });

  it('save + findById / findByCustomerAndVersion', async () => {
    await repo.save(aState({ id: 'cvs-1' }));
    expect(await repo.findById('cvs-1')).toMatchObject({ id: 'cvs-1' });
    expect(await repo.findByCustomerAndVersion('c-123', 'v-1')).toMatchObject({ id: 'cvs-1' });
    expect(await repo.findByCustomerAndVersion('c-123', 'v-other')).toBeUndefined();
  });

  describe('setNotifiedAtomically (SET … WHERE notifiedAt IS NULL)', () => {
    it('sets state/notifiedAt/deadlineAt when notifiedAt is empty', async () => {
      await repo.save(aState({ id: 'cvs-1' }));
      const result = await repo.setNotifiedAtomically('cvs-1', {
        state: 'NOTIFIED',
        notifiedAt: T0,
        deadlineAt: DEADLINE,
      });
      expect(result).toMatchObject({ state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE });
      expect(await repo.findById('cvs-1')).toMatchObject({ state: 'NOTIFIED', notifiedAt: T0 });
    });

    it('second call is a no-op: the first delivery wins (no backdating/shifting the deadline)', async () => {
      await repo.save(aState({ id: 'cvs-1' }));
      await repo.setNotifiedAtomically('cvs-1', { state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE });
      const second = await repo.setNotifiedAtomically('cvs-1', {
        state: 'NOTIFIED',
        notifiedAt: new Date('2026-07-09T00:00:00Z'),
        deadlineAt: new Date('2026-07-23T00:00:00Z'),
      });
      expect(second).toMatchObject({ notifiedAt: T0, deadlineAt: DEADLINE });
    });

    it('unknown id → DomainError', async () => {
      await expect(
        repo.setNotifiedAtomically('missing', { state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }),
      ).rejects.toBeInstanceOf(DomainError);
    });

    it('does NOT resurrect a SUPERSEDED state (additional condition state=PENDING_NOTIFICATION)', async () => {
      // SUPERSEDED coming from PENDING_NOTIFICATION: notifiedAt is still empty — the old
      // WHERE-notifiedAt-IS-NULL condition alone would still write the delivery (resurrection).
      await repo.save(aState({ id: 'cvs-1', state: 'SUPERSEDED' }));
      const result = await repo.setNotifiedAtomically('cvs-1', {
        state: 'NOTIFIED',
        notifiedAt: T0,
        deadlineAt: DEADLINE,
      });
      expect(result.state).toBe('SUPERSEDED');
      expect(result.notifiedAt).toBeUndefined();
      const stored = await repo.findById('cvs-1');
      expect(stored?.state).toBe('SUPERSEDED');
      expect(stored?.notifiedAt).toBeUndefined();
    });
  });

  describe('transition (conditional transition: UPDATE … WHERE id AND state = expected)', () => {
    it('performs the transition when the stored state matches the expectation', async () => {
      await repo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));
      const result = await repo.transition('cvs-1', 'NOTIFIED', { state: 'ACCEPTED' });
      expect(result).toMatchObject({ state: 'ACCEPTED', notifiedAt: T0, deadlineAt: DEADLINE });
      expect(await repo.findById('cvs-1')).toMatchObject({ state: 'ACCEPTED' });
    });

    it('returns null and writes NOTHING when the stored state differs (precondition not met)', async () => {
      await repo.save(aState({ id: 'cvs-1', state: 'ACCEPTED', notifiedAt: T0 }));
      const result = await repo.transition('cvs-1', 'NOTIFIED', { state: 'EXPIRED_BLOCKING' });
      expect(result).toBeNull();
      expect(await repo.findById('cvs-1')).toMatchObject({ state: 'ACCEPTED' });
    });

    it('updates remindersSent only when the precondition matches', async () => {
      await repo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE, remindersSent: 0 }));
      const updated = await repo.transition('cvs-1', 'NOTIFIED', { state: 'NOTIFIED', remindersSent: 1 });
      expect(updated).toMatchObject({ state: 'NOTIFIED', remindersSent: 1 });

      await repo.save(aState({ id: 'cvs-1', state: 'ACCEPTED', notifiedAt: T0, remindersSent: 1 }));
      const denied = await repo.transition('cvs-1', 'NOTIFIED', { state: 'NOTIFIED', remindersSent: 2 });
      expect(denied).toBeNull();
      expect(await repo.findById('cvs-1')).toMatchObject({ state: 'ACCEPTED', remindersSent: 1 });
    });

    it('unknown id → null (nothing to change)', async () => {
      expect(await repo.transition('missing', 'NOTIFIED', { state: 'ACCEPTED' })).toBeNull();
    });
  });

  describe('findDueForSweep', () => {
    it('returns NOTIFIED and (ACTIVE) PENDING_NOTIFICATION with a due deadlineAt; excludes PASSIVE PENDING (no deadlineAt) and terminal states', async () => {
      await repo.save(aState({ id: 'due', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));
      await repo.save(aState({ id: 'exact', customerId: 'c-2', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-22T00:00:00Z') }));
      await repo.save(aState({ id: 'future', customerId: 'c-3', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-08-01T00:00:00Z') }));
      await repo.save(aState({ id: 'superseded', customerId: 'c-4', state: 'SUPERSEDED', notifiedAt: T0, deadlineAt: DEADLINE }));
      // ACTIVE PENDING (never accessed): the absolute hard deadline was stamped at rollout → picked up.
      await repo.save(aState({ id: 'active-pending-due', customerId: 'c-5', state: 'PENDING_NOTIFICATION', notifiedAt: undefined, deadlineAt: DEADLINE }));
      // PASSIVE PENDING (never accessed): no deadlineAt → naturally excluded.
      await repo.save(aState({ id: 'passive-pending', customerId: 'c-7', state: 'PENDING_NOTIFICATION' }));
      await repo.save(aState({ id: 'accepted', customerId: 'c-6', state: 'ACCEPTED', notifiedAt: T0, deadlineAt: DEADLINE }));

      const due = await repo.findDueForSweep(new Date('2026-07-22T00:00:00Z'));
      expect(due.map((s) => s.id).sort()).toEqual(['active-pending-due', 'due', 'exact']);
    });
  });

  describe('findOpenByVersion', () => {
    it('returns all non-terminal states of the version (excluding ACCEPTED/SUPERSEDED)', async () => {
      await repo.save(aState({ id: 'p', customerId: 'c-1', state: 'PENDING_NOTIFICATION' }));
      await repo.save(aState({ id: 'n', customerId: 'c-2', state: 'NOTIFIED' }));
      await repo.save(aState({ id: 'o', customerId: 'c-3', state: 'OBJECTED' }));
      await repo.save(aState({ id: 'x', customerId: 'c-4', state: 'EXPIRED_BLOCKING' }));
      await repo.save(aState({ id: 'a', customerId: 'c-5', state: 'ACCEPTED' }));
      await repo.save(aState({ id: 's', customerId: 'c-6', state: 'SUPERSEDED' }));
      await repo.save(aState({ id: 'other', customerId: 'c-1', versionId: 'v-2', state: 'NOTIFIED' }));

      const open = await repo.findOpenByVersion('v-1');
      expect(open.map((s) => s.id).sort()).toEqual(['n', 'o', 'p', 'x']);
    });
  });

  describe('findByVersion', () => {
    it('returns ALL states of the version regardless of state value', async () => {
      await repo.save(aState({ id: 'p', customerId: 'c-1', state: 'PENDING_NOTIFICATION' }));
      await repo.save(aState({ id: 'a', customerId: 'c-2', state: 'ACCEPTED' }));
      await repo.save(aState({ id: 's', customerId: 'c-3', state: 'SUPERSEDED' }));
      await repo.save(aState({ id: 'other', customerId: 'c-1', versionId: 'v-2', state: 'ACCEPTED' }));

      const all = await repo.findByVersion('v-1');
      expect(all.map((s) => s.id).sort()).toEqual(['a', 'p', 's']);
    });
  });

  it('findByCustomer returns all states of the customer', async () => {
    await repo.save(aState({ id: 'cvs-1' }));
    await repo.save(aState({ id: 'cvs-2', versionId: 'v-2' }));
    await repo.save(aState({ id: 'cvs-3', customerId: 'c-999' }));
    expect((await repo.findByCustomer('c-123')).map((s) => s.id).sort()).toEqual(['cvs-1', 'cvs-2']);
  });

  it('returns are deep copies: mutation does not affect the store', async () => {
    await repo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));
    const found = await repo.findById('cvs-1');
    if (!found) {
      throw new Error('State is missing');
    }
    found.state = 'ACCEPTED';
    found.deadlineAt?.setUTCFullYear(1999);
    expect(await repo.findById('cvs-1')).toMatchObject({ state: 'NOTIFIED', deadlineAt: DEADLINE });
  });

  it('save updates an existing state (aggregate upsert)', async () => {
    await repo.save(aState({ id: 'cvs-1' }));
    await repo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));
    expect(await repo.findById('cvs-1')).toMatchObject({ state: 'NOTIFIED' });
    expect(await repo.findByCustomer('c-123')).toHaveLength(1);
  });
});
