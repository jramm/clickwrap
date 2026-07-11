import { InMemoryFileStorage } from '../plugins/file-storage/memory/in-memory-file-storage.js';
import { FileStoragePdfAdapter } from './file-storage-pdf.adapter.js';

/**
 * In-memory PdfStorage for tests: the `memory` file-storage built-in behind the standard
 * {@link FileStoragePdfAdapter} (contentHash = SHA-256 over the buffer) — exactly what the app
 * wires when FILE_STORAGE=memory (the default).
 */
export class InMemoryPdfStorage extends FileStoragePdfAdapter {
  constructor() {
    super(new InMemoryFileStorage());
  }
}
