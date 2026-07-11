/**
 * Public shape of a {@link SignedDocument} for BOTH API surfaces (admin + integration).
 *
 * `pdfUrl` is always resolved via PdfStorage.getPresignedUrl; the internal `storageKey` is
 * NEVER exposed.
 */
import type { SignedDocument } from '../domain/types.js';

export interface SignedDocumentDto {
  id: string;
  customerId: string;
  documentTypeKey: string;
  audience?: string;
  fileName: string;
  contentHash: string;
  fileSize: number;
  signedAt: Date;
  signerName?: string;
  reference?: string;
  note?: string;
  uploadedBy: string;
  uploadedAt: Date;
  /** Time-limited (presigned) download URL of the signed PDF. */
  pdfUrl: string;
}

/** Maps a domain signed document + its resolved presigned URL to the public DTO (drops storageKey). */
export const toSignedDocumentDto = (document: SignedDocument, pdfUrl: string): SignedDocumentDto => ({
  id: document.id,
  customerId: document.customerId,
  documentTypeKey: document.documentTypeKey,
  audience: document.audience,
  fileName: document.fileName,
  contentHash: document.contentHash,
  fileSize: document.fileSize,
  signedAt: document.signedAt,
  signerName: document.signerName,
  reference: document.reference,
  note: document.note,
  uploadedBy: document.uploadedBy,
  uploadedAt: document.uploadedAt,
  pdfUrl,
});
