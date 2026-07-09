import type { CustomerSource, CustomerSourceSnapshot, ExternalCustomer } from '../../../plugin-sdk';

/** Static configuration of the metergrid adapter (read from env by the built-in plugin). */
export interface MetergridConfig {
  /** Base URL of the metergrid partner API, e.g. https://api-partners.metergrid.de (no trailing slash needed). */
  baseUrl: string;
  username: string;
  password: string;
}

/** The subset of a metergrid customer record this adapter maps. Unknown fields are ignored. */
export interface MetergridRawCustomer {
  id: number;
  companyName: string | null;
  email: string | null;
  contactPerson: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
}

const SIGNIN_PATH = '/auth/signin';
// One call returns the full active snapshot (~9k). Pagination via `params` is optional/future.
const CUSTOMERS_PATH = '/api/configurator/customers?skip_total_items=true';
// SuperTokens cookie-mode session cookies handed back on the customers request.
const SESSION_COOKIE_NAMES = ['sAccessToken', 'sRefreshToken'] as const;

/** Minimal shape needed to read Set-Cookie from a fetch Response (undici Headers satisfy it). */
interface SetCookieCapableHeaders {
  getSetCookie?(): string[];
  get(name: string): string | null;
}

/**
 * Pure mapping from a raw metergrid customer to the provider-agnostic {@link ExternalCustomer}.
 * Exported and unit-tested in isolation. Guards a missing/null `contactPerson`.
 */
export const mapMetergridCustomer = (raw: MetergridRawCustomer): ExternalCustomer => {
  const emails = [raw.contactPerson?.email, raw.email]
    .map((email) => email?.trim())
    .filter((email): email is string => email !== undefined && email.length > 0);
  return {
    externalRef: String(raw.id),
    companyName: raw.companyName ?? undefined,
    firstName: raw.contactPerson?.firstName ?? undefined,
    lastName: raw.contactPerson?.lastName ?? undefined,
    contactEmails: [...new Set(emails)],
  };
};

/**
 * Extracts the SuperTokens session cookies from a sign-in response and re-serialises them as a
 * `Cookie` request header (only the `name=value` part, attributes like Path/HttpOnly dropped).
 * Prefers the undici `Headers.getSetCookie()`; falls back to splitting a single `set-cookie` header.
 */
const extractSessionCookie = (headers: SetCookieCapableHeaders): string => {
  const setCookies =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  const pairs: string[] = [];
  for (const name of SESSION_COOKIE_NAMES) {
    const entry = setCookies.find((cookie) => cookie.trimStart().startsWith(`${name}=`));
    if (entry !== undefined) {
      pairs.push(entry.split(';', 1)[0].trim());
    }
  }
  return pairs.join('; ');
};

/**
 * metergrid customer-source adapter. Authenticates against SuperTokens in cookie mode, then fetches
 * the full active customer snapshot in a single call and maps it via {@link mapMetergridCustomer}.
 *
 * The password is never included in any thrown error or log line. Deletion is by absence: the
 * snapshot carries no `deletedExternalRefs` — the host reconcile engine soft-deletes source-managed
 * customers that are missing from `customers`.
 */
export class MetergridCustomerSource implements CustomerSource {
  constructor(private readonly config: MetergridConfig) {}

  async fetchAll(): Promise<CustomerSourceSnapshot> {
    const cookie = await this.signIn();
    const items = await this.fetchCustomers(cookie);
    return { customers: items.map(mapMetergridCustomer) };
  }

  /** SuperTokens emailpassword sign-in (cookie mode) → serialised session `Cookie` header. */
  private async signIn(): Promise<string> {
    const response = await fetch(`${this.base()}${SIGNIN_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        rid: 'emailpassword',
        'st-auth-mode': 'cookie',
      },
      body: JSON.stringify({
        formFields: [
          { id: 'email', value: this.config.username },
          { id: 'password', value: this.config.password },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`metergrid sign-in failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { status?: string };
    if (body.status !== 'OK') {
      throw new Error(`metergrid sign-in failed: status "${String(body.status)}"`);
    }
    const cookie = extractSessionCookie(response.headers);
    if (cookie === '') {
      throw new Error('metergrid sign-in succeeded but returned no session cookies');
    }
    return cookie;
  }

  private async fetchCustomers(cookie: string): Promise<MetergridRawCustomer[]> {
    const response = await fetch(`${this.base()}${CUSTOMERS_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({ include: { address: true, contactPerson: true }, filter: {}, params: {} }),
    });
    if (!response.ok) {
      throw new Error(`metergrid customer fetch failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { items?: MetergridRawCustomer[] };
    return body.items ?? [];
  }

  private base(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }
}
