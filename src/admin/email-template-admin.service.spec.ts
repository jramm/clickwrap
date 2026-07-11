import { InMemoryAdminAuditRepo } from '../agreements/audit.js';
import { FixedClock } from '../domain/clock.js';
import {
  DEFAULT_NOTIFICATION_TEMPLATE_ID,
  defaultEmailTemplates,
} from '../domain/email-template.js';
import { InMemoryAgreementDocumentRepo } from '../persistence/inmemory/agreement-document.repo.js';
import { InMemoryDocumentTypeRepo } from '../persistence/inmemory/document-type.repo.js';
import { InMemoryEmailTemplateRepo } from '../persistence/inmemory/email-template.repo.js';
import { EmailTemplateAdminService } from './email-template-admin.service.js';

const build = async () => {
  const clock = new FixedClock(new Date('2026-07-08T09:00:00Z'));
  const documents = new InMemoryAgreementDocumentRepo();
  const documentTypes = new InMemoryDocumentTypeRepo(documents);
  const templates = new InMemoryEmailTemplateRepo(documentTypes);
  const audit = new InMemoryAdminAuditRepo();
  for (const t of defaultEmailTemplates(clock)) {
    await templates.save(t);
  }
  const service = new EmailTemplateAdminService(templates, documentTypes, audit, clock);
  return { service, templates, documentTypes, audit };
};

const createInput = {
  name: 'Welcome',
  kind: 'VERSION_NOTIFICATION' as const,
  subject: 'Hi {{customerName}}',
  design: '{}',
  html: '<p>Hi {{customerName}}</p>',
};

describe('EmailTemplateAdminService', () => {
  it('lists templates sorted by name and marks the built-in defaults', async () => {
    const { service } = await build();
    const list = await service.list();
    const byId = new Map(list.map((t) => [t.id, t]));
    expect(byId.get(DEFAULT_NOTIFICATION_TEMPLATE_ID)?.isDefault).toBe(true);
  });

  it('creates a template + writes an audit entry', async () => {
    const { service, audit } = await build();
    const created = await service.create(createInput, 'admin-1');

    expect(created.id).toMatch(/^tpl-/);
    expect(created.isDefault).toBe(false);
    expect((await audit.findAll()).map((a) => a.action)).toContain('EMAIL_TEMPLATE_CREATE');
  });

  it('updates a template (partial) + writes an audit entry', async () => {
    const { service, audit } = await build();
    const created = await service.create(createInput, 'admin-1');

    const updated = await service.update(created.id, { name: 'Renamed' }, 'admin-1');
    expect(updated.name).toBe('Renamed');
    expect(updated.subject).toBe(createInput.subject);
    expect((await audit.findAll()).map((a) => a.action)).toContain('EMAIL_TEMPLATE_UPDATE');
  });

  it('allows editing a default template', async () => {
    const { service } = await build();
    const updated = await service.update(DEFAULT_NOTIFICATION_TEMPLATE_ID, { subject: 'Edited' }, 'admin-1');
    expect(updated.subject).toBe('Edited');
    expect(updated.isDefault).toBe(true);
  });

  it('refuses to delete a default template (INVALID_STATE)', async () => {
    const { service } = await build();
    await expect(service.remove(DEFAULT_NOTIFICATION_TEMPLATE_ID, 'admin-1')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('refuses to delete a template still assigned to a document type (INVALID_STATE)', async () => {
    const { service, documentTypes } = await build();
    const created = await service.create(createInput, 'admin-1');
    await documentTypes.save({ id: 'dt-1', key: 'dpa', name: 'DPA', notificationTemplateId: created.id });

    await expect(service.remove(created.id, 'admin-1')).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('deletes an unassigned template + writes an audit entry', async () => {
    const { service, templates, audit } = await build();
    const created = await service.create(createInput, 'admin-1');

    await service.remove(created.id, 'admin-1');
    expect(await templates.findById(created.id)).toBeUndefined();
    expect((await audit.findAll()).map((a) => a.action)).toContain('EMAIL_TEMPLATE_DELETE');
  });

  it('throws 404 for an unknown id on update/remove/preview', async () => {
    const { service } = await build();
    await expect(service.update('nope', {}, 'a')).rejects.toThrow();
    await expect(service.remove('nope', 'a')).rejects.toThrow();
    await expect(service.preview('nope')).rejects.toThrow();
  });

  it('preview renders subject/html/text with sample values (no stray placeholders)', async () => {
    const { service } = await build();
    const preview = await service.preview(DEFAULT_NOTIFICATION_TEMPLATE_ID);

    expect(preview.subject).toContain('June 2026 edition');
    expect(preview.html).toContain('Acme GmbH');
    expect(preview.html).not.toContain('{{');
    expect(preview.text.length).toBeGreaterThan(0);
  });

  it('preview scopes the documentType sample to a given document type key', async () => {
    const { service, documentTypes } = await build();
    await documentTypes.save({ id: 'dt-terms', key: 'terms', name: 'Terms of Service' });

    const preview = await service.preview(DEFAULT_NOTIFICATION_TEMPLATE_ID, 'terms');
    expect(preview.subject).toContain('Terms of Service');
  });
});
