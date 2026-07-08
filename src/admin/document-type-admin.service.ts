import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ADMIN_AUDIT_TOKEN, type AdminAuditRepo } from '../agreements/audit';
import { newId } from '../agreements/ids';
import type { Clock } from '../domain/clock';
import { DomainError } from '../common/errors';
import type { DocumentTypeRepo, EmailTemplateRepo } from '../domain/ports';
import type { DocumentTypeDef, EmailTemplateKind } from '../domain/types';
import { TOKENS } from '../persistence/tokens';

export interface CreateDocumentTypeInput {
  key: string;
  name: string;
  /**
   * Marks the type as externally-signed (SignedDocument flow) instead of clickwrap
   * (versions/publish/gate). SETTABLE AT CREATION ONLY — immutable afterwards. Default false.
   */
  external?: boolean;
}

/** `key` is deliberately NOT part of this type — it is immutable, see `update()`. */
export interface UpdateDocumentTypeInput {
  name?: string;
  /** string = assign, null = clear, absent = keep. */
  notificationTemplateId?: string | null;
  reminderTemplateId?: string | null;
  acceptanceConfirmationTemplateId?: string | null;
}

/**
 * Admin CRUD for the dynamic DocumentTypeDef entity. Same shape as
 * {@link AudienceAdminService} — kept as a separate class (no shared generic base) to match
 * this codebase's convention of small, explicit per-entity services.
 */
@Injectable()
export class DocumentTypeAdminService {
  constructor(
    @Inject(TOKENS.DocumentTypeRepo) private readonly documentTypes: DocumentTypeRepo,
    @Inject(TOKENS.EmailTemplateRepo) private readonly emailTemplates: EmailTemplateRepo,
    @Inject(ADMIN_AUDIT_TOKEN) private readonly audit: AdminAuditRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  async list(): Promise<DocumentTypeDef[]> {
    const all = await this.documentTypes.findAll();
    return all.sort((a, b) => a.key.localeCompare(b.key));
  }

  async create(input: CreateDocumentTypeInput, actor: string): Promise<DocumentTypeDef> {
    if (!input.name || input.name.trim() === '') {
      throw new DomainError('INVALID_STATE', 'name is required');
    }
    const saved = await this.documentTypes.save({
      id: newId('dt'),
      key: input.key,
      name: input.name,
      external: input.external === true,
    });
    await this.audit.append({
      id: newId('audit'),
      action: 'DOCUMENT_TYPE_CREATE',
      actor,
      targetType: 'DocumentType',
      targetId: saved.id,
      metadata: { key: saved.key, name: saved.name, external: saved.external === true },
      createdAt: this.clock.now(),
    });
    return saved;
  }

  /**
   * `body` is untyped on purpose (the controller passes the raw JSON body): the presence of a
   * `key` property — even set to the current value — is rejected, since only the DTO shape
   * (UpdateDocumentTypeInput) guarantees `key` cannot be sent at the type level.
   */
  async update(id: string, body: Record<string, unknown>, actor: string): Promise<DocumentTypeDef> {
    if (Object.prototype.hasOwnProperty.call(body, 'key')) {
      throw new DomainError('INVALID_STATE', 'key is immutable');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'external')) {
      throw new DomainError('INVALID_STATE', 'external is immutable (set it only at creation)');
    }
    const existing = await this.findByIdOrThrow(id);
    const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name : existing.name;
    const notificationTemplateId = await this.resolveAssignment(
      body,
      'notificationTemplateId',
      'VERSION_NOTIFICATION',
      existing.notificationTemplateId,
    );
    const reminderTemplateId = await this.resolveAssignment(
      body,
      'reminderTemplateId',
      'REMINDER',
      existing.reminderTemplateId,
    );
    const acceptanceConfirmationTemplateId = await this.resolveAssignment(
      body,
      'acceptanceConfirmationTemplateId',
      'ACCEPTANCE_CONFIRMATION',
      existing.acceptanceConfirmationTemplateId,
    );
    const updated = await this.documentTypes.save({
      ...existing,
      name,
      notificationTemplateId,
      reminderTemplateId,
      acceptanceConfirmationTemplateId,
    });
    await this.audit.append({
      id: newId('audit'),
      action: 'DOCUMENT_TYPE_UPDATE',
      actor,
      targetType: 'DocumentType',
      targetId: id,
      metadata: {
        name: updated.name,
        notificationTemplateId: updated.notificationTemplateId ?? null,
        reminderTemplateId: updated.reminderTemplateId ?? null,
        acceptanceConfirmationTemplateId: updated.acceptanceConfirmationTemplateId ?? null,
      },
      createdAt: this.clock.now(),
    });
    return updated;
  }

  /**
   * Resolves a template assignment from the raw body: `null` clears it, a string assigns it (after
   * validating the template exists and matches the expected kind), and an absent property keeps the
   * current value.
   */
  private async resolveAssignment(
    body: Record<string, unknown>,
    field: 'notificationTemplateId' | 'reminderTemplateId' | 'acceptanceConfirmationTemplateId',
    expectedKind: EmailTemplateKind,
    current: string | undefined,
  ): Promise<string | undefined> {
    if (!Object.prototype.hasOwnProperty.call(body, field)) {
      return current;
    }
    const value = body[field];
    if (value === null) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw new DomainError('INVALID_STATE', `${field} must be a template id, null, or omitted`);
    }
    const template = await this.emailTemplates.findById(value);
    if (!template) {
      throw new DomainError('INVALID_STATE', `Unknown e-mail template: ${value}`);
    }
    if (template.kind !== expectedKind) {
      throw new DomainError(
        'INVALID_STATE',
        `${field} must reference a ${expectedKind} template (got ${template.kind})`,
      );
    }
    return value;
  }

  async remove(id: string, actor: string): Promise<void> {
    const existing = await this.findByIdOrThrow(id);
    const deleted = await this.documentTypes.deleteIfUnused(existing.key);
    if (!deleted) {
      throw new DomainError('INVALID_STATE', 'document type is still in use');
    }
    await this.audit.append({
      id: newId('audit'),
      action: 'DOCUMENT_TYPE_DELETE',
      actor,
      targetType: 'DocumentType',
      targetId: id,
      metadata: { key: existing.key },
      createdAt: this.clock.now(),
    });
  }

  private async findByIdOrThrow(id: string): Promise<DocumentTypeDef> {
    const found = (await this.documentTypes.findAll()).find((t) => t.id === id);
    if (!found) {
      throw new NotFoundException(`DocumentType ${id} not found`);
    }
    return found;
  }
}
