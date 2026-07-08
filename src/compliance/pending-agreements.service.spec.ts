/**
 * PendingAgreementsService — popup content, in-memory fakes as data storage,
 * FakePdfUrlProvider as the fake for the PdfUrlProvider port.
 */
import { DomainError } from '../common/errors';
import { FixedClock } from '../domain/clock';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import { aCustomer, aDocument, aState, anActiveVersion, anAudience } from '../domain/testing/fixtures';
import { PendingAgreementsService } from './pending-agreements.service';
import { FakePdfUrlProvider } from './testing/fake-pdf-url-provider';

const T0 = new Date('2026-07-07T09:00:00Z');
const DEADLINE = new Date('2026-07-21T09:00:00Z');

describe('PendingAgreementsService', () => {
  let customers: InMemoryCustomerRepo;
  let audiencesRepo: InMemoryAudienceRepo;
  let documentsRepo: InMemoryAgreementDocumentRepo;
  let versionsRepo: InMemoryAgreementVersionRepo;
  let statesRepo: InMemoryCustomerVersionStateRepo;
  let service: PendingAgreementsService;

  beforeEach(async () => {
    customers = new InMemoryCustomerRepo();
    documentsRepo = new InMemoryAgreementDocumentRepo();
    audiencesRepo = new InMemoryAudienceRepo(documentsRepo, customers);
    versionsRepo = new InMemoryAgreementVersionRepo(documentsRepo);
    statesRepo = new InMemoryCustomerVersionStateRepo();
    service = new PendingAgreementsService(
      customers,
      audiencesRepo,
      documentsRepo,
      versionsRepo,
      statesRepo,
      new FixedClock(T0),
      new FakePdfUrlProvider(),
    );
    await audiencesRepo.save(anAudience({ id: 'aud-customer', key: 'customer' }));
    await audiencesRepo.save(anAudience({ id: 'aud-partner', key: 'partner', name: 'Partners' }));
  });

  const setupDpaCustomer = async (overrides: Parameters<typeof anActiveVersion>[0] = {}) => {
    const document = aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' });
    await documentsRepo.save(document);
    const version = anActiveVersion({
      id: 'v-dpa-c',
      documentId: 'doc-dpa-c',
      versionLabel: 'June 2026 edition',
      changeSummary: 'New sub-processor for e-mail delivery.',
      storageKey: 's3://bucket/v-dpa-c.pdf',
      ...overrides,
    });
    await versionsRepo.save(version);
    return { document, version };
  };

  it('CUSTOMER_NOT_FOUND for an unknown customer', async () => {
    await expect(service.getPendingAgreements('missing', 'customer')).rejects.toMatchObject({
      code: 'CUSTOMER_NOT_FOUND',
    });
  });

  it('UNKNOWN_AUDIENCE when the audience key does not exist in the repo', async () => {
    const customer = await customers.save(aCustomer());
    await expect(service.getPendingAgreements(customer.id, 'admin')).rejects.toThrow(DomainError);
    await expect(service.getPendingAgreements(customer.id, 'admin')).rejects.toMatchObject({
      code: 'UNKNOWN_AUDIENCE',
    });
  });

  it('empty array when nothing is pending (no state created)', async () => {
    const customer = await customers.save(aCustomer());
    await setupDpaCustomer();

    const result = await service.getPendingAgreements(customer.id, 'customer');

    expect(result).toEqual([]);
  });

  it.each(['ACCEPTED', 'OBJECTED', 'SUPERSEDED'] as const)(
    'state %s does NOT appear in the pending list',
    async (stateValue) => {
      const customer = await customers.save(aCustomer());
      const { version } = await setupDpaCustomer();
      await statesRepo.save(aState({ versionId: version.id, state: stateValue }));

      const result = await service.getPendingAgreements(customer.id, 'customer');

      expect(result).toEqual([]);
    },
  );

  it('PENDING_NOTIFICATION appears as an item, not blocking, without deadlineAt', async () => {
    const customer = await customers.save(aCustomer());
    const { version } = await setupDpaCustomer();
    await statesRepo.save(aState({ versionId: version.id, state: 'PENDING_NOTIFICATION' }));

    const result = await service.getPendingAgreements(customer.id, 'customer');

    expect(result).toEqual([
      expect.objectContaining({
        versionId: version.id,
        documentType: 'dpa',
        audience: 'customer',
        versionLabel: 'June 2026 edition',
        changeSummary: 'New sub-processor for e-mail delivery.',
        mode: 'ACTIVE',
        blocking: false,
        deadlineAt: undefined,
      }),
    ]);
    expect(result[0].pdfUrl).toBe('https://fake-storage.test/presigned/s3%3A%2F%2Fbucket%2Fv-dpa-c.pdf?expires=900');
  });

  it('carry-over: PENDING_NOTIFICATION with carryOverBlocking appears as blocking=true (blocking popup)', async () => {
    const customer = await customers.save(aCustomer());
    const { version } = await setupDpaCustomer();
    await statesRepo.save(aState({ versionId: version.id, state: 'PENDING_NOTIFICATION', carryOverBlocking: true }));

    const result = await service.getPendingAgreements(customer.id, 'customer');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ blocking: true });
  });

  it('NOTIFIED appears as an item, not blocking, with deadlineAt', async () => {
    const customer = await customers.save(aCustomer());
    const { version } = await setupDpaCustomer();
    await statesRepo.save(aState({ versionId: version.id, state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));

    const result = await service.getPendingAgreements(customer.id, 'customer');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ blocking: false, deadlineAt: DEADLINE });
  });

  it('EXPIRED_BLOCKING appears as an item with blocking=true (block screen)', async () => {
    const customer = await customers.save(aCustomer());
    const { version } = await setupDpaCustomer();
    await statesRepo.save(
      aState({ versionId: version.id, state: 'EXPIRED_BLOCKING', notifiedAt: T0, deadlineAt: DEADLINE }),
    );

    const result = await service.getPendingAgreements(customer.id, 'customer');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ blocking: true, deadlineAt: DEADLINE });
  });

  it('dual role: each tool only sees the documents of its audience', async () => {
    const customer = await customers.save(aCustomer({ roles: ['customer', 'partner'] }));
    const { version: dpaCustomer } = await setupDpaCustomer();
    const termsPartnerDoc = aDocument({ id: 'doc-terms-p', type: 'terms', audience: 'partner' });
    await documentsRepo.save(termsPartnerDoc);
    const termsPartner = anActiveVersion({ id: 'v-terms-p', documentId: 'doc-terms-p', versionLabel: 'March 2026 edition' });
    await versionsRepo.save(termsPartner);
    await statesRepo.save(aState({ versionId: dpaCustomer.id, state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));
    await statesRepo.save(
      aState({ id: 'cvs-2', versionId: termsPartner.id, state: 'EXPIRED_BLOCKING', notifiedAt: T0, deadlineAt: DEADLINE }),
    );

    const customerResult = await service.getPendingAgreements(customer.id, 'customer');
    const partnerResult = await service.getPendingAgreements(customer.id, 'partner');

    expect(customerResult).toHaveLength(1);
    expect(customerResult[0].audience).toBe('customer');
    expect(partnerResult).toHaveLength(1);
    expect(partnerResult[0].audience).toBe('partner');
    expect(partnerResult[0].blocking).toBe(true);
  });

  it('aggregation without audience: both roles contribute', async () => {
    const customer = await customers.save(aCustomer({ roles: ['customer', 'partner'] }));
    const { version: dpaCustomer } = await setupDpaCustomer();
    const termsPartnerDoc = aDocument({ id: 'doc-terms-p', type: 'terms', audience: 'partner' });
    await documentsRepo.save(termsPartnerDoc);
    const termsPartner = anActiveVersion({ id: 'v-terms-p', documentId: 'doc-terms-p', versionLabel: 'March 2026 edition' });
    await versionsRepo.save(termsPartner);
    await statesRepo.save(aState({ versionId: dpaCustomer.id, state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));
    await statesRepo.save(
      aState({ id: 'cvs-2', versionId: termsPartner.id, state: 'EXPIRED_BLOCKING', notifiedAt: T0, deadlineAt: DEADLINE }),
    );

    const result = await service.getPendingAgreements(customer.id);

    expect(result).toHaveLength(2);
    expect(result.map((i) => i.audience).sort()).toEqual(['customer', 'partner']);
  });

  it('customer without a role: empty array', async () => {
    const customer = await customers.save(aCustomer({ roles: [] }));
    await setupDpaCustomer();
    await statesRepo.save(aState({ versionId: 'v-dpa-c', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));

    const result = await service.getPendingAgreements(customer.id);

    expect(result).toEqual([]);
  });

  describe('scheduled effectiveness: upcoming published versions', () => {
    const FUTURE = new Date('2026-08-01T00:00:00Z');

    const setupUpcoming = async () => {
      const { version: current } = await setupDpaCustomer();
      const upcoming = anActiveVersion({
        id: 'v-dpa-next',
        documentId: 'doc-dpa-c',
        versionLabel: 'August 2026 edition',
        changeSummary: 'Scheduled revision.',
        validFrom: FUTURE,
        publishedAt: T0,
      });
      await versionsRepo.save(upcoming);
      return { current, upcoming };
    };

    it('a current item is marked upcoming=false and carries its validFrom', async () => {
      const customer = await customers.save(aCustomer());
      const { version } = await setupDpaCustomer();
      await statesRepo.save(aState({ versionId: version.id, state: 'PENDING_NOTIFICATION' }));

      const result = await service.getPendingAgreements(customer.id, 'customer');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ upcoming: false, validFrom: version.validFrom });
    });

    it('lists current AND upcoming version simultaneously — the upcoming one marked upcoming=true with its validFrom', async () => {
      const customer = await customers.save(aCustomer());
      const { current, upcoming } = await setupUpcoming();
      await statesRepo.save(aState({ id: 'cvs-cur', versionId: current.id, state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));
      await statesRepo.save(aState({ id: 'cvs-up', versionId: upcoming.id, state: 'PENDING_NOTIFICATION' }));

      const result = await service.getPendingAgreements(customer.id, 'customer');

      expect(result).toHaveLength(2);
      const currentItem = result.find((i) => i.versionId === current.id);
      const upcomingItem = result.find((i) => i.versionId === upcoming.id);
      expect(currentItem).toMatchObject({ upcoming: false });
      expect(upcomingItem).toMatchObject({
        upcoming: true,
        validFrom: FUTURE,
        versionLabel: 'August 2026 edition',
        blocking: false,
      });
    });

    it('an upcoming version already ACCEPTED in advance no longer appears (only the current one stays)', async () => {
      const customer = await customers.save(aCustomer());
      const { current, upcoming } = await setupUpcoming();
      await statesRepo.save(aState({ id: 'cvs-cur', versionId: current.id, state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE }));
      await statesRepo.save(aState({ id: 'cvs-up', versionId: upcoming.id, state: 'ACCEPTED' }));

      const result = await service.getPendingAgreements(customer.id, 'customer');

      expect(result).toHaveLength(1);
      expect(result[0].versionId).toBe(current.id);
    });
  });
});
