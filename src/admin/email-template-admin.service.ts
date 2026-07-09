import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ADMIN_AUDIT_TOKEN, type AdminAuditRepo } from '../agreements/audit';
import { newId } from '../agreements/ids';
import { EventRecorder } from '../events/event-recorder';
import { DomainError } from '../common/errors';
import type { Clock } from '../domain/clock';
import {
  emptyTemplateVars,
  isDefaultEmailTemplateId,
  renderTemplate,
  type RenderedTemplate,
} from '../domain/email-template';
import type { DocumentTypeRepo, EmailTemplateRepo } from '../domain/ports';
import type { EmailTemplate, EmailTemplateKind } from '../domain/types';
import { TOKENS } from '../persistence/tokens';

export interface CreateEmailTemplateInput {
  name: string;
  kind: EmailTemplateKind;
  subject: string;
  /** Unlayer design JSON (serialised). */
  design: string;
  /** Exported e-mail HTML. */
  html: string;
}

export interface UpdateEmailTemplateInput {
  name?: string;
  kind?: EmailTemplateKind;
  subject?: string;
  design?: string;
  html?: string;
}

/** An {@link EmailTemplate} plus the derived `isDefault` flag (a built-in, undeletable row). */
export type EmailTemplateView = EmailTemplate & { isDefault: boolean };

/** Realistic sample values used by the preview endpoint. */
const sampleVars = (documentTypeName: string) => ({
  ...emptyTemplateVars(),
  customerName: 'Acme GmbH',
  firstName: 'Jane',
  lastName: 'Doe',
  companyName: 'Acme GmbH',
  documentName: `${documentTypeName} — Customers`,
  documentType: documentTypeName,
  audience: 'Customers',
  versionLabel: 'June 2026 edition',
  changeSummary: 'Added a new sub-processor for e-mail delivery.',
  validFrom: '2026-07-01',
  deadlineAt: '2026-07-21',
  acceptedAt: '2026-07-08T14:12:03.000Z',
  acceptanceLink: 'https://clickwrap.example.org/accept/sample-token',
  documentPdfUrl: 'https://clickwrap.example.org/documents/dpa/customer/latest.pdf',
  appName: 'clickwrap-server',
});

/**
 * Admin CRUD for {@link EmailTemplate} + a live preview. Mirrors the audience/document-type admin
 * services (id-based lookup + audit trail). The two built-in default rows are editable but never
 * deletable (INVALID_STATE); deleting a template still assigned to a document type is refused.
 */
@Injectable()
export class EmailTemplateAdminService {
  constructor(
    @Inject(TOKENS.EmailTemplateRepo) private readonly templates: EmailTemplateRepo,
    @Inject(TOKENS.DocumentTypeRepo) private readonly documentTypes: DocumentTypeRepo,
    @Inject(ADMIN_AUDIT_TOKEN) private readonly audit: AdminAuditRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Optional() private readonly recorder?: EventRecorder,
  ) {}

  async list(): Promise<EmailTemplateView[]> {
    const all = await this.templates.findAll();
    return all
      .map((t) => ({ ...t, isDefault: isDefaultEmailTemplateId(t.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(input: CreateEmailTemplateInput, actor: string): Promise<EmailTemplateView> {
    const now = this.clock.now();
    const saved = await this.templates.save({
      id: newId('tpl'),
      name: input.name,
      kind: input.kind,
      subject: input.subject,
      design: input.design,
      html: input.html,
      createdAt: now,
      updatedAt: now,
    });
    await this.audit.append({
      id: newId('audit'),
      action: 'EMAIL_TEMPLATE_CREATE',
      actor,
      targetType: 'EmailTemplate',
      targetId: saved.id,
      metadata: { name: saved.name, kind: saved.kind },
      createdAt: now,
    });
    await this.recorder?.record({
      type: 'EMAIL_TEMPLATE_CREATED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: actor,
      summary: `E-mail template "${saved.name}" created`,
      metadata: { templateId: saved.id, name: saved.name, kind: saved.kind },
    });
    return { ...saved, isDefault: isDefaultEmailTemplateId(saved.id) };
  }

  async update(id: string, input: UpdateEmailTemplateInput, actor: string): Promise<EmailTemplateView> {
    const existing = await this.findByIdOrThrow(id);
    const updated = await this.templates.save({
      ...existing,
      name: input.name ?? existing.name,
      kind: input.kind ?? existing.kind,
      subject: input.subject ?? existing.subject,
      design: input.design ?? existing.design,
      html: input.html ?? existing.html,
      updatedAt: this.clock.now(),
    });
    await this.audit.append({
      id: newId('audit'),
      action: 'EMAIL_TEMPLATE_UPDATE',
      actor,
      targetType: 'EmailTemplate',
      targetId: id,
      metadata: { name: updated.name, kind: updated.kind },
      createdAt: this.clock.now(),
    });
    await this.recorder?.record({
      type: 'EMAIL_TEMPLATE_UPDATED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: actor,
      summary: `E-mail template "${updated.name}" updated`,
      metadata: { templateId: updated.id, name: updated.name, kind: updated.kind },
    });
    return { ...updated, isDefault: isDefaultEmailTemplateId(updated.id) };
  }

  async remove(id: string, actor: string): Promise<void> {
    const existing = await this.findByIdOrThrow(id);
    if (isDefaultEmailTemplateId(id)) {
      throw new DomainError('INVALID_STATE', 'default template cannot be deleted');
    }
    const deleted = await this.templates.deleteIfUnused(id);
    if (!deleted) {
      throw new DomainError('INVALID_STATE', 'email template is still assigned to a document type');
    }
    await this.audit.append({
      id: newId('audit'),
      action: 'EMAIL_TEMPLATE_DELETE',
      actor,
      targetType: 'EmailTemplate',
      targetId: id,
      metadata: { name: existing.name },
      createdAt: this.clock.now(),
    });
    await this.recorder?.record({
      type: 'EMAIL_TEMPLATE_DELETED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: actor,
      summary: `E-mail template "${existing.name}" deleted`,
      metadata: { templateId: id, name: existing.name },
    });
  }

  /** Renders the template with realistic sample values (optionally scoped to a document type). */
  async preview(id: string, documentTypeKey?: string): Promise<RenderedTemplate> {
    const template = await this.findByIdOrThrow(id);
    let documentTypeName = 'Data Processing Agreement';
    if (documentTypeKey !== undefined) {
      const documentType = await this.documentTypes.findByKey(documentTypeKey);
      if (documentType) {
        documentTypeName = documentType.name;
      }
    }
    return renderTemplate(template, sampleVars(documentTypeName));
  }

  private async findByIdOrThrow(id: string): Promise<EmailTemplate> {
    const found = await this.templates.findById(id);
    if (!found) {
      throw new NotFoundException(`EmailTemplate ${id} not found`);
    }
    return found;
  }
}
