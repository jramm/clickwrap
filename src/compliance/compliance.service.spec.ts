/**
 * ComplianceService — end-to-end with real domain functions (computeCompliance/isBlocking) and
 * in-memory fakes as data storage (CONVENTIONS: pure domain, ports in src/persistence/inmemory).
 */
import { FixedClock } from '../domain/clock';
import { DomainError } from '../common/errors';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import {
  aCustomer,
  aDocument,
  aState,
  aVersion,
  anAcceptance,
  anActiveVersion,
  anAudience,
} from '../domain/testing/fixtures';
import { ComplianceService } from './compliance.service';

const T0 = new Date('2026-07-07T09:00:00Z');
const DEADLINE = new Date('2026-07-21T09:00:00Z');

describe('ComplianceService', () => {
  let customers: InMemoryCustomerRepo;
  let audiencesRepo: InMemoryAudienceRepo;
  let documentsRepo: InMemoryAgreementDocumentRepo;
  let versionsRepo: InMemoryAgreementVersionRepo;
  let statesRepo: InMemoryCustomerVersionStateRepo;
  let acceptancesRepo: InMemoryAcceptanceRepo;
  let clock: FixedClock;
  let service: ComplianceService;

  beforeEach(async () => {
    customers = new InMemoryCustomerRepo();
    documentsRepo = new InMemoryAgreementDocumentRepo();
    audiencesRepo = new InMemoryAudienceRepo(documentsRepo, customers);
    versionsRepo = new InMemoryAgreementVersionRepo(documentsRepo);
    statesRepo = new InMemoryCustomerVersionStateRepo();
    acceptancesRepo = new InMemoryAcceptanceRepo();
    clock = new FixedClock(T0);
    service = new ComplianceService(
      customers,
      audiencesRepo,
      documentsRepo,
      versionsRepo,
      statesRepo,
      acceptancesRepo,
      clock,
    );
    await audiencesRepo.save(anAudience({ id: 'aud-customer', key: 'customer' }));
    await audiencesRepo.save(anAudience({ id: 'aud-partner', key: 'partner', name: 'Partners' }));
  });

  const setupDpaCustomer = async (overrides: Parameters<typeof aVersion>[0] = {}) => {
    const document = aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' });
    await documentsRepo.save(document);
    const version = aVersion({ id: 'v-dpa-c', documentId: 'doc-dpa-c', versionLabel: 'June 2026 edition', ...overrides });
    await versionsRepo.save(version);
    return { document, version };
  };

  describe('semantics table (7 cases, end-to-end through the service)', () => {
    it('case 1: current version accepted → compliant', async () => {
      const customer = await customers.save(aCustomer());
      const { version } = await setupDpaCustomer();
      await statesRepo.save(aState({ versionId: version.id, state: 'ACCEPTED' }));
      await acceptancesRepo.append(anAcceptance({ id: 'a-1', customerId: customer.id, versionId: version.id, method: 'TACIT' }));

      const result = await service.getCompliance(customer.id, 'customer');

      expect(result.compliant).toBe(true);
      expect(result.details['DPA_CUSTOMER']).toMatchObject({
        requiredVersionId: version.id,
        requiredVersionLabel: 'June 2026 edition',
        acceptedVersionId: version.id,
        state: 'ACCEPTED',
        method: 'TACIT',
      });
    });

    it('case 2: PASSIVE published, objection period still running → compliant (pending)', async () => {
      const customer = await customers.save(aCustomer());
      const { version } = await setupDpaCustomer();
      await statesRepo.save(aState({ versionId: version.id, state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));

      const result = await service.getCompliance(customer.id, 'customer');

      expect(result.compliant).toBe(true);
      expect(result.details['DPA_CUSTOMER']).toMatchObject({
        state: 'NOTIFIED',
        pendingMode: 'PASSIVE',
        deadlineAt: DEADLINE,
      });
    });

    it('case 3: PASSIVE period expired without objection (sweeper not run yet) → compliant', async () => {
      const customer = await customers.save(aCustomer());
      const { version } = await setupDpaCustomer();
      await statesRepo.save(
        aState({ versionId: version.id, state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-01-01T00:00:00Z') }),
      );

      const result = await service.getCompliance(customer.id, 'customer');

      expect(result.compliant).toBe(true);
    });

    it('case 4: ACTIVE published, grace period still running → compliant', async () => {
      const customer = await customers.save(aCustomer());
      const document = aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' });
      await documentsRepo.save(document);
      const version = anActiveVersion({ id: 'v-dpa-c', documentId: 'doc-dpa-c' });
      await versionsRepo.save(version);
      await statesRepo.save(aState({ versionId: version.id, state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));

      const result = await service.getCompliance(customer.id, 'customer');

      expect(result.compliant).toBe(true);
      expect(result.details['DPA_CUSTOMER']).toMatchObject({ pendingMode: 'ACTIVE' });
    });

    it('case 5: ACTIVE grace period expired without consent (EXPIRED_BLOCKING) → NOT compliant', async () => {
      const customer = await customers.save(aCustomer());
      const document = aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' });
      await documentsRepo.save(document);
      const version = anActiveVersion({ id: 'v-dpa-c', documentId: 'doc-dpa-c' });
      await versionsRepo.save(version);
      await statesRepo.save(aState({ versionId: version.id, state: 'EXPIRED_BLOCKING', notifiedAt: T0, deadlineAt: DEADLINE }));

      const result = await service.getCompliance(customer.id, 'customer');

      expect(result.compliant).toBe(false);
      expect(result.details['DPA_CUSTOMER']).toMatchObject({ state: 'EXPIRED_BLOCKING' });
    });

    it('case 6: objection raised (OBJECTED) → compliant, no block', async () => {
      const customer = await customers.save(aCustomer());
      const { version } = await setupDpaCustomer();
      await statesRepo.save(aState({ versionId: version.id, state: 'OBJECTED', notifiedAt: T0, deadlineAt: DEADLINE }));

      const result = await service.getCompliance(customer.id, 'customer');

      expect(result.compliant).toBe(true);
      expect(result.details['DPA_CUSTOMER']).toMatchObject({ state: 'OBJECTED' });
    });

    it('case 7: no provable delivery (deadline never started) → compliant + escalation report (state visible)', async () => {
      const customer = await customers.save(aCustomer());
      const { version } = await setupDpaCustomer();
      await statesRepo.save(aState({ versionId: version.id, state: 'PENDING_NOTIFICATION' }));

      const result = await service.getCompliance(customer.id, 'customer');

      expect(result.compliant).toBe(true);
      expect(result.details['DPA_CUSTOMER']).toMatchObject({ state: 'PENDING_NOTIFICATION' });
    });
  });

  it('compliance baseline flips at validFrom: before the flip the OLD version is required, after it the NEW one', async () => {
    const customer = await customers.save(aCustomer());
    const { version: current } = await setupDpaCustomer({ validFrom: new Date('2026-06-01T00:00:00Z') });
    const upcoming = aVersion({
      id: 'v-dpa-next',
      documentId: 'doc-dpa-c',
      versionLabel: 'August 2026 edition',
      validFrom: new Date('2026-08-01T00:00:00Z'),
      publishedAt: T0,
    });
    await versionsRepo.save(upcoming);

    // Before the flip: the predecessor is the required version.
    const before = await service.getCompliance(customer.id, 'customer');
    expect(before.details['DPA_CUSTOMER'].requiredVersionId).toBe(current.id);

    // After the flip (server time passes validFrom): the scheduled version takes over.
    clock.set(new Date('2026-08-01T00:00:00Z'));
    const after = await service.getCompliance(customer.id, 'customer');
    expect(after.details['DPA_CUSTOMER'].requiredVersionId).toBe(upcoming.id);
  });

  it('CUSTOMER_NOT_FOUND for an unknown customer', async () => {
    await expect(service.getCompliance('does-not-exist', 'customer')).rejects.toMatchObject({
      code: 'CUSTOMER_NOT_FOUND',
    });
  });

  it('UNKNOWN_AUDIENCE when the audience key does not exist in the repo', async () => {
    const customer = await customers.save(aCustomer());
    await expect(service.getCompliance(customer.id, 'admin')).rejects.toThrow(DomainError);
    await expect(service.getCompliance(customer.id, 'admin')).rejects.toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
  });

  it('customer without a role: compliant=true, roles: [], no details — never blocked by master data', async () => {
    const customer = await customers.save(aCustomer({ roles: [] }));
    await setupDpaCustomer();
    await documentsRepo.save(aDocument({ id: 'doc-terms-p', type: 'terms', audience: 'partner' }));
    await versionsRepo.save(aVersion({ id: 'v-terms-p', documentId: 'doc-terms-p' }));

    const result = await service.getCompliance(customer.id);

    expect(result.compliant).toBe(true);
    expect(result.roles).toEqual([]);
    expect(result.details).toEqual({});
  });

  it('acceptedVersionId shows the older accepted revision when a newer version is outstanding', async () => {
    const customer = await customers.save(aCustomer());
    const document = aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' });
    await documentsRepo.save(document);
    const oldVersion = anActiveVersion({
      id: 'v-2025-01',
      documentId: 'doc-dpa-c',
      versionLabel: 'January 2025 edition',
      status: 'RETIRED',
      validFrom: new Date('2025-01-01T00:00:00Z'),
      publishedAt: new Date('2025-01-01T09:00:00Z'),
    });
    await versionsRepo.save(oldVersion);
    const newVersion = anActiveVersion({
      id: 'v-7f3a',
      documentId: 'doc-dpa-c',
      versionLabel: 'June 2026 edition',
      validFrom: new Date('2026-06-01T00:00:00Z'),
      publishedAt: new Date('2026-06-01T09:00:00Z'),
    });
    await versionsRepo.save(newVersion);
    await acceptancesRepo.append(
      anAcceptance({ id: 'a-old', customerId: customer.id, versionId: oldVersion.id, method: 'ACTIVE_CONSENT' }),
    );
    await statesRepo.save(
      aState({ versionId: newVersion.id, state: 'EXPIRED_BLOCKING', notifiedAt: T0, deadlineAt: new Date('2026-06-30T00:00:00Z') }),
    );

    const result = await service.getCompliance(customer.id, 'customer');

    expect(result.compliant).toBe(false);
    expect(result.details['DPA_CUSTOMER']).toMatchObject({
      requiredVersionId: 'v-7f3a',
      requiredVersionLabel: 'June 2026 edition',
      acceptedVersionId: 'v-2025-01',
      state: 'EXPIRED_BLOCKING',
      method: 'ACTIVE_CONSENT',
      deadlineAt: new Date('2026-06-30T00:00:00Z'),
      pendingMode: 'ACTIVE',
    });
  });

  describe('dual role: independent gates + aggregation', () => {
    const setupDualRole = async () => {
      const customer = await customers.save(aCustomer({ roles: ['customer', 'partner'] }));
      const { version: dpaCustomer } = await setupDpaCustomer();
      const termsPartnerDoc = aDocument({ id: 'doc-terms-p', type: 'terms', audience: 'partner' });
      await documentsRepo.save(termsPartnerDoc);
      const termsPartner = aVersion({ id: 'v-terms-p', documentId: 'doc-terms-p', versionLabel: 'March 2026 edition' });
      await versionsRepo.save(termsPartner);
      return { customer, dpaCustomer, termsPartner };
    };

    it('customer gate stays compliant although the partner gate is blocked (separate gates)', async () => {
      const { customer, dpaCustomer, termsPartner } = await setupDualRole();
      await statesRepo.save(aState({ versionId: dpaCustomer.id, state: 'ACCEPTED' }));
      await statesRepo.save(aState({ id: 'cvs-2', versionId: termsPartner.id, state: 'EXPIRED_BLOCKING' }));

      const result = await service.getCompliance(customer.id, 'customer');

      expect(result.compliant).toBe(true);
      expect(result.details['TERMS_PARTNER']).toBeUndefined();
      expect(Object.keys(result.details)).toEqual(['DPA_CUSTOMER']);
    });

    it('partner gate blocks independently of the compliant customer gate', async () => {
      const { customer, dpaCustomer, termsPartner } = await setupDualRole();
      await statesRepo.save(aState({ versionId: dpaCustomer.id, state: 'ACCEPTED' }));
      await statesRepo.save(aState({ id: 'cvs-2', versionId: termsPartner.id, state: 'EXPIRED_BLOCKING' }));

      const result = await service.getCompliance(customer.id, 'partner');

      expect(result.compliant).toBe(false);
      expect(result.details['TERMS_PARTNER']).toMatchObject({ state: 'EXPIRED_BLOCKING' });
    });

    it('aggregation without audience: AND across all roles, TYPE_AUDIENCE keys collision-free', async () => {
      const { customer, dpaCustomer, termsPartner } = await setupDualRole();
      await statesRepo.save(aState({ versionId: dpaCustomer.id, state: 'ACCEPTED' }));
      await statesRepo.save(aState({ id: 'cvs-2', versionId: termsPartner.id, state: 'EXPIRED_BLOCKING' }));

      const result = await service.getCompliance(customer.id);

      expect(result.audience).toBeUndefined();
      expect(result.compliant).toBe(false);
      expect(Object.keys(result.details).sort()).toEqual(['DPA_CUSTOMER', 'TERMS_PARTNER']);
      expect(result.details['DPA_CUSTOMER'].state).toBe('ACCEPTED');
      expect(result.details['TERMS_PARTNER'].state).toBe('EXPIRED_BLOCKING');
    });
  });
});
