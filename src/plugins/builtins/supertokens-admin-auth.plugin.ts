import { SupertokensAdminAuthStrategy } from '../../common/auth/strategies/supertokens.strategy';
import { definePlugin } from '../../plugin-sdk';

/**
 * SuperTokens session verification (JWKS-based, no supertokens-node SDK) with a configurable
 * required role (ADMIN_SUPERTOKENS_ROLE, default "admin"). SUPERTOKENS_JWKS_URL is required while
 * active; SUPERTOKENS_LOGIN_URL (optional) advertises the oidc-redirect login method.
 */
export const supertokensAdminAuthPlugin = definePlugin({
  kind: 'admin-auth',
  key: 'supertokens',
  create: (ctx) => new SupertokensAdminAuthStrategy({ jwksUrl: ctx.requireEnv('SUPERTOKENS_JWKS_URL') }),
});
