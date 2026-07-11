/**
 * Public shape of an AgreementVersion for the admin API. Used by BOTH the versions list
 * (GET /admin/documents/:id/versions) and the detail (GET /admin/versions/:id), and embedded as
 * the current version in GET /admin/documents.
 *
 * `pdfUrl` is always resolved via PdfStorage.getPresignedUrl; the internal `storageKey` is
 * NEVER exposed.
 */
import type { AcceptanceMode, AgreementVersion, VersionStatus } from '../domain/types.js';

export interface VersionDto {
  id: string;
  documentId: string;
  versionLabel: string;
  status: VersionStatus;
  acceptanceMode: AcceptanceMode;
  changeSummary: string;
  consentText?: string;
  objectionPeriodDays?: number;
  gracePeriodDays?: number;
  /** ACTIVE only: absolute calendar acceptance deadline (every customer must accept by then). */
  hardDeadlineAt?: Date;
  validFrom: Date;
  publishedAt?: Date;
  contentHash: string;
  fileName: string;
  /** Time-limited (presigned) download/preview URL of the version PDF. */
  pdfUrl: string;
}

/** Maps a domain version + its resolved presigned URL to the public DTO (drops storageKey/fileSize/publishedBy). */
export const toVersionDto = (version: AgreementVersion, pdfUrl: string): VersionDto => ({
  id: version.id,
  documentId: version.documentId,
  versionLabel: version.versionLabel,
  status: version.status,
  acceptanceMode: version.acceptanceMode,
  changeSummary: version.changeSummary,
  consentText: version.consentText,
  objectionPeriodDays: version.objectionPeriodDays,
  gracePeriodDays: version.gracePeriodDays,
  hardDeadlineAt: version.hardDeadlineAt,
  validFrom: version.validFrom,
  publishedAt: version.publishedAt,
  contentHash: version.contentHash,
  fileName: version.fileName,
  pdfUrl,
});
