/**
 * Invariant tests against real Postgres — counterpart of
 * src/persistence/inmemory/audience-and-document-type.repo.spec.ts (InMemoryAudienceRepo
 * block). Runs only with DATABASE_URL (see agreement-document.repo.prisma.spec.ts for
 * details/invocation).
 *
 * Main purpose: verify that the `key @unique` constraint on the Audience table is enforced
 * by the real DB (P2002 → INVALID_STATE) and that the application-level reference checks of
 * `deleteIfUnused` (AgreementDocument.audience, Customer.roles) hold against real rows.
 */
import { aCustomer, aDocument, anAudience } from '../../domain/testing/fixtures.js';
import { PrismaAgreementDocumentRepo } from './agreement-document.repo.js';
import { PrismaAudienceRepo } from './audience.repo.js';
import { PrismaCustomerRepo } from './customer.repo.js';
import { PrismaService } from './prisma.service.js';
import { resetDatabase } from './testing/reset-database.js';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('PrismaAudienceRepo (against real Postgres)', () => {
  let prisma: PrismaService;
  let documents: PrismaAgreementDocumentRepo;
  let customers: PrismaCustomerRepo;
  let repo: PrismaAudienceRepo;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    documents = new PrismaAgreementDocumentRepo(prisma);
    customers = new PrismaCustomerRepo(prisma);
    repo = new PrismaAudienceRepo(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('save + findByKey roundtrip', async () => {
    await repo.save(anAudience({ id: 'aud-1', key: 'customer', name: 'Customers' }));
    expect(await repo.findByKey('customer')).toEqual({ id: 'aud-1', key: 'customer', name: 'Customers' });
    expect(await repo.findByKey('unknown')).toBeUndefined();
  });

  it('save is an upsert by id (rename keeps the same entity)', async () => {
    await repo.save(anAudience({ id: 'aud-1', key: 'customer', name: 'Customers' }));
    await repo.save(anAudience({ id: 'aud-1', key: 'customer', name: 'End customers' }));

    expect(await repo.findAll()).toHaveLength(1);
    expect((await repo.findByKey('customer'))?.name).toBe('End customers');
  });

  it('duplicate key on a different id → DB unique constraint (P2002) → INVALID_STATE', async () => {
    await repo.save(anAudience({ id: 'aud-1', key: 'customer' }));
    await expect(repo.save(anAudience({ id: 'aud-2', key: 'customer' }))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INVALID_STATE',
    });
  });

  it('invalid slug key → INVALID_STATE (validated before hitting the DB)', async () => {
    await expect(repo.save(anAudience({ key: 'NOT A SLUG' }))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INVALID_STATE',
    });
  });

  it('findAll lists all audiences', async () => {
    await repo.save(anAudience({ id: 'aud-1', key: 'customer' }));
    await repo.save(anAudience({ id: 'aud-2', key: 'partner', name: 'Partners' }));

    expect((await repo.findAll()).map((a) => a.key).sort()).toEqual(['customer', 'partner']);
  });

  describe('deleteIfUnused', () => {
    it('deletes an unreferenced audience and reports true', async () => {
      await repo.save(anAudience({ key: 'customer' }));
      expect(await repo.deleteIfUnused('customer')).toBe(true);
      expect(await repo.findByKey('customer')).toBeUndefined();
    });

    it('returns false for an unknown key', async () => {
      expect(await repo.deleteIfUnused('ghost')).toBe(false);
    });

    it('keeps an audience referenced by a document (AgreementDocument.audience)', async () => {
      await repo.save(anAudience({ key: 'customer' }));
      await documents.save(aDocument({ audience: 'customer' }));

      expect(await repo.deleteIfUnused('customer')).toBe(false);
      expect(await repo.findByKey('customer')).toBeDefined();
    });

    it('keeps an audience referenced by a customer role (Customer.roles)', async () => {
      await repo.save(anAudience({ key: 'customer' }));
      await customers.save(aCustomer({ roles: ['customer'] }));

      expect(await repo.deleteIfUnused('customer')).toBe(false);
      expect(await repo.findByKey('customer')).toBeDefined();
    });
  });
});
