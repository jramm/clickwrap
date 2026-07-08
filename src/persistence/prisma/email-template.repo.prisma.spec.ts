/**
 * Invariant tests against real Postgres — counterpart of
 * src/persistence/inmemory/email-template.repo.spec.ts. Runs only with DATABASE_URL
 * (see agreement-document.repo.prisma.spec.ts for details/invocation).
 */
import type { EmailTemplate } from '../../domain/types';
import { PrismaDocumentTypeRepo } from './document-type.repo';
import { PrismaEmailTemplateRepo } from './email-template.repo';
import { PrismaService } from './prisma.service';
import { resetDatabase } from './testing/reset-database';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

const aTemplate = (overrides: Partial<EmailTemplate> = {}): EmailTemplate => ({
  id: 'tpl-1',
  name: 'Welcome',
  kind: 'VERSION_NOTIFICATION',
  subject: 'Hi {{customerName}}',
  design: '{}',
  html: '<p>Hi {{customerName}}</p>',
  createdAt: new Date('2026-07-08T00:00:00Z'),
  updatedAt: new Date('2026-07-08T00:00:00Z'),
  ...overrides,
});

describeIfDb('PrismaEmailTemplateRepo (against real Postgres)', () => {
  let prisma: PrismaService;
  let documentTypes: PrismaDocumentTypeRepo;
  let repo: PrismaEmailTemplateRepo;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    documentTypes = new PrismaDocumentTypeRepo(prisma);
    repo = new PrismaEmailTemplateRepo(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('save (upsert by id) + findById roundtrip', async () => {
    await repo.save(aTemplate());
    await repo.save(aTemplate({ name: 'Renamed' }));
    expect((await repo.findById('tpl-1'))?.name).toBe('Renamed');
    expect(await repo.findAll()).toHaveLength(1);
  });

  it('deleteIfUnused deletes an unassigned template', async () => {
    await repo.save(aTemplate());
    expect(await repo.deleteIfUnused('tpl-1')).toBe(true);
    expect(await repo.findById('tpl-1')).toBeUndefined();
  });

  it('refuses to delete a template assigned to a document type', async () => {
    await repo.save(aTemplate());
    await documentTypes.save({ id: 'dt-1', key: 'dpa', name: 'DPA', notificationTemplateId: 'tpl-1' });
    expect(await repo.deleteIfUnused('tpl-1')).toBe(false);
  });
});
