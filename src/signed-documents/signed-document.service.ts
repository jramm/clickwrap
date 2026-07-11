import { Inject, Injectable, Optional } from '@nestjs/common';
import { ADMIN_AUDIT_TOKEN, type AdminAuditRepo } from '../agreements/audit.js';
import { newId } from '../agreements/ids.js';
import { AGREEMENTS_TOKENS, type PdfStorage, type PdfUpload } from '../agreements/ports.js';
import type { Actor } from '../common/auth/actor.js';
import { DomainError } from '../common/errors.js';
import type { Clock } from '../domain/clock.js';
import { customerDisplayName } from '../domain/customer.js';
import type { AudienceRepo, CustomerRepo, DocumentTypeRepo, SignedDocumentRepo } from '../domain/ports.js';
import type { SignedDocument } from '../domain/types.js';
import { EventRecorder } from '../events/event-recorder.js';
import { TOKENS } from '../persistence/tokens.js';
import { toSignedDocumentDto, type SignedDocumentDto } from './signed-document.dto.js';

export interface UploadSignedDocumentInput {
  documentTypeKey: string;
  /** When the document was signed (backdatable). */
  signedAt: Date;
  file: PdfUpload;
  signerName?: string;
  reference?: string;
  /** Optional audience key — validated to exist when given. */
  audience?: string;
  note?: string;
}

/** Extra behaviour toggles per surface — only the admin surface writes the admin audit log. */
export interface UploadSignedDocumentOptions {
  /** Write a SIGNED_DOCUMENT_UPLOAD admin-audit entry (admin surface only). */
  recordAudit?: boolean;
}

/**
 * Shared service for externally-signed documents — used by BOTH the admin controller (AdminGuard)
 * and the integration controller (ServiceTokenGuard), so there is NO logic duplication. The PDF is
 * stored via the FileStorage plugin (PdfStorage adapter computes the host-side contentHash); the
 * record is append-only and immutable.
 *
 * IMPORTANT: signed documents are a pure evidence archive and are NEVER part of the compliance
 * gate — they do not affect `compliant`, pending agreements, deadlines or dashboards.
 */
@Injectable()
export class SignedDocumentService {
  constructor(
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.DocumentTypeRepo) private readonly documentTypes: DocumentTypeRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
    @Inject(TOKENS.SignedDocumentRepo) private readonly signedDocuments: SignedDocumentRepo,
    @Inject(AGREEMENTS_TOKENS.PdfStorage) private readonly pdf: PdfStorage,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Optional() @Inject(ADMIN_AUDIT_TOKEN) private readonly audit?: AdminAuditRepo,
    @Optional() private readonly recorder?: EventRecorder,
  ) {}

  async upload(
    customerId: string,
    input: UploadSignedDocumentInput,
    actor: Actor,
    options: UploadSignedDocumentOptions = {},
  ): Promise<SignedDocumentDto> {
    if (!input.file || input.file.buffer.length === 0) {
      throw new DomainError('INVALID_STATE', 'file is required');
    }
    if (Number.isNaN(input.signedAt.getTime())) {
      throw new DomainError('INVALID_STATE', 'signedAt is not a valid date');
    }

    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new DomainError('CUSTOMER_NOT_FOUND');
    }
    const documentType = await this.documentTypes.findByKey(input.documentTypeKey);
    if (!documentType) {
      throw new DomainError('UNKNOWN_DOCUMENT_TYPE', `Unknown document type: ${input.documentTypeKey}`);
    }
    if (documentType.external !== true) {
      throw new DomainError(
        'DOCUMENT_TYPE_NOT_EXTERNAL',
        `Document type "${input.documentTypeKey}" is not external — use the version/clickwrap flow`,
      );
    }
    if (input.audience !== undefined && !(await this.audiences.findByKey(input.audience))) {
      throw new DomainError('UNKNOWN_AUDIENCE', `Unknown audience: ${input.audience}`);
    }

    const stored = await this.pdf.store(input.file);
    const now = this.clock.now();
    const saved = await this.signedDocuments.append({
      id: newId('sd'),
      customerId,
      documentTypeKey: input.documentTypeKey,
      audience: input.audience,
      fileName: stored.fileName,
      storageKey: stored.storageKey,
      contentHash: stored.contentHash,
      fileSize: stored.fileSize,
      signedAt: input.signedAt,
      signerName: input.signerName,
      reference: input.reference,
      note: input.note,
      uploadedBy: actor.userId,
      uploadedAt: now,
    });

    if (options.recordAudit && this.audit) {
      await this.audit.append({
        id: newId('audit'),
        action: 'SIGNED_DOCUMENT_UPLOAD',
        actor: actor.userId,
        targetType: 'SignedDocument',
        targetId: saved.id,
        metadata: {
          customerId,
          documentTypeKey: saved.documentTypeKey,
          contentHash: saved.contentHash,
          storageKey: saved.storageKey,
        },
        createdAt: now,
      });
    }

    // Admin surface = ADMIN actor; the integration (service-token) surface = SYSTEM.
    await this.recorder?.record({
      type: 'SIGNED_DOCUMENT_UPLOADED',
      category: 'ADMINISTRATION',
      actorKind: options.recordAudit ? 'ADMIN' : 'SYSTEM',
      actorLabel: actor.userId,
      customerId,
      customerName: customerDisplayName(customer),
      documentType: saved.documentTypeKey,
      audience: saved.audience,
      summary: `Signed document uploaded (${saved.documentTypeKey})`,
      metadata: { signedDocumentId: saved.id, contentHash: saved.contentHash },
    });

    return this.toDto(saved);
  }

  /** All signed documents of a customer as DTOs, newest first — each with a fresh presigned pdfUrl. */
  async list(customerId: string): Promise<SignedDocumentDto[]> {
    const documents = await this.signedDocuments.findByCustomer(customerId);
    return Promise.all(documents.map((document) => this.toDto(document)));
  }

  /** Time-limited download URL of a signed document PDF (404 for an unknown id). */
  async getPdfUrl(id: string): Promise<string> {
    const document = await this.signedDocuments.findById(id);
    if (!document) {
      throw new DomainError('VERSION_NOT_FOUND', `Signed document ${id} not found`);
    }
    return this.pdf.getPresignedUrl(document.storageKey);
  }

  private async toDto(document: SignedDocument): Promise<SignedDocumentDto> {
    return toSignedDocumentDto(document, await this.pdf.getPresignedUrl(document.storageKey));
  }
}
