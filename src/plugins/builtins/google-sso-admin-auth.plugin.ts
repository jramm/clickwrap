import { GoogleSsoAdminAuthStrategy } from '../../common/auth/strategies/google-sso.strategy';
import { definePlugin } from '../../plugin-sdk';

/** Google SSO admin auth (GOOGLE_CLIENT_ID + ADMIN_ALLOWED_DOMAIN, optional ADMIN_ALLOWED_EMAILS). */
export const googleSsoAdminAuthPlugin = definePlugin({
  kind: 'admin-auth',
  key: 'google-sso',
  create: () => new GoogleSsoAdminAuthStrategy(),
});
