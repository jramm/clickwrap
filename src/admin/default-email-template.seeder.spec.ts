import { FixedClock } from '../domain/clock';
import {
  DEFAULT_ACCEPTANCE_CONFIRMATION_TEMPLATE_ID,
  DEFAULT_NOTIFICATION_TEMPLATE_ID,
  DEFAULT_REMINDER_TEMPLATE_ID,
} from '../domain/email-template';
import { InMemoryAgreementDocumentRepo } from '../persistence/inmemory/agreement-document.repo';
import { InMemoryDocumentTypeRepo } from '../persistence/inmemory/document-type.repo';
import { InMemoryEmailTemplateRepo } from '../persistence/inmemory/email-template.repo';
import { DefaultEmailTemplateSeeder } from './default-email-template.seeder';

describe('DefaultEmailTemplateSeeder', () => {
  let templates: InMemoryEmailTemplateRepo;
  let seeder: DefaultEmailTemplateSeeder;

  beforeEach(() => {
    const documents = new InMemoryAgreementDocumentRepo();
    const documentTypes = new InMemoryDocumentTypeRepo(documents);
    templates = new InMemoryEmailTemplateRepo(documentTypes);
    seeder = new DefaultEmailTemplateSeeder(templates, new FixedClock(new Date('2026-07-08T00:00:00Z')));
  });

  it('creates all default rows on first bootstrap', async () => {
    await seeder.onApplicationBootstrap();
    expect(await templates.findById(DEFAULT_NOTIFICATION_TEMPLATE_ID)).toBeDefined();
    expect(await templates.findById(DEFAULT_REMINDER_TEMPLATE_ID)).toBeDefined();
    expect(await templates.findById(DEFAULT_ACCEPTANCE_CONFIRMATION_TEMPLATE_ID)).toBeDefined();
    expect(await templates.findAll()).toHaveLength(3);
  });

  it('is idempotent and never overwrites an edited default row', async () => {
    await seeder.ensureDefaults();
    const edited = await templates.findById(DEFAULT_NOTIFICATION_TEMPLATE_ID);
    if (!edited) throw new Error('missing');
    await templates.save({ ...edited, subject: 'Admin-edited subject' });

    await seeder.ensureDefaults();

    expect((await templates.findById(DEFAULT_NOTIFICATION_TEMPLATE_ID))?.subject).toBe('Admin-edited subject');
    expect(await templates.findAll()).toHaveLength(3);
  });
});
