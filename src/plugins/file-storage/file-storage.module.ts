/**
 * Pluggable file-storage module.
 *
 * `FileStorageModule.forRoot()` selects the storage plugin from env FILE_STORAGE (default memory)
 * via the plugin registry and binds its `create(ctx)` result to PLUGIN_DI_TOKENS.FileStorage
 * (global). Unknown key = boot error listing the available keys.
 *
 * A plugin's optional `module()` is mounted ONLY while that plugin is active — the `local`
 * built-in uses this for its HMAC-guarded GET /files/:storageKey download controller (same gating
 * pattern as the Postmark webhook).
 *
 * Consumers (agreements PdfStorage port, compliance PdfUrlProvider) bind onto the exported token —
 * see agreements.module.
 */
import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { PLUGIN_DI_TOKENS } from '../../plugin-sdk/index.js';
import { createPluginContext } from '../registry/plugin-context.js';
import { getPluginRegistry } from '../registry/plugin-registry.js';
import { selectedFileStorageKey } from '../registry/selection.js';

@Module({})
export class FileStorageModule {
  static forRoot(): DynamicModule {
    const plugin = getPluginRegistry().select('file-storage', selectedFileStorageKey(), 'FILE_STORAGE');
    const fragment = plugin.module?.();
    return {
      module: FileStorageModule,
      global: true,
      imports: fragment?.imports ?? [],
      controllers: fragment?.controllers ?? [],
      providers: [
        { provide: PLUGIN_DI_TOKENS.FileStorage, useFactory: () => plugin.create(createPluginContext(plugin)) },
        ...((fragment?.providers ?? []) as Provider[]),
      ],
      exports: [PLUGIN_DI_TOKENS.FileStorage],
    };
  }
}
