import { DomainError } from '../common/errors';
import { InMemoryAdminAuditRepo } from '../agreements/audit';
import { InMemoryPdfStorage } from '../agreements/pdf-storage.inmemory';
import { FixedClock } from '../domain/clock';
import { testActor } from '../domain/testing/fixtures';
import { aCustomer, aState, aVersion, anActiveVersion } from '../domain/testing/fixtures';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import type { AcceptanceConfirmationService } from '../plugins/email/core/acceptance-confirmation.service';
import { ManualAcceptanceService, type ManualAcceptanceInput } from './manual-acceptance.service';

const T0 = new Date('2026-07-07T09:00:00Z');
const adminActor = testActor({ userId: 'admin-1', portalRole: undefined });

const expectCode = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code });
};

const input = (overrides: Partial<ManualAcceptanceInput> = {}): ManualAcceptanceInput => ({
  versionId: 'v-1',
  method: 'ACTIVE_CONSENT',
  reason: 'Consent received by letter',
  evidenceDocument: { buffer: Buffer.from('letter-scan'), fileName: 'letter.pdf' },
  ...overrides,
});

describe('ManualAcceptanceService', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let customers: InMemoryCustomerRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let acceptances: InMemoryAcceptanceRepo;
  let pdf: InMemoryPdfStorage;
  let audit: InMemoryAdminAuditRepo;
  let service: ManualAcceptanceService;

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    versions = new InMemoryAgreementVersionRepo(documents);
    customers = new InMemoryCustomerRepo();
    states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    pdf = new InMemoryPdfStorage();
    audit = new InMemoryAdminAuditRepo();
    service = new ManualAcceptanceService(customers, versions, documents, states, acceptances, pdf, audit, new FixedClock(T0));

    await documents.save({ id: 'doc-dpa-customer', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
    await versions.save(anActiveVersion({ id: 'v-1', documentId: 'doc-dpa-customer', status: 'PUBLISHED' }));
    await customers.save(aCustomer({ id: 'c-123', roles: ['customer'] }));
  });

  it('records an acceptance (channel=ADMIN, actor=admin) and creates a state if needed (letter case)', async () => {
    const result = await service.record('c-123', input(), adminActor);
    expect(result.state).toBe('ACCEPTED');
    const acceptance = await acceptances.findById(result.acceptanceId);
    expect(acceptance).toMatchObject({ channel: 'ADMIN', method: 'ACTIVE_CONSENT', actor: { userId: 'admin-1' }, isEffective: true });
    expect(acceptance?.consentText).toBe('I have read the new revision and agree.');
    expect(acceptance?.consentTextHash).toMatch(/^sha256:/);
    expect((await states.findByCustomerAndVersion('c-123', 'v-1'))?.state).toBe('ACCEPTED');
  });

  it('also accepts from an existing PENDING_NOTIFICATION state', async () => {
    await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));
    const result = await service.record('c-123', input(), adminActor);
    expect(result.state).toBe('ACCEPTED');
    expect((await states.findById('cvs-1'))?.state).toBe('ACCEPTED');
  });

  it('method=IMPORT: no consentText evidence, but contentHash is set', async () => {
    const result = await service.record('c-123', input({ method: 'IMPORT' }), adminActor);
    const acceptance = await acceptances.findById(result.acceptanceId);
    expect(acceptance).toMatchObject({ method: 'IMPORT', channel: 'ADMIN', contentHash: 'sha256:9c1e' });
    expect(acceptance?.consentText).toBeUndefined();
  });

  it('invokes the acceptance-confirmation sender with the recorded acceptance (ADMIN manual)', async () => {
    const confirmation = { sendForAcceptance: jest.fn().mockResolvedValue(undefined) };
    const serviceWithConfirmation = new ManualAcceptanceService(
      customers,
      versions,
      documents,
      states,
      acceptances,
      pdf,
      audit,
      new FixedClock(T0),
      confirmation as unknown as AcceptanceConfirmationService,
    );

    await serviceWithConfirmation.record('c-123', input(), adminActor);

    expect(confirmation.sendForAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'v-1' }),
      expect.objectContaining({ method: 'ACTIVE_CONSENT', channel: 'ADMIN' }),
    );
  });

  it('writes a MANUAL_ACCEPTANCE audit log incl. reason + evidenceStorageKey', async () => {
    const result = await service.record('c-123', input(), adminActor);
    const logs = await audit.findByTarget('Acceptance', result.acceptanceId);
    expect(logs[0]).toMatchObject({ action: 'MANUAL_ACCEPTANCE', actor: 'admin-1', reason: 'Consent received by letter' });
    expect(logs[0].metadata?.evidenceStorageKey).toEqual(expect.stringContaining('letter.pdf'));
  });

  it('missing reason → INVALID_STATE', async () => {
    await expectCode(service.record('c-123', input({ reason: '  ' }), adminActor), 'INVALID_STATE');
  });

  it('role does not match the document audience → ROLE_MISMATCH', async () => {
    await customers.save(aCustomer({ id: 'c-partner', roles: ['partner'] }));
    await expectCode(service.record('c-partner', input(), adminActor), 'ROLE_MISMATCH');
  });

  it('unknown customer → CUSTOMER_NOT_FOUND', async () => {
    await expectCode(service.record('c-unknown', input(), adminActor), 'CUSTOMER_NOT_FOUND');
  });

  it('unknown version → VERSION_NOT_FOUND', async () => {
    await expectCode(service.record('c-123', input({ versionId: 'v-unknown' }), adminActor), 'VERSION_NOT_FOUND');
  });

  it('recording the same version twice → ALREADY_ACCEPTED', async () => {
    await service.record('c-123', input(), adminActor);
    await expectCode(service.record('c-123', input(), adminActor), 'ALREADY_ACCEPTED');
  });

  it('TACIT is excluded as a manual method (the type prevents it; at runtime → INVALID_STATE)', async () => {
    await expectCode(
      service.record('c-123', input({ method: 'TACIT' as unknown as 'IMPORT' }), adminActor),
      'INVALID_STATE',
    );
  });

  it('evidenceDocument with empty content → INVALID_STATE, no acceptance', async () => {
    await expectCode(
      service.record('c-123', input({ evidenceDocument: { buffer: Buffer.alloc(0), fileName: 'empty.pdf' } }), adminActor),
      'INVALID_STATE',
    );
    expect(await acceptances.findByCustomer('c-123')).toHaveLength(0);
  });

  it('race: state is SUPERSEDED between read and write → INVALID_STATE, no acceptance', async () => {
    class StaleReadStateRepo extends InMemoryCustomerVersionStateRepo {
      staleSnapshot?: ReturnType<typeof aState>;

      override async findByCustomerAndVersion(customerId: string, versionId: string) {
        return this.staleSnapshot ?? super.findByCustomerAndVersion(customerId, versionId);
      }
    }
    const staleStates = new StaleReadStateRepo();
    const staleSnapshot = aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'PENDING_NOTIFICATION' });
    await staleStates.save({ ...staleSnapshot, state: 'SUPERSEDED' });
    staleStates.staleSnapshot = staleSnapshot;
    const raceService = new ManualAcceptanceService(
      customers,
      versions,
      documents,
      staleStates,
      acceptances,
      pdf,
      audit,
      new FixedClock(T0),
    );

    await expectCode(raceService.record('c-123', input(), adminActor), 'INVALID_STATE');
    expect((await staleStates.findById('cvs-1'))?.state).toBe('SUPERSEDED');
    expect(await acceptances.findByCustomer('c-123')).toHaveLength(0);
  });
});
