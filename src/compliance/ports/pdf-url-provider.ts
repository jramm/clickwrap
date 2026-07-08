/**
 * Slim port for pre-signed PDF URLs in the pending-agreements popup.
 * The real implementation (S3 pre-signed URL, 15 min TTL, analogous to GET /versions/{id}/pdf) is
 * wired up against the storage integration elsewhere; this module only defines the interface plus
 * a test fake.
 */
export interface PdfUrlProvider {
  getPresignedUrl(storageKey: string): Promise<string> | string;
}

export const PDF_URL_PROVIDER = Symbol('PdfUrlProvider');
