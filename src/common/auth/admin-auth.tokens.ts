/**
 * DI token for the ORDERED list of active AdminAuthStrategy instances (env ADMIN_AUTH, resolved
 * through the plugin registry). Provided globally by AdminAuthModule; consumed by AdminGuard and
 * the /admin/auth/methods discovery endpoint.
 */
export const ADMIN_AUTH_STRATEGIES = Symbol('ADMIN_AUTH_STRATEGIES');
