import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DomainError } from '../../../common/errors.js';
import type { FileMeta, FileStorage, StoredFileRef } from '../../../plugin-sdk/index.js';

/**
 * Built-in `s3` file storage: blobs in an S3 (or S3-compatible, e.g. MinIO) bucket.
 *
 * Keys are ALWAYS generated (`<keyPrefix>/<uuid>`) — the caller's fileName is display metadata
 * only and never becomes part of a key. `store` = PutObject, `retrieve` = GetObject,
 * `getPresignedUrl` = getSignedUrl(GetObject, { expiresIn: 900 }) — the 15-minute-TTL semantics of
 * the storage contract. S3 serves the presigned URL itself, so no download controller (`module()`)
 * is needed.
 *
 * Credentials: static `accessKeyId`/`secretAccessKey` when both are given, otherwise the AWS SDK's
 * default credential chain (IAM role / instance profile / env). `endpoint` targets an
 * S3-compatible service and implies path-style addressing unless `forcePathStyle` overrides it.
 */

export interface S3FileStorageOptions {
  bucket: string;
  region: string;
  /** S3-compatible endpoint (e.g. MinIO). When set, path-style addressing is used by default. */
  endpoint?: string;
  /** Static credentials. Omit BOTH to use the SDK's default credential chain (IAM role, …). */
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Optional key namespace: keys become `<keyPrefix>/<uuid>`. */
  keyPrefix?: string;
  /** Force path-style addressing. Defaults to true when `endpoint` is set, false otherwise. */
  forcePathStyle?: boolean;
}

const TTL_SECONDS = 900; // 15 minutes — matches the storage contract / GET /versions/:id/pdf.

/** True when an S3 SDK error signals a missing object (NoSuchKey / NotFound / 404). */
const isNotFound = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'NoSuchKey' || name === 'NotFound') return true;
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return status === 404;
};

export class S3FileStorage implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;

  constructor(options: S3FileStorageOptions) {
    this.bucket = options.bucket;
    this.keyPrefix = (options.keyPrefix ?? '').replace(/^\/+|\/+$/g, '');
    const config: S3ClientConfig = {
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? options.endpoint !== undefined,
    };
    if (options.endpoint !== undefined) {
      config.endpoint = options.endpoint;
    }
    if (options.accessKeyId !== undefined && options.secretAccessKey !== undefined) {
      config.credentials = { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey };
    }
    this.client = new S3Client(config);
  }

  async store(buffer: Buffer, meta: FileMeta): Promise<StoredFileRef> {
    const storageKey = this.keyPrefix ? `${this.keyPrefix}/${randomUUID()}` : randomUUID();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, Body: buffer, ContentType: meta.contentType }),
    );
    return { storageKey };
  }

  async getPresignedUrl(storageKey: string): Promise<string> {
    // Reject unknown keys up-front so callers get a clear DomainError, not a URL that 404s later.
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    } catch (error) {
      if (isNotFound(error)) {
        throw new DomainError('VERSION_NOT_FOUND', `No PDF at ${storageKey}`);
      }
      throw error;
    }
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }), {
      expiresIn: TTL_SECONDS,
    });
  }

  async retrieve(storageKey: string): Promise<Buffer> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));
      if (response.Body === undefined) {
        throw new DomainError('VERSION_NOT_FOUND', `No PDF at ${storageKey}`);
      }
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) {
        throw new DomainError('VERSION_NOT_FOUND', `No PDF at ${storageKey}`);
      }
      throw error;
    }
  }
}
