/**
 * `acceptance-page` plugin kind: the customer-facing hosted acceptance page renderer.
 *
 * The host resolves the capability token, records the access proof and assembles a provider-agnostic
 * {@link AcceptancePageView}; the active `acceptance-page` plugin turns that view-model into the HTML
 * the browser receives (`GET /accept/:token`), and renders the uniform not-found page for
 * unknown/expired/revoked tokens. The token flow, rate limiting and the acceptance write
 * (`POST /accept/:token/acceptances`) stay entirely server-side — a renderer only produces HTML.
 *
 * This is a pure **HTML-renderer contract**: no redirect, no new JSON API. An org that wants its own
 * UI ships an `acceptance-page` plugin whose `renderAcceptPage` returns a shell that embeds the
 * {@link AcceptancePageView} as JSON, loads its own client assets and POSTs to the existing
 * acceptance endpoint (see docs/PLUGINS.md). The built-in default `default` renderer is the current
 * server-rendered page. This module is the SINGLE source of truth for the view-model types — the
 * host (`src/accept/`) imports them from here.
 */

/** Language of the rendered page — `?lang=` wins, then Accept-Language, default `en`. */
export type AcceptancePageLang = 'en' | 'de';

/**
 * How an agreement is accepted: `ACTIVE` needs explicit consent (checkbox + verbatim consent text);
 * `PASSIVE` takes effect automatically unless objected to, but may be opted into early.
 */
export type AcceptancePageItemMode = 'ACTIVE' | 'PASSIVE';

/** One pending document shown on the acceptance page. */
export interface AcceptancePageItem {
  versionId: string;
  documentName: string;
  documentType: string;
  audience: string;
  versionLabel: string;
  changeSummary: string;
  /** Presigned URL (15-minute TTL, same source as the portal popup). */
  pdfUrl: string;
  mode: AcceptancePageItemMode;
  /** ACTIVE only — the exact checkbox text; the acceptance POST must echo it verbatim. */
  consentText?: string;
  deadlineAt?: Date;
  blocking: boolean;
  /** true = published but not yet in effect — the card shows "valid from {date}". */
  upcoming: boolean;
  /** Date from which the revision applies. */
  validFrom: Date;
}

/** The complete view-model a renderer receives for a resolved acceptance link. */
export interface AcceptancePageView {
  linkId: string;
  /** Derived display name (companyName if set, else the contact person's name) — page heading. */
  customerName: string;
  /**
   * Prefill values for the self-declared signer block (all remain editable — the recorded
   * identity is still self-declared, these only pre-fill the inputs for convenience).
   */
  firstName: string;
  lastName: string;
  /** Company/organisation shown as context when present ('' otherwise). */
  companyName: string;
  /** Suggested signer e-mail — the customer's first known contact e-mail ('' when none). */
  suggestedEmail: string;
  items: AcceptancePageItem[];
}

/**
 * The stable contract an `acceptance-page` plugin implements. Both methods return a complete HTML
 * document (the host sends it as `text/html`). They must be pure — no I/O, no token handling.
 */
export interface AcceptancePageRenderer {
  /** Renders the acceptance page for a resolved link (HTTP 200). */
  renderAcceptPage(view: AcceptancePageView, lang: AcceptancePageLang): string;
  /** Renders the uniform not-found page for unknown/expired/revoked tokens (HTTP 404). */
  renderNotFoundPage(lang: AcceptancePageLang): string;
}
