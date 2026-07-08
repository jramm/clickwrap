import type { AdminAuthStrategy } from '../../plugin-sdk';
import { createPluginContext } from '../../plugins/registry/plugin-context';
import { getPluginRegistry } from '../../plugins/registry/plugin-registry';
import { selectedAdminAuthKeys } from '../../plugins/registry/selection';

/**
 * Builds the ORDERED active admin-auth strategy chain from env ADMIN_AUTH (default
 * `google-sso,static-token`) via the plugin registry. Unknown key → boot error listing the
 * available admin-auth plugins.
 */
export const createSelectedAdminAuthStrategies = (): AdminAuthStrategy[] => {
  const registry = getPluginRegistry();
  return selectedAdminAuthKeys().map((key) => {
    const plugin = registry.select('admin-auth', key, 'ADMIN_AUTH');
    return plugin.create(createPluginContext(plugin));
  });
};
