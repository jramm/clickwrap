import { definePlugin } from '../../plugin-sdk/index.js';
import { S3FileStorage } from '../file-storage/s3/s3-file-storage.js';

/**
 * Built-in `s3` file storage: version PDFs / signed-document archives in an S3 (or S3-compatible,
 * e.g. MinIO) bucket. S3 serves the presigned download URLs itself — no download controller.
 *
 * Env (read only while FILE_STORAGE=s3):
 *  - FILE_STORAGE_S3_BUCKET             (required) target bucket
 *  - FILE_STORAGE_S3_REGION             (required) AWS region
 *  - FILE_STORAGE_S3_ENDPOINT           (optional) S3-compatible endpoint (MinIO) → path-style
 *  - FILE_STORAGE_S3_ACCESS_KEY_ID      (optional) static credentials — omit BOTH for the
 *  - FILE_STORAGE_S3_SECRET_ACCESS_KEY  (optional)   SDK default credential chain (IAM role, …)
 *  - FILE_STORAGE_S3_KEY_PREFIX         (optional) key namespace (`<prefix>/<uuid>`)
 *  - FILE_STORAGE_S3_FORCE_PATH_STYLE   (optional) 'true'/'false' — overrides the endpoint default
 */
export const s3FileStoragePlugin = definePlugin({
  kind: 'file-storage',
  key: 's3',
  create: (ctx) => {
    const forcePathStyleRaw = ctx.env('FILE_STORAGE_S3_FORCE_PATH_STYLE');
    return new S3FileStorage({
      bucket: ctx.requireEnv('FILE_STORAGE_S3_BUCKET'),
      region: ctx.requireEnv('FILE_STORAGE_S3_REGION'),
      endpoint: ctx.env('FILE_STORAGE_S3_ENDPOINT'),
      accessKeyId: ctx.env('FILE_STORAGE_S3_ACCESS_KEY_ID'),
      secretAccessKey: ctx.env('FILE_STORAGE_S3_SECRET_ACCESS_KEY'),
      keyPrefix: ctx.env('FILE_STORAGE_S3_KEY_PREFIX'),
      forcePathStyle: forcePathStyleRaw === undefined ? undefined : forcePathStyleRaw.toLowerCase() === 'true',
    });
  },
});
