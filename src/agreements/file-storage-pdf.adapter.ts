import { createHash } from 'node:crypto';
import type { FileStorage } from '../plugin-sdk/index.js';
import type { PdfStorage, PdfUpload, StoredPdf } from './ports.js';

/**
 * Bridges the module-local {@link PdfStorage} port onto the registry-selected SDK
 * {@link FileStorage} plugin. The evidence-relevant metadata (`contentHash` = SHA-256 over the
 * buffer, fileName, fileSize) is computed HERE — a storage plugin is never trusted with it.
 */
export class FileStoragePdfAdapter implements PdfStorage {
  constructor(private readonly storage: FileStorage) {}

  async store({ buffer, fileName }: PdfUpload): Promise<StoredPdf> {
    const { storageKey } = await this.storage.store(buffer, { fileName, contentType: 'application/pdf' });
    return {
      storageKey,
      contentHash: `sha256:${createHash('sha256').update(buffer).digest('hex')}`,
      fileName,
      fileSize: buffer.length,
    };
  }

  getPresignedUrl(storageKey: string): Promise<string> {
    return this.storage.getPresignedUrl(storageKey);
  }
}
