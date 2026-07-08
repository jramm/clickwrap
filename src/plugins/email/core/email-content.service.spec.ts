import { FixedClock } from '../../../domain/clock';
import {
  DEFAULT_NOTIFICATION_TEMPLATE_ID,
  DEFAULT_REMINDER_TEMPLATE_ID,
  defaultEmailTemplates,
} from '../../../domain/email-template';
import { aCustomer, aDocument, aVersion } from '../../../domain/testing/fixtures';
import type { EmailTemplate } from '../../../domain/types';
import { InMemoryAcceptanceLinkRepo } from '../../../persistence/inmemory/acceptance-link.repo';
import { InMemoryAgreementDocumentRepo } from '../../../persistence/inmemory/agreement-document.repo';
import { InMemoryAudienceRepo } from '../../../persistence/inmemory/audience.repo';
import { InMemoryCustomerRepo } from '../../../persistence/inmemory/customer.repo';
import { InMemoryDocumentTypeRepo } from '../../../persistence/inmemory/document-type.repo';
import { InMemoryEmailTemplateRepo } from '../../../persistence/inmemory/email-template.repo';
import { EmailContentService } from './email-content.service';
import type { NotificationConfig } from './email-delivery-provider';
import { PermanentAcceptanceLinkService } from './permanent-acceptance-link.service';

const CONFIG: NotificationConfig = {
  appName: 'Clickwrap',
  publicBaseUrl: 'https://clickwrap.example.org',
  acceptanceLinkSecret: 'test-secret',
};

const buildService = async (config: NotificationConfig = CONFIG) => {
  const clock = new FixedClock(new Date('2026-07-08T09:00:00Z'));
  const documents = new InMemoryAgreementDocumentRepo();
  const documentTypes = new InMemoryDocumentTypeRepo(documents);
  const customers = new InMemoryCustomerRepo();
  const audiences = new InMemoryAudienceRepo(documents, customers);
  const templates = new InMemoryEmailTemplateRepo(documentTypes);
  const links = new InMemoryAcceptanceLinkRepo();
  const permanentLinks = new PermanentAcceptanceLinkService(links, clock, config);

  await documents.save(aDocument({ id: 'doc-dpa-customer', type: 'dpa', audience: 'customer', name: 'DPA — Customers' }));
  await documentTypes.save({ id: 'dt-dpa', key: 'dpa', name: 'Data Processing Agreement' });
  await audiences.save({ id: 'aud-customer', key: 'customer', name: 'Customers' });
  for (const t of defaultEmailTemplates(clock)) {
    await templates.save(t);
  }

  const service = new EmailContentService(
    documents,
    documentTypes,
    audiences,
    templates,
    clock,
    config,
    permanentLinks,
  );
  return { service, documentTypes, templates, links };
};

const aTemplate = (overrides: Partial<EmailTemplate>): EmailTemplate => ({
  id: 'tpl-custom',
  name: 'Custom',
  kind: 'VERSION_NOTIFICATION',
  subject: 'Custom subject for {{documentName}}',
  design: '{}',
  html: '<p>Custom {{customerName}} — {{acceptanceLink}}</p>',
  createdAt: new Date('2026-07-08T00:00:00Z'),
  updatedAt: new Date('2026-07-08T00:00:00Z'),
  ...overrides,
});

describe('EmailContentService', () => {
  it('uses the default notification template when the document type has no assignment', async () => {
    const { service } = await buildService();
    const out = await service.renderFor('VERSION_NOTIFICATION', aCustomer(), aVersion());

    expect(out.subject).toContain('DPA — Customers');
    expect(out.subject).toContain('June 2026 edition');
    expect(out.html).toContain('Acme GmbH');
    expect(out.html).not.toContain('{{');
  });

  it('substitutes the permanent acceptance link and the public PDF url', async () => {
    const { service, links } = await buildService();
    const out = await service.renderFor('VERSION_NOTIFICATION', aCustomer(), aVersion());

    expect(out.html).toContain('/accept/');
    expect(out.html).toContain('https://clickwrap.example.org/documents/dpa/customer/latest.pdf');
    // The permanent link row was lazily created so it stays valid/revocable.
    const stored = await links.listByCustomer('c-123');
    expect(stored).toHaveLength(1);
    expect(stored[0].kind).toBe('PERMANENT');
  });

  it('reuses the same permanent link for a later reminder mail', async () => {
    const { service, links } = await buildService();
    await service.renderFor('VERSION_NOTIFICATION', aCustomer(), aVersion());
    await service.renderFor('REMINDER', aCustomer(), aVersion(), new Date('2026-07-21T00:00:00Z'));

    expect(await links.listByCustomer('c-123')).toHaveLength(1);
  });

  it('prefers the document type assignment over the default template', async () => {
    const { service, documentTypes, templates } = await buildService();
    await templates.save(aTemplate({ id: 'tpl-custom' }));
    await documentTypes.save({ id: 'dt-dpa', key: 'dpa', name: 'Data Processing Agreement', notificationTemplateId: 'tpl-custom' });

    const out = await service.renderFor('VERSION_NOTIFICATION', aCustomer(), aVersion());
    expect(out.subject).toBe('Custom subject for DPA — Customers');
    expect(out.html).toContain('Custom Acme GmbH');
  });

  it('resolves the reminder template independently from the notification assignment', async () => {
    const { service, documentTypes, templates } = await buildService();
    await templates.save(aTemplate({ id: 'tpl-custom-notif' }));
    await documentTypes.save({
      id: 'dt-dpa',
      key: 'dpa',
      name: 'Data Processing Agreement',
      notificationTemplateId: 'tpl-custom-notif',
    });

    // No reminder assignment → falls back to the default reminder row.
    const out = await service.renderFor('REMINDER', aCustomer(), aVersion(), new Date('2026-07-21T00:00:00Z'));
    expect(out.subject).toContain('Reminder');
  });

  it('leaves acceptanceLink and documentPdfUrl empty when PUBLIC_BASE_URL is unset', async () => {
    const { service, links } = await buildService({ ...CONFIG, publicBaseUrl: '' });
    const out = await service.renderFor('VERSION_NOTIFICATION', aCustomer(), aVersion());

    expect(out.html).not.toContain('/accept/');
    expect(out.html).not.toContain('latest.pdf');
    // No base URL → no permanent link is minted.
    expect(await links.listByCustomer('c-123')).toHaveLength(0);
  });

  it('renders the default reminder with a complete "The deadline is <date>." sentence', async () => {
    const { service } = await buildService();
    const out = await service.renderFor('REMINDER', aCustomer(), aVersion(), new Date('2026-07-21T00:00:00Z'));

    expect(out.html).toContain('The deadline is 2026-07-21.');
    expect(out.html).not.toContain('The deadline is .');
  });

  it('refuses to render a REMINDER without a deadline (never emits a dangling "The deadline is .")', async () => {
    const { service } = await buildService();

    // Reproduction of the confirmed bug: without this guard the reminder rendered
    // "The deadline is ." (empty {{deadlineAt}}). A reminder must always carry a deadline.
    await expect(service.renderFor('REMINDER', aCustomer(), aVersion())).rejects.toThrow(/deadline/i);
  });

  it('falls back to the in-code default when the default row was never seeded', async () => {
    const { service, templates } = await buildService();
    await templates.deleteIfUnused(DEFAULT_NOTIFICATION_TEMPLATE_ID);
    await templates.deleteIfUnused(DEFAULT_REMINDER_TEMPLATE_ID);

    const out = await service.renderFor('VERSION_NOTIFICATION', aCustomer(), aVersion());
    expect(out.subject).toContain('June 2026 edition');
  });
});
