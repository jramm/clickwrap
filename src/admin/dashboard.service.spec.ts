import { DomainError } from '../common/errors';
import { FixedClock } from '../domain/clock';
import { aCustomer, aState, aVersion, anAcceptance } from '../domain/testing/fixtures';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import { DashboardService } from './dashboard.service';

const T0 = new Date('2026-07-07T09:00:00Z');
const PAST = new Date('2026-07-01T00:00:00Z');
const FUTURE = new Date('2026-09-01T00:00:00Z');

describe('DashboardService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let acceptances: InMemoryAcceptanceRepo;
  let service: DashboardService;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    service = new DashboardService(documents, versions, states, acceptances, new FixedClock(T0));

    await documents.save({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
  });

  /**
   * One fixture set covering every bucket on the current DPA version `v-1`:
   * 4 ACCEPTED (one per channel/method combination), 2 pending (PENDING_NOTIFICATION + NOTIFIED),
   * 1 blocked (EXPIRED_BLOCKING), 1 objected, plus 1 SUPERSEDED that must be excluded entirely.
   */
  async function seedFullScenario() {
    await versions.save(aVersion({ id: 'v-1', documentId: 'doc-dpa-c', versionLabel: 'June 2026 edition', status: 'PUBLISHED', validFrom: PAST }));

    const accepted: { customerId: string; channel: 'PORTAL' | 'LINK' | 'ADMIN' | 'SYSTEM'; method: 'ACTIVE_CONSENT' | 'TACIT' | 'IMPORT' }[] = [
      { customerId: 'c-portal', channel: 'PORTAL', method: 'ACTIVE_CONSENT' },
      { customerId: 'c-link', channel: 'LINK', method: 'ACTIVE_CONSENT' },
      { customerId: 'c-admin', channel: 'ADMIN', method: 'IMPORT' },
      { customerId: 'c-system', channel: 'SYSTEM', method: 'TACIT' },
    ];
    for (const [i, a] of accepted.entries()) {
      await states.save(aState({ id: `cvs-acc-${i}`, customerId: a.customerId, versionId: 'v-1', state: 'ACCEPTED' }));
      await acceptances.append(
        anAcceptance({ id: `a-${i}`, customerId: a.customerId, versionId: 'v-1', channel: a.channel, method: a.method, isEffective: true }),
      );
    }

    await states.save(aState({ id: 'cvs-pending', customerId: 'c-pending', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));
    await states.save(aState({ id: 'cvs-notified', customerId: 'c-notified', versionId: 'v-1', state: 'NOTIFIED' }));
    await states.save(aState({ id: 'cvs-blocked', customerId: 'c-blocked', versionId: 'v-1', state: 'EXPIRED_BLOCKING' }));
    await states.save(aState({ id: 'cvs-objected', customerId: 'c-objected', versionId: 'v-1', state: 'OBJECTED' }));
    // SUPERSEDED — belongs to an old revision: excluded from totalCustomers and every bucket.
    await states.save(aState({ id: 'cvs-super', customerId: 'c-super', versionId: 'v-1', state: 'SUPERSEDED' }));
  }

  describe('versionStats — counter definitions', () => {
    beforeEach(seedFullScenario);

    it('counts each bucket, excludes SUPERSEDED, and breaks accepted down by channel/method', async () => {
      const result = await service.versionStats('v-1');
      expect(result).toMatchObject({
        versionId: 'v-1',
        documentName: 'DPA — Customers',
        documentType: 'dpa',
        audience: 'customer',
        versionLabel: 'June 2026 edition',
        status: 'PUBLISHED',
        upcoming: false,
      });
      expect(result.stats).toEqual({
        totalCustomers: 8, // 4 accepted + 2 pending + 1 blocked + 1 objected (SUPERSEDED excluded)
        accepted: 4,
        acceptedByChannel: { PORTAL: 1, LINK: 1, ADMIN: 1, SYSTEM: 1 },
        acceptedByMethod: { ACTIVE_CONSENT: 2, TACIT: 1, IMPORT: 1 },
        pending: 2,
        blocked: 1,
        objected: 1,
        acceptanceRate: 0.5,
      });
    });

    it('the channel and method breakdowns each sum to the accepted count', async () => {
      const { stats } = await service.versionStats('v-1');
      const channelSum = Object.values(stats.acceptedByChannel).reduce((a, b) => a + b, 0);
      const methodSum = Object.values(stats.acceptedByMethod).reduce((a, b) => a + b, 0);
      expect(channelSum).toBe(stats.accepted);
      expect(methodSum).toBe(stats.accepted);
    });

    it('an ineffective (superseded) acceptance is not counted in the breakdown', async () => {
      // c-portal corrected their acceptance: the old one is ineffective, a new effective one wins.
      await acceptances.supersede('a-0', 'a-0b');
      await acceptances.append(anAcceptance({ id: 'a-0b', customerId: 'c-portal', versionId: 'v-1', channel: 'ADMIN', method: 'IMPORT', isEffective: true }));
      const { stats } = await service.versionStats('v-1');
      expect(stats.accepted).toBe(4);
      expect(Object.values(stats.acceptedByChannel).reduce((a, b) => a + b, 0)).toBe(4);
    });
  });

  it('returns a zero-filled stats block with acceptanceRate 0 when the version has no states', async () => {
    await versions.save(aVersion({ id: 'v-empty', documentId: 'doc-dpa-c', status: 'PUBLISHED', validFrom: PAST }));
    const { stats } = await service.versionStats('v-empty');
    expect(stats).toEqual({
      totalCustomers: 0,
      accepted: 0,
      acceptedByChannel: { PORTAL: 0, LINK: 0, ADMIN: 0, SYSTEM: 0 },
      acceptedByMethod: { ACTIVE_CONSENT: 0, TACIT: 0, IMPORT: 0 },
      pending: 0,
      blocked: 0,
      objected: 0,
      acceptanceRate: 0,
    });
  });

  it('versionStats throws VERSION_NOT_FOUND for an unknown id', async () => {
    await expect(service.versionStats('missing')).rejects.toMatchObject({
      name: 'DomainError',
      code: 'VERSION_NOT_FOUND',
    });
    await expect(service.versionStats('missing')).rejects.toBeInstanceOf(DomainError);
  });

  it('flags an upcoming (scheduled, future validFrom) version', async () => {
    await versions.save(aVersion({ id: 'v-next', documentId: 'doc-dpa-c', versionLabel: 'Sep 2026 edition', status: 'PUBLISHED', validFrom: FUTURE }));
    expect((await service.versionStats('v-next')).upcoming).toBe(true);
  });

  describe('dashboard — aggregate over current + upcoming published versions', () => {
    it('includes the current AND the upcoming published version of every document', async () => {
      await documents.save({ id: 'doc-terms-c', type: 'terms', audience: 'customer', name: 'Terms — Customers' });
      await versions.save(aVersion({ id: 'v-current', documentId: 'doc-dpa-c', versionLabel: 'June 2026 edition', status: 'PUBLISHED', validFrom: PAST }));
      await versions.save(aVersion({ id: 'v-upcoming', documentId: 'doc-dpa-c', versionLabel: 'Sep 2026 edition', status: 'PUBLISHED', validFrom: FUTURE }));
      await versions.save(aVersion({ id: 'v-terms', documentId: 'doc-terms-c', versionLabel: 'Apr 2026 edition', status: 'PUBLISHED', validFrom: PAST }));
      // A DRAFT is never a "relevant" version.
      await versions.save(aVersion({ id: 'v-draft', documentId: 'doc-terms-c', status: 'DRAFT', validFrom: FUTURE }));

      await states.save(aState({ id: 'cvs-1', customerId: 'c-1', versionId: 'v-current', state: 'ACCEPTED' }));
      await acceptances.append(anAcceptance({ id: 'a-1', customerId: 'c-1', versionId: 'v-current', channel: 'PORTAL', method: 'ACTIVE_CONSENT' }));

      const { items } = await service.dashboard();
      const byId = new Map(items.map((i) => [i.versionId, i]));
      expect([...byId.keys()].sort()).toEqual(['v-current', 'v-terms', 'v-upcoming']);
      expect(byId.get('v-current')?.upcoming).toBe(false);
      expect(byId.get('v-upcoming')?.upcoming).toBe(true);
      expect(byId.get('v-current')?.stats.accepted).toBe(1);
      expect(byId.get('v-terms')?.stats.totalCustomers).toBe(0);
    });

    it('emits a per-version entry for EVERY upcoming version, not just the next (two future versions)', async () => {
      await versions.save(aVersion({ id: 'v-current', documentId: 'doc-dpa-c', versionLabel: 'June 2026 edition', status: 'PUBLISHED', validFrom: PAST }));
      await versions.save(aVersion({ id: 'v-near', documentId: 'doc-dpa-c', versionLabel: 'Aug 2026 edition', status: 'PUBLISHED', validFrom: new Date('2026-08-01T00:00:00Z') }));
      await versions.save(aVersion({ id: 'v-far', documentId: 'doc-dpa-c', versionLabel: 'Oct 2026 edition', status: 'PUBLISHED', validFrom: new Date('2026-10-01T00:00:00Z') }));

      // Each future version carries its own per-version stats population.
      await states.save(aState({ id: 'cvs-near', customerId: 'c-1', versionId: 'v-near', state: 'ACCEPTED' }));
      await acceptances.append(anAcceptance({ id: 'a-near', customerId: 'c-1', versionId: 'v-near', channel: 'PORTAL', method: 'ACTIVE_CONSENT' }));
      await states.save(aState({ id: 'cvs-far', customerId: 'c-2', versionId: 'v-far', state: 'PENDING_NOTIFICATION' }));

      const { items } = await service.dashboard();
      const byId = new Map(items.map((i) => [i.versionId, i]));
      expect([...byId.keys()].sort()).toEqual(['v-current', 'v-far', 'v-near']);
      expect(byId.get('v-near')?.upcoming).toBe(true);
      expect(byId.get('v-far')?.upcoming).toBe(true);
      // Own per-version stats, not shared.
      expect(byId.get('v-near')?.stats.accepted).toBe(1);
      expect(byId.get('v-far')?.stats.accepted).toBe(0);
      expect(byId.get('v-far')?.stats.pending).toBe(1);
      // Ordered current-first, then upcoming by validFrom asc.
      expect(items.map((i) => i.versionId)).toEqual(['v-current', 'v-near', 'v-far']);
    });

    it('returns an empty list when there are no published versions', async () => {
      await versions.save(aVersion({ id: 'v-draft', documentId: 'doc-dpa-c', status: 'DRAFT', validFrom: PAST }));
      expect((await service.dashboard()).items).toEqual([]);
    });
  });
});
