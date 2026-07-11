import { Inject, Injectable, Optional } from '@nestjs/common';
import { DomainError } from '../common/errors.js';
import { assertDraftMutable } from '../domain/consent-rules.js';
import { EventRecorder } from '../events/event-recorder.js';
import { TOKENS } from '../persistence/tokens.js';
import type { AgreementDocumentRepo, AgreementVersionRepo, CustomerRepo } from '../domain/ports.js';
import type { AcceptanceMode, AgreementVersion } from '../domain/types.js';
import { AGREEMENTS_TOKENS, type PdfStorage, type PdfUpload } from './ports.js';
import { toVersionDto, type VersionDto } from './version.dto.js';
import { newId } from './ids.js';

export interface CreateDraftInput {
  documentId: string;
  versionLabel: string;
  changeSummary: string;
  acceptanceMode: AcceptanceMode;
  consentText?: string;
  objectionPeriodDays?: number;
  gracePeriodDays?: number;
  /** ACTIVE only: absolute calendar acceptance deadline (must be >= validFrom). */
  hardDeadlineAt?: Date;
  validFrom: Date;
  file: PdfUpload;
}

/** Only these metadata fields are editable on a DRAFT — never status/id/publish fields. */
export type PatchDraftInput = Partial<
  Pick<
    AgreementVersion,
    | 'versionLabel'
    | 'changeSummary'
    | 'acceptanceMode'
    | 'consentText'
    | 'objectionPeriodDays'
    | 'gracePeriodDays'
    | 'hardDeadlineAt'
    | 'validFrom'
  >
>;

/** Create/patch/delete DRAFT versions + detail view. */
@Injectable()
export class VersionService {
  constructor(
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(AGREEMENTS_TOKENS.PdfStorage) private readonly pdf: PdfStorage,
    @Optional() private readonly recorder?: EventRecorder,
  ) {}

  /**
   * How many customers publishing this version would roll out to: customers whose roles include
   * the document audience — exactly the set PublishService targets via `customers.findByRole`
   * (src/agreements/publish.service.ts). Read-only preview so an admin can gauge the impact of a
   * DRAFT before publishing (issue #27). Works for any status, but is meaningful for DRAFTs.
   */
  async getAffectedCustomerCount(versionId: string): Promise<{ audience: string; count: number }> {
    const version = await this.versions.findById(versionId);
    if (!version) {
      throw new DomainError('VERSION_NOT_FOUND');
    }
    const document = await this.documents.findById(version.documentId);
    if (!document) {
      throw new DomainError('INVALID_STATE', `Document ${version.documentId} does not exist`);
    }
    const targets = await this.customers.findByRole(document.audience);
    return { audience: document.audience, count: targets.length };
  }

  async createDraft(input: CreateDraftInput, adminUserId = 'admin'): Promise<AgreementVersion> {
    const document = await this.documents.findById(input.documentId);
    if (!document) {
      throw new DomainError('INVALID_STATE', `Document ${input.documentId} does not exist`);
    }
    const stored = await this.pdf.store(input.file);
    const saved = await this.versions.save({
      id: newId('v'),
      documentId: input.documentId,
      versionLabel: input.versionLabel,
      status: 'DRAFT',
      acceptanceMode: input.acceptanceMode,
      objectionPeriodDays: input.objectionPeriodDays,
      gracePeriodDays: input.gracePeriodDays,
      hardDeadlineAt: input.hardDeadlineAt,
      changeSummary: input.changeSummary,
      consentText: input.consentText,
      storageKey: stored.storageKey,
      fileName: stored.fileName,
      contentHash: stored.contentHash,
      fileSize: stored.fileSize,
      validFrom: input.validFrom,
    });
    // documentType/audience are resolved centrally by the EventRecorder from versionId.
    await this.recorder?.record({
      type: 'VERSION_DRAFT_CREATED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: adminUserId,
      versionId: saved.id,
      documentType: document.type,
      audience: document.audience,
      versionLabel: saved.versionLabel,
      summary: `Draft version ${saved.versionLabel} created`,
    });
    return saved;
  }

  /** Change metadata or replace the PDF — DRAFT only (assertDraftMutable → VERSION_IMMUTABLE). */
  async patchDraft(
    versionId: string,
    patch: PatchDraftInput,
    file?: PdfUpload,
    adminUserId = 'admin',
  ): Promise<AgreementVersion> {
    const version = await this.getVersion(versionId);
    assertDraftMutable(version);
    let updated: AgreementVersion = { ...version, ...patch };
    if (file) {
      const stored = await this.pdf.store(file);
      updated = {
        ...updated,
        storageKey: stored.storageKey,
        fileName: stored.fileName,
        contentHash: stored.contentHash,
        fileSize: stored.fileSize,
      };
    }
    const saved = await this.versions.save(updated);
    await this.recorder?.record({
      type: 'VERSION_UPDATED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: adminUserId,
      versionId: saved.id,
      versionLabel: saved.versionLabel,
      summary: `Draft version ${saved.versionLabel} updated`,
    });
    return saved;
  }

  /** Only DRAFTs may be deleted (assertDraftMutable → VERSION_IMMUTABLE). */
  async deleteDraft(versionId: string, adminUserId = 'admin'): Promise<void> {
    const version = await this.getVersion(versionId);
    assertDraftMutable(version);
    // Resolve the document BEFORE deleting so the deletion event can carry documentType/audience —
    // the EventRecorder can no longer denormalize them from versionId once the row is gone.
    const document = await this.documents.findById(version.documentId);
    await this.versions.delete(versionId);
    await this.recorder?.record({
      type: 'VERSION_DRAFT_DELETED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: adminUserId,
      versionId,
      documentType: document?.type,
      audience: document?.audience,
      versionLabel: version.versionLabel,
      summary: `Draft version ${version.versionLabel} deleted`,
    });
  }

  async getVersion(versionId: string): Promise<AgreementVersion> {
    const version = await this.versions.findById(versionId);
    if (!version) {
      throw new DomainError('VERSION_NOT_FOUND');
    }
    return version;
  }

  async listByDocument(documentId: string): Promise<AgreementVersion[]> {
    return this.versions.findByDocument(documentId);
  }

  /** Version history as DTOs — every entry carries a freshly resolved presigned pdfUrl. */
  async listDtosByDocument(documentId: string): Promise<VersionDto[]> {
    const versions = await this.versions.findByDocument(documentId);
    return Promise.all(versions.map((version) => this.toDto(version)));
  }

  /** Detail DTO (incl. presigned pdfUrl) for GET /admin/versions/:id. */
  async getVersionDto(versionId: string): Promise<VersionDto> {
    return this.toDto(await this.getVersion(versionId));
  }

  /** Time-limited download/preview URL of the version PDF. */
  async getPdfUrl(versionId: string): Promise<string> {
    const version = await this.getVersion(versionId);
    return this.pdf.getPresignedUrl(version.storageKey);
  }

  private async toDto(version: AgreementVersion): Promise<VersionDto> {
    return toVersionDto(version, await this.pdf.getPresignedUrl(version.storageKey));
  }
}
