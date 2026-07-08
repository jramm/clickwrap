import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors';
import { assertDraftMutable } from '../domain/consent-rules';
import { TOKENS } from '../persistence/tokens';
import type { AgreementDocumentRepo, AgreementVersionRepo } from '../domain/ports';
import type { AcceptanceMode, AgreementVersion } from '../domain/types';
import { AGREEMENTS_TOKENS, type PdfStorage, type PdfUpload } from './ports';
import { toVersionDto, type VersionDto } from './version.dto';
import { newId } from './ids';

export interface CreateDraftInput {
  documentId: string;
  versionLabel: string;
  changeSummary: string;
  acceptanceMode: AcceptanceMode;
  consentText?: string;
  objectionPeriodDays?: number;
  gracePeriodDays?: number;
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
    | 'validFrom'
  >
>;

/** Create/patch/delete DRAFT versions + detail view. */
@Injectable()
export class VersionService {
  constructor(
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(AGREEMENTS_TOKENS.PdfStorage) private readonly pdf: PdfStorage,
  ) {}

  async createDraft(input: CreateDraftInput): Promise<AgreementVersion> {
    const document = await this.documents.findById(input.documentId);
    if (!document) {
      throw new DomainError('INVALID_STATE', `Document ${input.documentId} does not exist`);
    }
    const stored = await this.pdf.store(input.file);
    return this.versions.save({
      id: newId('v'),
      documentId: input.documentId,
      versionLabel: input.versionLabel,
      status: 'DRAFT',
      acceptanceMode: input.acceptanceMode,
      objectionPeriodDays: input.objectionPeriodDays,
      gracePeriodDays: input.gracePeriodDays,
      changeSummary: input.changeSummary,
      consentText: input.consentText,
      storageKey: stored.storageKey,
      fileName: stored.fileName,
      contentHash: stored.contentHash,
      fileSize: stored.fileSize,
      validFrom: input.validFrom,
    });
  }

  /** Change metadata or replace the PDF — DRAFT only (assertDraftMutable → VERSION_IMMUTABLE). */
  async patchDraft(versionId: string, patch: PatchDraftInput, file?: PdfUpload): Promise<AgreementVersion> {
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
    return this.versions.save(updated);
  }

  /** Only DRAFTs may be deleted (assertDraftMutable → VERSION_IMMUTABLE). */
  async deleteDraft(versionId: string): Promise<void> {
    const version = await this.getVersion(versionId);
    assertDraftMutable(version);
    await this.versions.delete(versionId);
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
