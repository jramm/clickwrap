/**
 * Invariant tests against real Postgres — counterpart of
 * src/persistence/inmemory/simple-repos.spec.ts (InMemoryNotificationEventRepo block). Runs only
 * with DATABASE_URL (see agreement-document.repo.prisma.spec.ts for details/invocation).
 */
import { aCustomer, aDocument, aNotification, aState, aVersion } from '../../domain/testing/fixtures.js';
import { PrismaAgreementDocumentRepo } from './agreement-document.repo.js';
import { PrismaAgreementVersionRepo } from './agreement-version.repo.js';
import { PrismaCustomerRepo } from './customer.repo.js';
import { PrismaCustomerVersionStateRepo } from './customer-version-state.repo.js';
import { PrismaNotificationEventRepo } from './notification-event.repo.js';
import { PrismaService } from './prisma.service.js';
import { resetDatabase } from './testing/reset-database.js';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('PrismaNotificationEventRepo (against real Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaNotificationEventRepo;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    repo = new PrismaNotificationEventRepo(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await new PrismaAgreementDocumentRepo(prisma).save(aDocument({ id: 'doc-dpa-customer' }));
    await new PrismaAgreementVersionRepo(prisma).save(aVersion({ id: 'v-1', documentId: 'doc-dpa-customer' }));
    await new PrismaAgreementVersionRepo(prisma).save(aVersion({ id: 'v-2', documentId: 'doc-dpa-customer' }));
    await new PrismaCustomerRepo(prisma).save(aCustomer({ id: 'c-123' }));
    const states = new PrismaCustomerVersionStateRepo(prisma);
    await states.save(aState({ id: 'cvs-1', versionId: 'v-1' }));
    await states.save(aState({ id: 'cvs-2', versionId: 'v-2' }));
  });

  it('append + findByState (append-only delivery evidence)', async () => {
    await repo.append(aNotification({ id: 'n-1' }));
    await repo.append(aNotification({ id: 'n-2', channel: 'PORTAL', providerRef: undefined }));
    await repo.append(aNotification({ id: 'n-3', customerVersionStateId: 'cvs-2' }));

    expect((await repo.findByState('cvs-1')).map((n) => n.id)).toEqual(['n-1', 'n-2']);
  });

  it('findByProviderRef correlates Postmark MessageIDs (hot path webhook, @@index([providerRef]))', async () => {
    await repo.append(aNotification({ id: 'n-1', providerRef: 'pm-abc' }));
    expect((await repo.findByProviderRef('pm-abc'))?.id).toBe('n-1');
    expect(await repo.findByProviderRef('pm-foreign')).toBeUndefined();
  });

  it('rejects a duplicate id (append-only, PK violation → INVALID_STATE)', async () => {
    await repo.append(aNotification({ id: 'n-1' }));
    await expect(repo.append(aNotification({ id: 'n-1' }))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INVALID_STATE',
    });
  });

  it('findAll returns every event across states in append order (createdAt asc)', async () => {
    await repo.append(aNotification({ id: 'n-1' }));
    await repo.append(aNotification({ id: 'n-2', channel: 'LINK', customerVersionStateId: 'cvs-2', providerRef: undefined }));
    await repo.append(aNotification({ id: 'n-3', customerVersionStateId: 'cvs-1' }));
    expect((await repo.findAll()).map((n) => n.id)).toEqual(['n-1', 'n-2', 'n-3']);
  });
});
