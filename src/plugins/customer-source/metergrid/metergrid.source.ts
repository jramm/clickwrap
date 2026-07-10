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
  /**
   * HubSpot Company ID (the deal's `provider`-type company). This is the cross-system join key
   * shared with HubSpot and the main portal, so it is preferred as the clickwrap externalRef.
   * Nullable in the source; falls back to the game-internal `id` when absent.
   */
  crmId: string | null;
  companyName: string | null;
  email: string | null;
  contactPerson: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
}

/**
 * The subset of a metergrid project record this adapter reads to derive won-deal customers. The
 * project row already carries `customerId`, so the (heavier) nested `customer` is NOT requested.
 * `tenantElectricity.status` is the deal stage that determines whether the customer's deal is won.
 */
export interface MetergridRawProject {
  id: number;
  customerId: number | null;
  tenantElectricity: { status: string } | null;
}

/**
 * Project (`tenantElectricity.status`) stages that mark a deal as WON — i.e. the customer is a real
 * customer bound by AGB + AVV (Game-backend semantics). A customer counts as won if ANY of its
 * projects sits in one of these stages. Everything else is a prospect/partner and is excluded:
 * LOST, ON_HOLD, DRAFT, QUALIFICATION, OFFER_CREATION, WAITING_FOR_DECISION, UNKNOWN,
 * PROJECT_PLANNING_ON_HOLD, PROJECT_PLANNING_LOST, PROJECT_PLANNING_CANCELLED.
 */
const WON_STAGES: ReadonlySet<string> = new Set([
  'WON',
  'PROJECT_PLANNING_ASSIGN_PROJECT_MANAGER',
  'PROJECT_PLANNING_PREPARATION',
  'PROJECT_PLANNING_EXECUTION',
  'PROJECT_PLANNING_COMPLETION',
  'PROJECT_PLANNING_FINAL_QUALITY_GATE',
  'PROJECT_PLANNING_PRODUCTION_OPERATION',
]);

const SIGNIN_PATH = '/auth/signin';
// One call returns the full snapshot (~9k). Pagination via `?limit=&offset=` can be added if needed.
const PROJECTS_PATH = '/api/configurator/projects?skip_total_items=true';
const CUSTOMERS_PATH = '/api/configurator/customers?skip_total_items=true';
// SuperTokens cookie-mode session cookies handed back on the projects/customers requests.
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
  // De-duplicate CASE-INSENSITIVELY (metergrid data sometimes carries the same address twice with
  // different casing, e.g. "ahaeussermann@gmx.de" and "Ahaeussermann@gmx.de"). Keep the first
  // occurrence's original casing; contactPerson.email wins over the customer-level email.
  const contactEmails: string[] = [];
  const seen = new Set<string>();
  for (const email of emails) {
    const key = email.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      contactEmails.push(email);
    }
  }
  return {
    // Prefer the HubSpot Company ID (cross-system key); fall back to the game id if it is missing.
    externalRef: raw.crmId?.trim() ? raw.crmId.trim() : String(raw.id),
    companyName: raw.companyName ?? undefined,
    firstName: raw.contactPerson?.firstName ?? undefined,
    lastName: raw.contactPerson?.lastName ?? undefined,
    contactEmails,
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
 * the projects and customers and returns ONLY WON-DEAL customers, mapped via
 * {@link mapMetergridCustomer}.
 *
 * "Won" follows the Game-backend semantics: a metergrid Customer is a prospect until one of its
 * Projects reaches a {@link WON_STAGES} `tenantElectricity.status`; then it is a real customer bound
 * by AGB + AVV. Partners (Company) are out of scope. The derivation is a join: collect the customer
 * ids referenced by won-stage projects (`wonCustomerIds`), then keep only the customers in that set.
 *
 * The password is never included in any thrown error or log line. Deletion is by absence: the
 * snapshot carries no `deletedExternalRefs` — the host reconcile engine soft-deletes source-managed
 * customers that are missing from `customers` (now meaning "no longer a won customer OR removed").
 */
export class MetergridCustomerSource implements CustomerSource {
  constructor(private readonly config: MetergridConfig) {}

  async fetchAll(): Promise<CustomerSourceSnapshot> {
    const cookie = await this.signIn();
    const projects = await this.fetchProjects(cookie);
    const customers = await this.fetchCustomers(cookie);

    const wonCustomerIds = new Set<number>();
    for (const project of projects) {
      const status = project.tenantElectricity?.status;
      if (project.customerId !== null && status !== undefined && WON_STAGES.has(status)) {
        wonCustomerIds.add(project.customerId);
      }
    }

    const wonCustomers = customers.filter((customer) => wonCustomerIds.has(customer.id));
    return { customers: wonCustomers.map(mapMetergridCustomer) };
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

  private async fetchProjects(cookie: string): Promise<MetergridRawProject[]> {
    const response = await fetch(`${this.base()}${PROJECTS_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: cookie,
      },
      // Only `tenantElectricity` is needed; the row already has `customerId`, so `customer` is omitted.
      body: JSON.stringify({ include: { tenantElectricity: true }, filter: {}, params: {} }),
    });
    if (!response.ok) {
      throw new Error(`metergrid project fetch failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { items?: MetergridRawProject[] };
    return body.items ?? [];
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
