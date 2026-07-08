import { NotFoundException } from '@nestjs/common';
import { InMemoryAdminAuditRepo } from '../agreements/audit';
import { DomainError } from '../common/errors';
import { FixedClock } from '../domain/clock';
import { aDocument, aDocumentTypeDef } from '../domain/testing/fixtures';
import {
  InMemoryAgreementDocumentRepo,
  InMemoryDocumentTypeRepo,
  InMemoryEmailTemplateRepo,
} from '../persistence/inmemory';
import type { EmailTemplate } from '../domain/types';
import { DocumentTypeAdminService } from './document-type-admin.service';

const T0 = new Date('2026-07-07T09:00:00Z');

const aTemplate = (overrides: Partial<EmailTemplate>): EmailTemplate => ({
  id: 'tpl-1',
  name: 'T',
  kind: 'VERSION_NOTIFICATION',
  subject: 's',
  design: '{}',
  html: '<p>h</p>',
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
});

describe('DocumentTypeAdminService', () => {
  let documentTypes: InMemoryDocumentTypeRepo;
  let documents: InMemoryAgreementDocumentRepo;
  let emailTemplates: InMemoryEmailTemplateRepo;
  let audit: InMemoryAdminAuditRepo;
  let service: DocumentTypeAdminService;

  beforeEach(() => {
    documents = new InMemoryAgreementDocumentRepo();
    documentTypes = new InMemoryDocumentTypeRepo(documents);
    emailTemplates = new InMemoryEmailTemplateRepo(documentTypes);
    audit = new InMemoryAdminAuditRepo();
    service = new DocumentTypeAdminService(documentTypes, emailTemplates, audit, new FixedClock(T0));
  });

  describe('list', () => {
    it('returns all document types sorted by key', async () => {
      await documentTypes.save(aDocumentTypeDef({ id: 'dt-2', key: 'terms', name: 'Terms of Service' }));
      await documentTypes.save(aDocumentTypeDef({ id: 'dt-1', key: 'dpa', name: 'DPA' }));

      expect(await service.list()).toEqual([
        { id: 'dt-1', key: 'dpa', name: 'DPA', external: false },
        { id: 'dt-2', key: 'terms', name: 'Terms of Service', external: false },
      ]);
    });
  });

  describe('create', () => {
    it('creates a document type and writes an audit log entry', async () => {
      const created = await service.create({ key: 'dpa', name: 'Data Processing Agreement' }, 'admin-1');

      expect(created).toMatchObject({ key: 'dpa', name: 'Data Processing Agreement' });
      const logs = await audit.findByTarget('DocumentType', created.id);
      expect(logs).toMatchObject([{ action: 'DOCUMENT_TYPE_CREATE', actor: 'admin-1', createdAt: T0 }]);
    });

    it('rejects an invalid slug key with INVALID_STATE', async () => {
      await expect(service.create({ key: 'NOT A SLUG', name: 'x' }, 'admin-1')).rejects.toBeInstanceOf(DomainError);
    });

    it('rejects a duplicate key with INVALID_STATE', async () => {
      await service.create({ key: 'dpa', name: 'DPA' }, 'admin-1');
      await expect(service.create({ key: 'dpa', name: 'Other' }, 'admin-1')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
    });

    it('defaults external to false when omitted', async () => {
      const created = await service.create({ key: 'dpa', name: 'DPA' }, 'admin-1');
      expect(created.external).toBe(false);
    });

    it('creates an external document type when external: true and records it in the audit metadata', async () => {
      const created = await service.create({ key: 'signed-offer', name: 'Signed offer', external: true }, 'admin-1');

      expect(created.external).toBe(true);
      const logs = await audit.findByTarget('DocumentType', created.id);
      expect(logs[0].metadata).toMatchObject({ external: true });
    });
  });

  describe('update', () => {
    it('renames a document type (200) and writes an audit log entry', async () => {
      const created = await service.create({ key: 'dpa', name: 'DPA' }, 'admin-1');

      const updated = await service.update(created.id, { name: 'Data Processing Agreement' }, 'admin-2');

      expect(updated).toEqual({ id: created.id, key: 'dpa', name: 'Data Processing Agreement', external: false });
      expect(
        (await audit.findByTarget('DocumentType', created.id)).some((l) => l.action === 'DOCUMENT_TYPE_UPDATE'),
      ).toBe(true);
    });

    it('rejects a body containing key with INVALID_STATE "key is immutable"', async () => {
      const created = await service.create({ key: 'dpa', name: 'DPA' }, 'admin-1');

      await expect(service.update(created.id, { key: 'terms', name: 'x' }, 'admin-1')).rejects.toMatchObject({
        code: 'INVALID_STATE',
        message: 'key is immutable',
      });
    });

    it('throws NotFoundException for an unknown id', async () => {
      await expect(service.update('dt-ghost', { name: 'x' }, 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a body containing external with INVALID_STATE (external is immutable)', async () => {
      const created = await service.create({ key: 'signed-offer', name: 'Signed offer', external: true }, 'admin-1');

      await expect(service.update(created.id, { external: false, name: 'x' }, 'admin-1')).rejects.toMatchObject({
        code: 'INVALID_STATE',
        message: 'external is immutable (set it only at creation)',
      });
    });

    it('preserves external across a rename (never flips it)', async () => {
      const created = await service.create({ key: 'signed-offer', name: 'Signed offer', external: true }, 'admin-1');
      const renamed = await service.update(created.id, { name: 'Signed offers' }, 'admin-1');
      expect(renamed.external).toBe(true);
    });

    it('assigns notification + reminder templates after validating existence and kind', async () => {
      const created = await service.create({ key: 'dpa', name: 'DPA' }, 'admin-1');
      await emailTemplates.save(aTemplate({ id: 'tpl-n', kind: 'VERSION_NOTIFICATION' }));
      await emailTemplates.save(aTemplate({ id: 'tpl-r', kind: 'REMINDER' }));

      const updated = await service.update(
        created.id,
        { notificationTemplateId: 'tpl-n', reminderTemplateId: 'tpl-r' },
        'admin-1',
      );
      expect(updated.notificationTemplateId).toBe('tpl-n');
      expect(updated.reminderTemplateId).toBe('tpl-r');
    });

    it('assigns an acceptance-confirmation template (kind-validated) and clears it with null', async () => {
      const created = await service.create({ key: 'dpa', name: 'DPA' }, 'admin-1');
      await emailTemplates.save(aTemplate({ id: 'tpl-c', kind: 'ACCEPTANCE_CONFIRMATION' }));

      const assigned = await service.update(
        created.id,
        { acceptanceConfirmationTemplateId: 'tpl-c' },
        'admin-1',
      );
      expect(assigned.acceptanceConfirmationTemplateId).toBe('tpl-c');

      const cleared = await service.update(created.id, { acceptanceConfirmationTemplateId: null }, 'admin-1');
      expect(cleared.acceptanceConfirmationTemplateId).toBeUndefined();
    });

    it('rejects a non-ACCEPTANCE_CONFIRMATION template for the confirmation assignment', async () => {
      const created = await service.create({ key: 'dpa', name: 'DPA' }, 'admin-1');
      await emailTemplates.save(aTemplate({ id: 'tpl-n', kind: 'VERSION_NOTIFICATION' }));
      await expect(
        service.update(created.id, { acceptanceConfirmationTemplateId: 'tpl-n' }, 'admin-1'),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('clears an assignment with explicit null and keeps it when the property is absent', async () => {
      const created = await service.create({ key: 'dpa', name: 'DPA' }, 'admin-1');
      await emailTemplates.save(aTemplate({ id: 'tpl-n', kind: 'VERSION_NOTIFICATION' }));
      await service.update(created.id, { notificationTemplateId: 'tpl-n' }, 'admin-1');

      const kept = await service.update(created.id, { name: 'DPA v2' }, 'admin-1');
      expect(kept.notificationTemplateId).toBe('tpl-n');

      const cleared = await service.update(created.id, { notificationTemplateId: null }, 'admin-1');
      expect(cleared.notificationTemplateId).toBeUndefined();
    });

    it('rejects an unknown template id (INVALID_STATE)', async () => {
      const created = await service.create({ key: 'dpa', name: 'DPA' }, 'admin-1');
      await expect(
        service.update(created.id, { notificationTemplateId: 'ghost' }, 'admin-1'),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('rejects a template of the wrong kind (INVALID_STATE)', async () => {
      const created = await service.create({ key: 'dpa', name: 'DPA' }, 'admin-1');
      await emailTemplates.save(aTemplate({ id: 'tpl-r', kind: 'REMINDER' }));
      await expect(
        service.update(created.id, { notificationTemplateId: 'tpl-r' }, 'admin-1'),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });
  });

  describe('remove', () => {
    it('deletes an unreferenced document type', async () => {
      const created = await service.create({ key: 'dpa', name: 'DPA' }, 'admin-1');

      await service.remove(created.id, 'admin-1');

      expect(await documentTypes.findByKey('dpa')).toBeUndefined();
      expect(
        (await audit.findByTarget('DocumentType', created.id)).some((l) => l.action === 'DOCUMENT_TYPE_DELETE'),
      ).toBe(true);
    });

    it('refuses deletion while referenced by a document → INVALID_STATE, no audit entry', async () => {
      const created = await service.create({ key: 'dpa', name: 'DPA' }, 'admin-1');
      await documents.save(aDocument({ type: 'dpa' }));

      await expect(service.remove(created.id, 'admin-1')).rejects.toMatchObject({
        code: 'INVALID_STATE',
        message: 'document type is still in use',
      });
      expect(await documentTypes.findByKey('dpa')).toBeDefined();
      expect(
        (await audit.findByTarget('DocumentType', created.id)).some((l) => l.action === 'DOCUMENT_TYPE_DELETE'),
      ).toBe(false);
    });

    it('throws NotFoundException for an unknown id', async () => {
      await expect(service.remove('dt-ghost', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
