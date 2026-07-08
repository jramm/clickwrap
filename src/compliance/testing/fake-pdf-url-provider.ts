/** Test fake: deterministic presigned URL without real storage access (import only from *.spec.ts). */
import type { PdfUrlProvider } from '../ports/pdf-url-provider';

export class FakePdfUrlProvider implements PdfUrlProvider {
  getPresignedUrl(storageKey: string): string {
    return `https://fake-storage.test/presigned/${encodeURIComponent(storageKey)}?expires=900`;
  }
}
