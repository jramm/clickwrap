/**
 * `admin-auth` plugin kind: authentication methods for the admin surface.
 *
 * The host runs the ACTIVE strategies (env `ADMIN_AUTH`, ordered) against each admin request:
 * the first strategy returning a non-null {@link AdminIdentity} wins; when all return null the
 * request is rejected with 401.
 *
 * Contract per strategy:
 *  - return `null` when the request does not carry this strategy's credential (or the credential
 *    does not verify and another strategy may still claim it),
 *  - throw {@link AdminAuthError} to abort the chain with a specific 401 message (e.g. a verified
 *    user that fails a policy check — wrong domain, missing role),
 *  - return the identity on success.
 */

export interface AdminIdentity {
  userId: string;
  name?: string;
}

/**
 * Minimal request view a strategy authenticates against — deliberately not the express `Request`
 * type so the SDK stays dependency-free.
 */
export interface AdminAuthRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Frontend contract of GET /admin/auth/methods: tells a login page how to obtain a credential.
 *
 *  - `google`: render Google Identity Services with `params.clientId`; send the ID token as
 *    `Authorization: Bearer <idToken>`.
 *  - `token`: prompt for a static token; send it as `x-admin-token` (optional `x-admin-user`).
 *  - `oidc-redirect`: redirect to `params.authorizeUrl`; the fronting IdP/app hands an access
 *    token back which is sent as `Authorization: Bearer <accessToken>`.
 */
export type LoginMethodDescriptor =
  | { key: string; flow: 'google'; label: string; params: { clientId: string } }
  | { key: string; flow: 'token'; label: string; params: Record<string, never> }
  | { key: string; flow: 'oidc-redirect'; label: string; params: { authorizeUrl: string; clientId?: string } };

export interface AdminAuthStrategy {
  /** See the chain contract in the module docblock. Must never reject with a non-AdminAuthError for bad input. */
  authenticate(req: AdminAuthRequest): Promise<AdminIdentity | null>;
  /**
   * Descriptor for the login page, or `null` when the method should not be advertised (e.g. not
   * configured for interactive login while token verification still works).
   */
  describeLoginMethod(): LoginMethodDescriptor | null;
}

/**
 * Thrown by a strategy to abort the strategy chain with a specific message; the host maps it to a
 * 401 response carrying `message`.
 */
export class AdminAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminAuthError';
  }
}
