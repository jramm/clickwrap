import { StaticTokenAdminAuthStrategy } from '../../common/auth/strategies/static-token.strategy';
import { definePlugin } from '../../plugin-sdk';

/** Static-token admin auth (x-admin-token vs ADMIN_API_TOKEN; dev/CI fallback). */
export const staticTokenAdminAuthPlugin = definePlugin({
  kind: 'admin-auth',
  key: 'static-token',
  create: () => new StaticTokenAdminAuthStrategy(),
});
