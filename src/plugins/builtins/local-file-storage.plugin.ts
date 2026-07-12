import { Module } from '@nestjs/common';
import { definePlugin, PLUGIN_DI_TOKENS } from '../../plugin-sdk/index.js';
import { LocalFileStorage } from '../file-storage/local/local-file-storage.js';
import { LocalFilesController } from '../file-storage/local/local-files.controller.js';

/** Carrier class for the plugin module fragment (its controllers/providers are merged by the host). */
@Module({})
class LocalFileStorageModule {}

/**
 * Local-disk file storage: blobs under FILE_STORAGE_LOCAL_DIR, presigned-URL semantics via
 * HMAC-signed `/files/…` links (FILE_STORAGE_LOCAL_SECRET) served by the plugin's own controller —
 * mounted ONLY while FILE_STORAGE=local. Single-node deployments only (disk is not replicated).
 */
export const localFileStoragePlugin = definePlugin({
  kind: 'file-storage',
  key: 'local',
  create: (ctx) => {
    const baseUrl = ctx.env('PUBLIC_BASE_URL');
    if (baseUrl === undefined) {
      ctx.logger.warn(
        'PUBLIC_BASE_URL is not set — /files links are RELATIVE and only work when the admin UI/portal ' +
          'is served from the same origin as this backend.',
      );
    }
    return new LocalFileStorage({
      // Directory is just a path (created recursively) — default it so local storage needs no config;
      // the HMAC secret stays required (a predictable signing key would let anyone forge /files URLs).
      dir: ctx.env('FILE_STORAGE_LOCAL_DIR') ?? './data/files',
      secret: ctx.requireEnv('FILE_STORAGE_LOCAL_SECRET'),
      baseUrl,
    });
  },
  module: () => ({
    module: LocalFileStorageModule,
    controllers: [LocalFilesController],
    // The controller needs the ACTIVE storage instance — alias the host-bound token to the class.
    providers: [{ provide: LocalFileStorage, useExisting: PLUGIN_DI_TOKENS.FileStorage }],
  }),
});
