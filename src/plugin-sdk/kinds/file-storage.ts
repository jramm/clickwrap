/**
 * `file-storage` plugin kind: blob storage for version PDFs and acceptance evidence.
 *
 * A `FileStorage` persists opaque buffers under a storage key of its own choosing and hands out
 * time-limited download URLs. Content hashing (evidence integrity) is the HOST's concern — it is
 * computed over the buffer before/after storage and never trusted from a plugin.
 */

/** Metadata for a stored file. `fileName` is display metadata only — never derive paths from it. */
export interface FileMeta {
  fileName: string;
  contentType?: string;
}

/** Reference to a stored file. The key format is plugin-internal (S3 key, generated id, …). */
export interface StoredFileRef {
  storageKey: string;
}

export interface FileStorage {
  /** Persists the buffer and returns the plugin-generated storage key. */
  store(buffer: Buffer, meta: FileMeta): Promise<StoredFileRef>;
  /**
   * Time-limited, tamper-proof download URL for a previously stored file (target TTL: 15 minutes —
   * the semantics of an S3 presigned URL). Must reject unknown storage keys.
   */
  getPresignedUrl(storageKey: string): Promise<string>;
}
