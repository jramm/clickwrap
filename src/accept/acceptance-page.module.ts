/**
 * Pluggable acceptance-page renderer.
 *
 * `AcceptancePageModule.forRoot()` selects the acceptance-page plugin from env ACCEPTANCE_PAGE
 * (default `default` → the current server-rendered page) via the plugin REGISTRY — the built-in
 * `default` renderer and installed third-party packages (e.g. an org's mg-ui renderer) go through
 * the exact same mechanism as the e-mail provider (see docs/PLUGINS.md). The selected plugin's
 * `create(ctx)` result is bound to PLUGIN_DI_TOKENS.AcceptancePageRenderer; an unknown key is a boot
 * error listing the available keys.
 *
 * Imported by AcceptModule so AcceptPageController can inject the renderer. The token flow, rate
 * limiting and the acceptance write stay in the controller/service — a renderer only produces HTML.
 * A plugin's optional `module()` (controllers/jobs for serving its own assets) is mounted ONLY
 * while that plugin is active, mirroring EmailModule/FileStorageModule.
 */
import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { PLUGIN_DI_TOKENS, type AcceptancePageRenderer } from '../plugin-sdk';
import { createPluginContext } from '../plugins/registry/plugin-context';
import { getPluginRegistry } from '../plugins/registry/plugin-registry';
import { selectedAcceptancePageKey } from '../plugins/registry/selection';

/** Reads and validates ACCEPTANCE_PAGE against the registry (default: default). */
export const acceptancePage = (): string => {
  const key = selectedAcceptancePageKey();
  getPluginRegistry().select('acceptance-page', key, 'ACCEPTANCE_PAGE');
  return key;
};

/** Builds the selected AcceptancePageRenderer via the registry plugin's create(ctx). */
export const acceptancePageRendererFactory = (): AcceptancePageRenderer => {
  const plugin = getPluginRegistry().select('acceptance-page', selectedAcceptancePageKey(), 'ACCEPTANCE_PAGE');
  return plugin.create(createPluginContext(plugin));
};

@Module({})
export class AcceptancePageModule {
  static forRoot(): DynamicModule {
    const plugin = getPluginRegistry().select('acceptance-page', selectedAcceptancePageKey(), 'ACCEPTANCE_PAGE');
    const fragment = plugin.module?.();
    return {
      module: AcceptancePageModule,
      imports: fragment?.imports ?? [],
      controllers: fragment?.controllers ?? [],
      providers: [
        { provide: PLUGIN_DI_TOKENS.AcceptancePageRenderer, useFactory: acceptancePageRendererFactory },
        ...((fragment?.providers ?? []) as Provider[]),
      ],
      exports: [PLUGIN_DI_TOKENS.AcceptancePageRenderer],
    };
  }
}
