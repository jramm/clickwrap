import type { CustomerSource, CustomerSourceSnapshot, ExternalCustomer } from '../../../plugin-sdk';

/** Static configuration of the Main-Portal adapter (read from env by the built-in plugin). */
export interface MainPortalConfig {
  /** Base URL of the Main Portal, e.g. https://app.metergrid.de (no trailing slash needed). */
  baseUrl: string;
  /** Service-API JWT (`system_api`) sent as `Authorization: Bearer <apiToken>`. Never logged. */
  apiToken: string;
  /** Path of the provider-groups endpoint, e.g. /system/v1/provider-groups. */
  providerGroupsPath: string;
}

/**
 * One MANAGER of a provider group. Maps to the Main Portal's `users.User` reached via
 * `ProviderGroupAccess(role=MANAGER)`. MANAGER is the top role — there is no OWNER role — so the
 * managers ARE the "owner(s)" who must accept the AGB.
 */
export interface MainPortalRawManager {
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/**
 * The subset of a Main-Portal provider group this adapter maps. Maps to the Django `ProviderGroup`
 * (id, name) plus its MANAGER users. Unknown fields are ignored.
 */
export interface MainPortalRawProviderGroup {
  id: number;
  name: string;
  managers: MainPortalRawManager[] | null;
}

/** Response envelope of the provider-groups endpoint (single page). */
export interface MainPortalProviderGroupsPage {
  items: MainPortalRawProviderGroup[];
  /**
   * Opaque link to the next page — an absolute URL, or a path/query relative to `baseUrl`. `null`
   * (or absent) when this is the last page.
   */
  next?: string | null;
}

/**
 * Pure mapping from a raw Main-Portal provider group to the provider-agnostic {@link ExternalCustomer}.
 * Exported and unit-tested in isolation.
 *
 * A provider group is a company; its MANAGERs are its people:
 *  - `externalRef` = the group id as a string (the reconciliation key).
 *  - `companyName` = the group name.
 *  - `contactEmails` = unique, trimmed, non-empty, CASE-INSENSITIVE dedupe of ALL manager e-mails
 *    (same approach as metergrid's `mapMetergridCustomer`; the first occurrence's casing is kept).
 *  - `firstName`/`lastName` = from the FIRST manager (`managers[0]`) if present, else undefined.
 *  - Missing/empty managers → `contactEmails` is `[]`.
 */
export const mapProviderGroup = (raw: MainPortalRawProviderGroup): ExternalCustomer => {
  const managers = raw.managers ?? [];
  // De-duplicate CASE-INSENSITIVELY, keeping the first occurrence's original casing.
  const contactEmails: string[] = [];
  const seen = new Set<string>();
  for (const manager of managers) {
    const email = manager.email?.trim();
    if (email === undefined || email.length === 0) {
      continue;
    }
    const key = email.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      contactEmails.push(email);
    }
  }
  const firstManager = managers[0];
  return {
    externalRef: String(raw.id),
    companyName: raw.name,
    firstName: firstManager?.firstName ?? undefined,
    lastName: firstManager?.lastName ?? undefined,
    contactEmails,
  };
};

/**
 * Main-Portal customer-source adapter. Fetches ALL non-merged provider groups (each with its MANAGER
 * users) from the Main Portal's service-API endpoint and maps them to {@link ExternalCustomer}s via
 * {@link mapProviderGroup}. Provider groups are the legal entities that use the Main Portal and must
 * accept the AGB, so this source is the source of truth for who must accept.
 *
 * Auth is a `system_api` bearer token (`Authorization: Bearer <apiToken>`). The token is never
 * included in any thrown error or log line. Pagination is followed via the response's `next` link
 * when present; otherwise a single call is made.
 *
 * Deletion is by absence: the snapshot carries no `deletedExternalRefs` — the host reconcile engine
 * soft-deletes source-managed customers missing from `customers` (a merged/removed group drops out).
 * See docs/integrations/mainportal-provider-groups.md for the endpoint contract.
 */
export class MainPortalCustomerSource implements CustomerSource {
  constructor(private readonly config: MainPortalConfig) {}

  async fetchAll(): Promise<CustomerSourceSnapshot> {
    if (this.config.apiToken.trim() === '') {
      throw new Error('mainportal customer source is missing its API token');
    }
    const groups: MainPortalRawProviderGroup[] = [];
    let url: string | null = this.resolveUrl(this.config.providerGroupsPath);
    // Follow `next` pagination; a page without `next` (or a single call) ends the loop.
    while (url !== null) {
      const page = await this.fetchPage(url);
      groups.push(...page.items);
      url = page.next !== undefined && page.next !== null ? this.resolveUrl(page.next) : null;
    }
    return { customers: groups.map(mapProviderGroup) };
  }

  private async fetchPage(url: string): Promise<MainPortalProviderGroupsPage> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${this.config.apiToken}`,
      },
    });
    if (!response.ok) {
      throw new Error(`mainportal provider-groups fetch failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as Partial<MainPortalProviderGroupsPage>;
    return { items: body.items ?? [], next: body.next ?? null };
  }

  /** Resolves a path or `next` link against the base URL; absolute URLs are used as-is. */
  private resolveUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }
}
