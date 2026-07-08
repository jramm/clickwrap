/**
 * Invariant tests against real Postgres — counterpart of
 * src/persistence/inmemory/customer-version-state.repo.spec.ts. Runs only with DATABASE_URL
 * (see agreement-document.repo.prisma.spec.ts for details/invocation).
 *
 * Unlike the in-memory fake, the real schema enforces FK constraints on customerId/versionId
 * — every test therefore seeds document/version/customer rows first.
 */
import { aCustomer, aDocument, aState, aVersion } from '../../domain/testing/fixtures';
import { PrismaAgreementDocumentRepo } from './agreement-document.repo';
import { PrismaAgreementVersionRepo } from './agreement-version.repo';
import { PrismaCustomerRepo } from './customer.repo';
import { PrismaCustomerVersionStateRepo } from './customer-version-state.repo';
import { PrismaService } from './prisma.service';
import { resetDatabase } from './testing/reset-database';

const T0 = new Date('2026-07-07T09:00:00Z');
const DEADLINE = new Date('2026-07-21T09:00:00Z');
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('PrismaCustomerVersionStateRepo (against real Postgres)', () => {
  let prisma: PrismaService;
  let documents: PrismaAgreementDocumentRepo;
  let versions: PrismaAgreementVersionRepo;
  let customers: PrismaCustomerRepo;
  let repo: PrismaCustomerVersionStateRepo;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    documents = new PrismaAgreementDocumentRepo(prisma);
    versions = new PrismaAgreementVersionRepo(prisma);
    customers = new PrismaCustomerRepo(prisma);
    repo = new PrismaCustomerVersionStateRepo(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await documents.save(aDocument({ id: 'doc-dpa-customer' }));
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-customer' }));
    await versions.save(aVersion({ id: 'v-2', documentId: 'doc-dpa-customer' }));
    for (const id of ['c-123', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6']) {
      await customers.save(aCustomer({ id, externalRef: `ext-${id}` }));
    }
  });

  it('save + findById / findByCustomerAndVersion (upsert by id)', async () => {
    await repo.save(aState({ id: 'cvs-1' }));
    expect(await repo.findById('cvs-1')).toMatchObject({ id: 'cvs-1' });
    expect(await repo.findByCustomerAndVersion('c-123', 'v-1')).toMatchObject({ id: 'cvs-1' });
    expect(await repo.findByCustomerAndVersion('c-123', 'v-2')).toBeUndefined();
  });

  describe('setNotifiedAtomically — SET … WHERE "notifiedAt" IS NULL', () => {
    it('sets state/notifiedAt/deadlineAt when notifiedAt is empty', async () => {
      await repo.save(aState({ id: 'cvs-1' }));
      const result = await repo.setNotifiedAtomically('cvs-1', { state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE });
      expect(result).toMatchObject({ state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE });
    });

    it('a second call is a no-op: the first delivery wins (no backdating/shifting the deadline)', async () => {
      await repo.save(aState({ id: 'cvs-1' }));
      await repo.setNotifiedAtomically('cvs-1', { state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE });
      const second = await repo.setNotifiedAtomically('cvs-1', {
        state: 'NOTIFIED',
        notifiedAt: new Date('2026-07-09T00:00:00Z'),
        deadlineAt: new Date('2026-07-23T00:00:00Z'),
      });
      expect(second).toMatchObject({ notifiedAt: T0, deadlineAt: DEADLINE });
    });

    it('real concurrency: of two simultaneous calls exactly one wins (no lost update)', async () => {
      await repo.save(aState({ id: 'cvs-1' }));
      const first = new Date('2026-07-07T09:00:00Z');
      const second = new Date('2026-07-08T09:00:00Z');
      const [a, b] = await Promise.all([
        repo.setNotifiedAtomically('cvs-1', { state: 'NOTIFIED', notifiedAt: first, deadlineAt: DEADLINE }),
        repo.setNotifiedAtomically('cvs-1', { state: 'NOTIFIED', notifiedAt: second, deadlineAt: DEADLINE }),
      ]);
      // Both responses must show the same (the first persisted) notifiedAt.
      expect(a.notifiedAt?.getTime()).toBe(b.notifiedAt?.getTime());
      expect([first.getTime(), second.getTime()]).toContain(a.notifiedAt?.getTime());
    });

    it('unknown id → DomainError', async () => {
      await expect(
        repo.setNotifiedAtomically('missing', { state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }),
      ).rejects.toMatchObject({ name: 'DomainError', code: 'INVALID_STATE' });
    });

    it('does NOT revive a SUPERSEDED state (state condition in addition to notifiedAt, K-1d)', async () => {
      await repo.save(aState({ id: 'cvs-1', state: 'SUPERSEDED' }));
      const result = await repo.setNotifiedAtomically('cvs-1', { state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE });
      expect(result).toMatchObject({ state: 'SUPERSEDED' });
      expect(result.notifiedAt).toBeUndefined();
    });
  });

  describe('transition — UPDATE … WHERE id AND state = expected (K-1a)', () => {
    it('performs the transition when the stored state matches the expectation', async () => {
      await repo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));
      const result = await repo.transition('cvs-1', 'NOTIFIED', { state: 'ACCEPTED' });
      expect(result).toMatchObject({ state: 'ACCEPTED' });
    });

    it('returns null and writes nothing when the state differs', async () => {
      await repo.save(aState({ id: 'cvs-1', state: 'ACCEPTED', notifiedAt: T0 }));
      expect(await repo.transition('cvs-1', 'NOTIFIED', { state: 'EXPIRED_BLOCKING' })).toBeNull();
      expect(await repo.findById('cvs-1')).toMatchObject({ state: 'ACCEPTED' });
    });

    it('real concurrency: of two competing transitions out of NOTIFIED exactly one wins', async () => {
      await repo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));
      const [a, b] = await Promise.all([
        repo.transition('cvs-1', 'NOTIFIED', { state: 'ACCEPTED' }),
        repo.transition('cvs-1', 'NOTIFIED', { state: 'EXPIRED_BLOCKING' }),
      ]);
      expect([a, b].filter((r) => r !== null)).toHaveLength(1);
    });

    it('unknown id → null', async () => {
      expect(await repo.transition('missing', 'NOTIFIED', { state: 'ACCEPTED' })).toBeNull();
    });
  });

  describe('findDueForSweep — hot path deadline sweeper (@@index([state, deadlineAt]))', () => {
    it('returns only NOTIFIED with deadlineAt <= now (boundary inclusive)', async () => {
      await repo.save(aState({ id: 'due', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));
      await repo.save(aState({ id: 'exact', customerId: 'c-2', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-22T00:00:00Z') }));
      await repo.save(aState({ id: 'future', customerId: 'c-3', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-08-01T00:00:00Z') }));
      await repo.save(aState({ id: 'superseded', customerId: 'c-4', state: 'SUPERSEDED', notifiedAt: T0, deadlineAt: DEADLINE }));
      await repo.save(aState({ id: 'pending', customerId: 'c-5', state: 'PENDING_NOTIFICATION' }));

      const due = await repo.findDueForSweep(new Date('2026-07-22T00:00:00Z'));
      expect(due.map((s) => s.id).sort()).toEqual(['due', 'exact']);
    });
  });

  describe('findOpenByVersion', () => {
    it('returns all non-terminal states of the version (without ACCEPTED/SUPERSEDED)', async () => {
      await repo.save(aState({ id: 'p', customerId: 'c-123', state: 'PENDING_NOTIFICATION' }));
      await repo.save(aState({ id: 'n', customerId: 'c-2', state: 'NOTIFIED' }));
      await repo.save(aState({ id: 'a', customerId: 'c-3', state: 'ACCEPTED' }));
      await repo.save(aState({ id: 's', customerId: 'c-4', state: 'SUPERSEDED' }));

      const open = await repo.findOpenByVersion('v-1');
      expect(open.map((s) => s.id).sort()).toEqual(['n', 'p']);
    });
  });

  describe('findByVersion', () => {
    it('returns ALL states of the version regardless of state value', async () => {
      await repo.save(aState({ id: 'p', customerId: 'c-123', state: 'PENDING_NOTIFICATION' }));
      await repo.save(aState({ id: 'a', customerId: 'c-2', state: 'ACCEPTED' }));
      await repo.save(aState({ id: 's', customerId: 'c-3', state: 'SUPERSEDED' }));

      const all = await repo.findByVersion('v-1');
      expect(all.map((row) => row.id).sort()).toEqual(['a', 'p', 's']);
    });
  });
});
