import type { EmailTemplate } from '../../domain/types';
import { InMemoryAgreementDocumentRepo } from './agreement-document.repo';
import { InMemoryDocumentTypeRepo } from './document-type.repo';
import { InMemoryEmailTemplateRepo } from './email-template.repo';

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

describe('InMemoryEmailTemplateRepo', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let documentTypes: InMemoryDocumentTypeRepo;
  let repo: InMemoryEmailTemplateRepo;

  beforeEach(() => {
    documents = new InMemoryAgreementDocumentRepo();
    documentTypes = new InMemoryDocumentTypeRepo(documents);
    repo = new InMemoryEmailTemplateRepo(documentTypes);
  });

  it('saves (upsert by id) and reads back', async () => {
    await repo.save(aTemplate());
    await repo.save(aTemplate({ name: 'Renamed' }));
    expect((await repo.findById('tpl-1'))?.name).toBe('Renamed');
    expect(await repo.findAll()).toHaveLength(1);
  });

  it('returns a defensive copy (no aliasing of the stored row)', async () => {
    await repo.save(aTemplate());
    const found = await repo.findById('tpl-1');
    if (found) found.subject = 'mutated';
    expect((await repo.findById('tpl-1'))?.subject).toBe('Hi {{customerName}}');
  });

  it('deleteIfUnused deletes an unassigned template', async () => {
    await repo.save(aTemplate());
    expect(await repo.deleteIfUnused('tpl-1')).toBe(true);
    expect(await repo.findById('tpl-1')).toBeUndefined();
  });

  it('deleteIfUnused returns false for an unknown id', async () => {
    expect(await repo.deleteIfUnused('nope')).toBe(false);
  });

  it('refuses to delete a template assigned as a notification template', async () => {
    await repo.save(aTemplate());
    await documentTypes.save({ id: 'dt-1', key: 'dpa', name: 'DPA', notificationTemplateId: 'tpl-1' });
    expect(await repo.deleteIfUnused('tpl-1')).toBe(false);
  });

  it('refuses to delete a template assigned as a reminder template', async () => {
    await repo.save(aTemplate({ kind: 'REMINDER' }));
    await documentTypes.save({ id: 'dt-1', key: 'dpa', name: 'DPA', reminderTemplateId: 'tpl-1' });
    expect(await repo.deleteIfUnused('tpl-1')).toBe(false);
  });
});
