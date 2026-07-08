import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../common/errors';
import type { FileMeta, FileStorage, StoredFileRef } from '../../../plugin-sdk';

/**
 * Built-in `memory` file storage (default): keeps the buffers in memory — nothing survives a
 * restart (dev/demo/tests). Presigned URLs carry `expires=900` = the 15-minute-TTL semantics of
 * the storage contract.
 */
export class InMemoryFileStorage implements FileStorage {
  private readonly blobs = new Map<string, Buffer>();

  async store(buffer: Buffer, meta: FileMeta): Promise<StoredFileRef> {
    const storageKey = `s3://clickwrap-documents/${randomUUID()}/${meta.fileName}`;
    this.blobs.set(storageKey, Buffer.from(buffer));
    return { storageKey };
  }

  async getPresignedUrl(storageKey: string): Promise<string> {
    if (!this.blobs.has(storageKey)) {
      throw new DomainError('VERSION_NOT_FOUND', `No PDF at ${storageKey}`);
    }
    return `https://presigned.local/${encodeURIComponent(storageKey)}?expires=900`;
  }
}
