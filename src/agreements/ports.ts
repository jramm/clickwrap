/**
 * Module-local ports of the agreements module (no Nest/Prisma here):
 *  - PdfStorage: S3 storage of version PDFs and manual-acceptance evidence (contentHash = SHA-256
 *    over the buffer). The integration layer wires real S3; tests use the in-memory impl.
 *  - RolloutNotifier: e-mail delivery on publish/reminder. The integration layer wires real
 *    Postmark; tests use the spy.
 */
import type { AgreementVersion, Customer, CustomerVersionState } from '../domain/types.js';

export interface PdfUpload {
  buffer: Buffer;
  fileName: string;
}

export interface StoredPdf {
  storageKey: string;
  /** `sha256:<hex>` over the PDF buffer — ties the evidence to the exact content. */
  contentHash: string;
  fileName: string;
  fileSize: number;
}

export interface PdfStorage {
  store(upload: PdfUpload): Promise<StoredPdf>;
  /** Time-limited download URL (preview/download). */
  getPresignedUrl(storageKey: string): Promise<string>;
}

export interface RolloutNotifier {
  /** On publish: "new version published" to the affected customer. */
  notifyVersionPublished(customer: Customer, version: AgreementVersion): Promise<void>;
  /** Admin action "send reminder again". */
  remind(customer: Customer, state: CustomerVersionState, version: AgreementVersion): Promise<void>;
}

/** DI tokens of the module-local ports (wired by the integration layer or tests). */
export const AGREEMENTS_TOKENS = {
  PdfStorage: Symbol('PdfStorage'),
  RolloutNotifier: Symbol('RolloutNotifier'),
} as const;
