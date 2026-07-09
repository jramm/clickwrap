/**
 * Invariant tests against real Postgres — counterpart of
 * src/persistence/inmemory/simple-repos.spec.ts (InMemoryObjectionRepo block). Runs only with
 * DATABASE_URL (see agreement-document.repo.prisma.spec.ts for details/invocation).
 */
import { aCustomer, aDocument, anObjection, aVersion } from '../../domain/testing/fixtures';
import { PrismaAgreementDocumentRepo } from './agreement-document.repo';
import { PrismaAgreementVersionRepo } from './agreement-version.repo';
import { PrismaCustomerRepo } from './customer.repo';
import { PrismaObjectionRepo } from './objection.repo';
import { PrismaService } from './prisma.service';
import { resetDatabase } from './testing/reset-database';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('PrismaObjectionRepo (against real Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaObjectionRepo;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    repo = new PrismaObjectionRepo(prisma);
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
  });

  it('append + findByCustomerAndVersion/findByCustomer (append-only, multiple entries possible)', async () => {
    await repo.append(anObjection({ id: 'o-1' }));
    await repo.append(anObjection({ id: 'o-2' }));
    await repo.append(anObjection({ id: 'o-3', versionId: 'v-2' }));

    expect((await repo.findByCustomerAndVersion('c-123', 'v-1')).map((o) => o.id)).toEqual(['o-1', 'o-2']);
    expect(await repo.findByCustomer('c-123')).toHaveLength(3);
  });

  it('rejects a duplicate id (append-only, PK violation → INVALID_STATE)', async () => {
    await repo.append(anObjection({ id: 'o-1' }));
    await expect(repo.append(anObjection({ id: 'o-1' }))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INVALID_STATE',
    });
  });

  it('resolve sets resolution/resolvedBy/resolvedAt (no dead-end state); UPDATE is allowed despite the append-only REVOKE (column-scoped GRANT)', async () => {
    await repo.append(anObjection({ id: 'o-1' }));
    const resolved = await repo.resolve('o-1', 'RESOLVED_ACCEPTED', 'admin-1', new Date('2026-07-15T00:00:00Z'));
    expect(resolved).toMatchObject({
      resolution: 'RESOLVED_ACCEPTED',
      resolvedBy: 'admin-1',
      resolvedAt: new Date('2026-07-15T00:00:00Z'),
    });
  });

  it('resolve on an unknown id → DomainError', async () => {
    await expect(repo.resolve('missing', 'WITHDRAWN', 'admin-1', new Date())).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INVALID_STATE',
    });
  });

  it('findAll returns every objection across customers/versions in append order (createdAt asc)', async () => {
    await new PrismaCustomerRepo(prisma).save(aCustomer({ id: 'c-9' }));
    await repo.append(anObjection({ id: 'o-1' }));
    await repo.append(anObjection({ id: 'o-2', versionId: 'v-2' }));
    await repo.append(anObjection({ id: 'o-3', customerId: 'c-9' }));
    expect((await repo.findAll()).map((o) => o.id)).toEqual(['o-1', 'o-2', 'o-3']);
  });
});
