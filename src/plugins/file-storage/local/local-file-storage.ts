import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { DomainError } from '../../../common/errors.js';
import type { FileMeta, FileStorage, StoredFileRef } from '../../../plugin-sdk/index.js';

/**
 * Built-in `local` file storage: files on the backend server's own disk.
 *
 * Layout: `<dir>/<uuid>.pdf` (blob) + `<dir>/<uuid>.pdf.meta.json` ({ fileName }). Keys are ALWAYS
 * generated — the caller's fileName is display metadata only and never becomes part of a path.
 * Every storage key is validated against {@link LOCAL_STORAGE_KEY_PATTERN} BEFORE any filesystem
 * use, so traversal input can never reach the fs layer.
 *
 * "Presigned" semantics on local disk: {@link getPresignedUrl} returns
 * `/files/<key>?expires=<unix>&sig=<hmac>` where `sig` = HMAC-SHA256(secret, `<key>:<expires>`)
 * — same 15-minute TTL as the memory/S3 contract. The URL is served by the plugin's own
 * controller ({@link LocalFilesController}), mounted only while FILE_STORAGE=local.
 *
 * Operational note: single-node only (the disk is not replicated) — use object storage for
 * multi-node deployments. URL expiry uses real wall-clock time (like S3 presigning), not the
 * domain Clock: link lifetime is an infrastructure concern, not evidence.
 */

export interface LocalFileStorageOptions {
  dir: string;
  secret: string;
  /** Absolute URL prefix (PUBLIC_BASE_URL). Unset = relative URLs (same-origin deployments). */
  baseUrl?: string;
}

/** Only host-generated keys pass — a strict allowlist, not a blocklist for traversal characters. */
export const LOCAL_STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

const TTL_SECONDS = 900; // 15 minutes — matches GET /versions/:id/pdf semantics.

export class LocalFileStorage implements FileStorage {
  private readonly baseUrl: string;

  constructor(private readonly options: LocalFileStorageOptions) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    mkdirSync(options.dir, { recursive: true });
  }

  async store(buffer: Buffer, meta: FileMeta): Promise<StoredFileRef> {
    const storageKey = `${randomUUID()}.pdf`;
    await writeFile(join(this.options.dir, storageKey), buffer);
    await writeFile(join(this.options.dir, `${storageKey}.meta.json`), JSON.stringify({ fileName: meta.fileName }));
    return { storageKey };
  }

  async getPresignedUrl(storageKey: string): Promise<string> {
    if (!LOCAL_STORAGE_KEY_PATTERN.test(storageKey) || !existsSync(join(this.options.dir, storageKey))) {
      throw new DomainError('VERSION_NOT_FOUND', `No PDF at ${storageKey}`);
    }
    const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    return `${this.baseUrl}/files/${encodeURIComponent(storageKey)}?expires=${expires}&sig=${this.sign(storageKey, expires)}`;
  }

  /** Constant-time check of key pattern, expiry, and HMAC — used by the download controller. */
  verifyPresignedRequest(storageKey: string, expires: number, sig: string): boolean {
    if (!LOCAL_STORAGE_KEY_PATTERN.test(storageKey)) return false;
    if (!Number.isInteger(expires) || expires * 1000 < Date.now()) return false;
    const provided = Buffer.from(sig);
    const expected = Buffer.from(this.sign(storageKey, expires));
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }

  async retrieve(storageKey: string): Promise<Buffer> {
    if (!LOCAL_STORAGE_KEY_PATTERN.test(storageKey) || !existsSync(join(this.options.dir, storageKey))) {
      throw new DomainError('VERSION_NOT_FOUND', `No PDF at ${storageKey}`);
    }
    return readFile(join(this.options.dir, storageKey));
  }

  /** Opens a stored blob for streaming. Returns null for unknown (or non-generated) keys. */
  async open(storageKey: string): Promise<{ stream: Readable; fileName: string } | null> {
    if (!LOCAL_STORAGE_KEY_PATTERN.test(storageKey)) return null;
    const path = join(this.options.dir, storageKey);
    if (!existsSync(path)) return null;
    let fileName = storageKey;
    try {
      const meta = JSON.parse(await readFile(`${path}.meta.json`, 'utf8')) as { fileName?: unknown };
      if (typeof meta.fileName === 'string' && meta.fileName.length > 0) fileName = meta.fileName;
    } catch {
      // Missing/broken sidecar: fall back to the storage key as display name.
    }
    return { stream: createReadStream(path), fileName };
  }

  /** Test seam for crafting expired/foreign signatures — identical to the internal signing. */
  signForTesting(storageKey: string, expires: number): string {
    return this.sign(storageKey, expires);
  }

  private sign(storageKey: string, expires: number): string {
    return createHmac('sha256', this.options.secret).update(`${storageKey}:${expires}`).digest('hex');
  }
}
