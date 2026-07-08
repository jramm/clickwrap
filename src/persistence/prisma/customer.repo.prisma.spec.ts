/**
 * Invariant tests against real Postgres — counterpart of
 * src/persistence/inmemory/simple-repos.spec.ts (InMemoryCustomerRepo block). Runs only with
 * DATABASE_URL (see agreement-document.repo.prisma.spec.ts for details/invocation).
 */
import { aCustomer } from '../../domain/testing/fixtures';
import { PrismaCustomerRepo } from './customer.repo';
import { PrismaService } from './prisma.service';
import { resetDatabase } from './testing/reset-database';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('PrismaCustomerRepo (against real Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaCustomerRepo;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    repo = new PrismaCustomerRepo(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('findByRole returns only customers with a matching role (Postgres array filter `has`, rollout invariant)', async () => {
    await repo.save(aCustomer({ id: 'c-c', externalRef: 'ext-c', roles: ['customer'] }));
    await repo.save(aCustomer({ id: 'c-p', externalRef: 'ext-p', roles: ['partner'] }));
    await repo.save(aCustomer({ id: 'c-both', externalRef: 'ext-both', roles: ['customer', 'partner'] }));
    await repo.save(aCustomer({ id: 'c-none', externalRef: 'ext-none', roles: [] }));

    expect((await repo.findByRole('customer')).map((c) => c.id).sort()).toEqual(['c-both', 'c-c']);
    expect((await repo.findByRole('partner')).map((c) => c.id).sort()).toEqual(['c-both', 'c-p']);
  });

  it('save updates existing customers (role sync from the CRM, upsert by id)', async () => {
    await repo.save(aCustomer({ id: 'c-1', externalRef: 'ext-1', roles: ['customer'] }));
    await repo.save(aCustomer({ id: 'c-1', externalRef: 'ext-1', roles: ['customer', 'partner'] }));

    expect((await repo.findById('c-1'))?.roles).toEqual(['customer', 'partner']);
    expect(await repo.findAll()).toHaveLength(1);
  });

  it('round-trips firstName/lastName/companyName (companyName absent maps via nullable column)', async () => {
    await repo.save(
      aCustomer({ id: 'c-company', externalRef: 'ext-company', firstName: 'Jane', lastName: 'Doe', companyName: 'Acme GmbH' }),
    );
    await repo.save(
      aCustomer({ id: 'c-person', externalRef: 'ext-person', firstName: 'Max', lastName: 'Braun', companyName: undefined }),
    );

    expect(await repo.findById('c-company')).toMatchObject({ firstName: 'Jane', lastName: 'Doe', companyName: 'Acme GmbH' });
    const person = await repo.findById('c-person');
    expect(person).toMatchObject({ firstName: 'Max', lastName: 'Braun' });
    expect(person?.companyName).toBeUndefined();
  });

  it('allows two customers to share an externalRef (no DB @unique — overlap is enforced app-side)', async () => {
    await repo.save(aCustomer({ id: 'c-c', externalRef: 'X', roles: ['customer'] }));
    await repo.save(aCustomer({ id: 'c-p', externalRef: 'X', roles: ['partner'] }));

    expect((await repo.findAllByExternalRef('X')).map((c) => c.id).sort()).toEqual(['c-c', 'c-p']);
    expect(await repo.findAllByExternalRef('missing')).toEqual([]);
  });
});
