/**
 * `customer-source` plugin kind: the read side of the scheduled customer synchronisation.
 *
 * A `CustomerSource` exposes the current set of customers of an external system (a CRM, a billing
 * platform, …) as a provider-agnostic {@link CustomerSourceSnapshot}. The host's CustomerSyncService
 * fetches the snapshot on a schedule and reconciles it into clickwrap: create new customers, update
 * changed ones and soft-delete the ones that disappeared — always scoped to the customers tagged
 * with THIS source key (manually-created customers are never touched).
 *
 * The contract is deliberately HTTP-free: a concrete adapter (auth, endpoints, field mapping) is a
 * separate plugin. The built-in default `none` source returns an empty snapshot, which disables the
 * sync entirely.
 */

/**
 * One customer as seen by the external source. `externalRef` is the stable id the source assigns —
 * it is the reconciliation key (mapped to {@link Customer.externalRef}). The name/company fields are
 * optional (a source may not provide all of them); `contactEmails` is always an array (possibly empty).
 */
export interface ExternalCustomer {
  /** Stable id from the source — the reconciliation key. */
  externalRef: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  contactEmails: string[];
}

/**
 * A full point-in-time view of the source's customers.
 *
 * `customers` is the COMPLETE current set of ACTIVE source customers — anything source-managed in
 * clickwrap but absent here is treated as removed (soft-deleted). `deletedExternalRefs` lets a source
 * that can report explicit deletions do so; a ref listed there is soft-deleted even if it were still
 * present in `customers` (explicit deletion wins).
 */
export interface CustomerSourceSnapshot {
  /** Full current set of ACTIVE source customers. */
  customers: ExternalCustomer[];
  /** Optional explicit deletions (if a source provides them). */
  deletedExternalRefs?: string[];
}

/** The read side of a scheduled customer sync — a single "give me everything" call. */
export interface CustomerSource {
  fetchAll(): Promise<CustomerSourceSnapshot>;
}
