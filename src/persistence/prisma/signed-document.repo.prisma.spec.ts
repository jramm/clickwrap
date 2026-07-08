/**
 * Invariant tests against real Postgres — counterpart of
 * src/persistence/inmemory/signed-document.repo.spec.ts. Runs only with DATABASE_URL (see
 * agreement-document.repo.prisma.spec.ts for details/invocation).
 *
 * Verifies the append-only roundtrip and the newest-first ordering of findByCustomer against
 * real rows, plus that optional fields survive the null <-> undefined mapping.
 */
import { aSignedDocument } from '../../domain/testing/fixtures';
import { PrismaSignedDocumentRepo } from './signed-document.repo';
import { PrismaService } from './prisma.service';
import { resetDatabase } from './testing/reset-database';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('PrismaSignedDocumentRepo (against real Postgres)', () => {
  let prisma: PrismaService;
  let repo: PrismaSignedDocumentRepo;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    repo = new PrismaSignedDocumentRepo(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('append + findById roundtrip', async () => {
    const doc = aSignedDocument({ id: 'sd-1', customerId: 'c-1' });
    await repo.append(doc);
    expect(await repo.findById('sd-1')).toEqual(doc);
    expect(await repo.findById('unknown')).toBeUndefined();
  });

  it('maps optional fields (audience/signerName/reference/note) through null <-> undefined', async () => {
    await repo.append(
      aSignedDocument({
        id: 'sd-min',
        customerId: 'c-1',
        audience: undefined,
        signerName: undefined,
        reference: undefined,
        note: undefined,
      }),
    );
    const found = await repo.findById('sd-min');
    expect(found).toMatchObject({ audience: undefined, signerName: undefined, reference: undefined, note: undefined });
  });

  it('findByCustomer returns only the customer’s documents, newest first', async () => {
    await repo.append(aSignedDocument({ id: 'sd-old', customerId: 'c-1', uploadedAt: new Date('2026-07-01T00:00:00Z') }));
    await repo.append(aSignedDocument({ id: 'sd-new', customerId: 'c-1', uploadedAt: new Date('2026-07-05T00:00:00Z') }));
    await repo.append(aSignedDocument({ id: 'sd-other', customerId: 'c-2' }));

    const list = await repo.findByCustomer('c-1');
    expect(list.map((d) => d.id)).toEqual(['sd-new', 'sd-old']);
  });
});
