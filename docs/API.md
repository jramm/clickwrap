# clickwrap-server — API reference

Service version 0.1.0. Source of truth: the implemented controllers in `src/`. All examples are
JSON; the error format is always `{ "code": "<DomainErrorCode>", "message": "…" }`.

**Machine-readable contracts:** `pnpm openapi` generates two committed OpenAPI 3 specs at the repo
root — [`openapi.admin.json`](../openapi.admin.json) (everything under `/admin/**`, consumed by the
admin-UI client generator) and [`openapi.integration.json`](../openapi.integration.json) (the
service-to-service surface, see [INTEGRATION.md](INTEGRATION.md)). With `OPENAPI_DOCS_ENABLED=true`
the running service serves Swagger UIs at `/docs/admin` and `/docs/integration`.

The examples use the shipped example categories: document types `terms` / `dpa` and audiences
`customer` / `partner`. These are just data — you create your own via the admin API (see §2). The
per-document detail keys used in compliance responses are derived as
`<TYPE>_<AUDIENCE>` uppercased, e.g. `TERMS_CUSTOMER`, `DPA_PARTNER`.

---

## 1. Authentication & conventions

Admin authentication is **pluggable** (env `ADMIN_AUTH`, an ordered list of admin-auth plugin
keys — see [PLUGINS.md](PLUGINS.md)): each request runs the active strategies in order, the first
one returning an identity wins, all failing → **401** (never 500). The default chain is
`google-sso,static-token`; a `supertokens` built-in (JWKS session verification with a required
role) is also available.

| Area | Auth | Details |
|---|---|---|
| `/admin/**` (`google-sso`) | **Google SSO**: `Authorization: Bearer <Google ID token>` | Verified via google-auth-library: signature + `aud` = `GOOGLE_CLIENT_ID`, `email_verified` required, e-mail domain = `ADMIN_ALLOWED_DOMAIN`, optional exact allowlist `ADMIN_ALLOWED_EMAILS`. Failure → **401** (never 500). |
| `/admin/**` (`static-token`, dev/CI fallback) | Header `x-admin-token` = `ADMIN_API_TOKEN` | Timing-safe comparison; only active when the env var is set. Not an SSO replacement for production. |
| `/admin/**` (`supertokens`, opt-in) | `Authorization: Bearer <SuperTokens access token>` | JWT verified against `SUPERTOKENS_JWKS_URL` (optional `SUPERTOKENS_ISSUER`); requires `ADMIN_SUPERTOKENS_ROLE` (default `admin`) in the `st-role` claim. |
| `/customers/**` | Header `x-service-token` = `SERVICE_API_TOKEN` + context headers | The calling tool authenticates its own users and forwards the verified context: `x-customer-id`, `x-actor-user-id`, `x-actor-name`, `x-actor-email`, `x-actor-role`. **Actor and customer never come from the body.** This is a shared-secret seam; move to SSO/mTLS for production. |
| `/webhooks/postmark` | Header `token` = `POSTMARK_WEBHOOK_TOKEN` | Timing-safe; invalid → **403** (stops Postmark retries). Only mounted when `EMAIL_PROVIDER=postmark`. |
| `/accept/:token` (hosted acceptance page, §5a) | **The link token in the path** (capability URL minted via §4) | No service token, no headers. Unknown/expired/revoked → uniform **404**; per-token rate limit → **429**. |
| `/files/:storageKey` (only with `FILE_STORAGE=local`) | HMAC-signed URL (`expires` + `sig` query) | Minted by the backend (presigned-URL semantics, 15 min TTL); expired/tampered → **403**. Opaque to integrators. |

### `GET /admin/auth/methods` — login-method discovery (UNauthenticated)

The admin UI login page calls this before any credential exists. Response: the advertised login
methods of the ACTIVE strategies, in `ADMIN_AUTH` order (strategies that are active but not
configured for interactive login are omitted):

```json
{
  "methods": [
    {
      "key": "google-sso",
      "flow": "google",
      "label": "Sign in with Google",
      "params": { "clientId": "1234-abc.apps.googleusercontent.com" }
    },
    { "key": "static-token", "flow": "token", "label": "Admin API token", "params": {} }
  ]
}
```

`flow` tells the UI how to obtain the credential: `google` (Google Identity Services with
`params.clientId`; send the ID token as `Authorization: Bearer`), `token` (prompt; send as
`x-admin-token`), or `oidc-redirect` (redirect to `params.authorizeUrl`; the returned access token
is sent as `Authorization: Bearer`). The Google `clientId` comes from the backend env
(`GOOGLE_CLIENT_ID`) — a frontend-side `VITE_GOOGLE_CLIENT_ID` is obsolete.

- **Idempotency:** `POST /customers/:id/acceptances` and `…/objections` require an
  `Idempotency-Key` header. A replay with the same key returns the **identical 201 response** (also
  under concurrent requests); `409 ALREADY_ACCEPTED` is returned only for a *new* acceptance of an
  already-accepted version. `…/notifications` is naturally idempotent (no key needed).
- **CORS:** origins from `ADMIN_UI_ORIGINS` (comma-separated), for the admin web UI.
- The path `customerId` must match the authenticated context, otherwise `403 FORBIDDEN`.
- **Deadline timestamps are always set by the server** — client-supplied times are used only for
  plausibility checks, never for backdating.

---

## 2. Admin — audiences & document types (dynamic categories)

Audiences and document types are data-driven entities, not enums. Both share the same shape
`{ id, key, name }` and the same CRUD family. `key` is a URL-safe slug (`[a-z0-9-]{2,32}`), unique
per entity and immutable after creation; `name` is a human-readable label.

### Audiences

- `GET /admin/audiences` — list all audiences.
- `POST /admin/audiences` — create. Body `{ "key": "customer", "name": "Customer" }`. Duplicate
  key or invalid slug → `422 INVALID_STATE`.
- `PATCH /admin/audiences/:id` — rename (`{ "name": "…" }`); the `key` is immutable.
- `DELETE /admin/audiences/:id` — delete only if unreferenced (no document uses it as `audience`,
  no customer has it in `roles`). Still referenced → `422 INVALID_STATE`. Success → 204.

### Document types

Identical family under `/admin/document-types` (with two extra optional fields — the per-type
e-mail template assignments, see §2a):

- `GET /admin/document-types` — each entry is `{ id, key, name, external, notificationTemplateId?, reminderTemplateId? }`.
- `POST /admin/document-types` — `{ "key": "terms", "name": "Terms of Service", "external"?: false }`
- `PATCH /admin/document-types/:id` — `{ "name"?, "notificationTemplateId"?, "reminderTemplateId"? }`.
  For the template fields: a string assigns (validated to exist and match the kind), `null` clears
  the assignment, an omitted field keeps it. Unknown/incompatible template → `422 INVALID_STATE`.
  `key` **and** `external` are immutable — sending either in the PATCH body → `422 INVALID_STATE`.
- `DELETE /admin/document-types/:id` — refuses if referenced by any document.

#### Clickwrap vs. externally-signed document types (`external`)

`external` splits the two document worlds the service supports and is **settable at creation only**
(immutable afterwards):

- **`external: false` (default) — clickwrap flow.** The existing versions / publish / acceptance /
  compliance-gate machinery (§3). Documents and versions can be created for the type.
- **`external: true` — externally-signed documents.** No versions, no publish, no compliance gate.
  Instead, already-signed PDFs (e.g. counter-signed offers) are uploaded per customer as immutable
  evidence (§4a). Creating a document/version for an external type → `422 DOCUMENT_TYPE_EXTERNAL`.

Using a `type`/`audience` key that does not exist as an entity raises `422 UNKNOWN_DOCUMENT_TYPE` /
`422 UNKNOWN_AUDIENCE` at the point of use (e.g. creating a document).

---

## 2a. Admin — e-mail templates

Rollout **notification**, **reminder** and **acceptance-confirmation** mails are rendered from
admin-managed templates, selectable **per document type** (so `terms` vs. `dpa` can use different
wording). Templates are authored in the admin UI with the Unlayer drag-and-drop editor; the backend
stores the Unlayer `design` JSON (for re-editing) and the exported, self-contained `html`. A template
is `{ id, name, kind, subject, design, html, isDefault, createdAt, updatedAt }` where
`kind ∈ { VERSION_NOTIFICATION, REMINDER, ACCEPTANCE_CONFIRMATION }`.

The **acceptance-confirmation** mail is sent on acceptance and carries the accepted document as a PDF
attachment (see [INTEGRATION.md §6b](INTEGRATION.md#6b-acceptance-confirmation-e-mails)).

- `GET /admin/email-templates` — list (sorted by name). `isDefault=true` marks the three built-in rows.
- `POST /admin/email-templates` — create `{ name, kind, subject, design, html }` (strict body → 400).
- `PATCH /admin/email-templates/:id` — partial update of the same fields. Default rows are editable.
- `DELETE /admin/email-templates/:id` — refused for a default row or one still assigned to a
  document type (`422 INVALID_STATE`); otherwise 204.
- `POST /admin/email-templates/:id/preview` — body `{ documentTypeKey? }` → `{ subject, html, text }`
  rendered with realistic sample values (the UI shows this in a sandboxed iframe).

**Template resolution at send time:** the document's `DocumentTypeDef` assignment
(`notificationTemplateId` / `reminderTemplateId` / `acceptanceConfirmationTemplateId` by kind) → the
built-in **default** row (`tpl-default-notification` / `tpl-default-reminder` /
`tpl-default-acceptance-confirmation`, seeded on boot). The three default rows are real, editable
rows; they cannot be deleted.

**Placeholders** — `{{name}}` in `subject` and `html`; values are HTML-escaped when substituted into
`html` (the authored markup is trusted), and unknown placeholders are left visible as `{{name}}` so
authors notice typos. The plain-text part of a mail is derived from the substituted HTML.

| Variable | Meaning |
|---|---|
| `customerName` | Customer display name (derived: `companyName` if set, else `firstName lastName`) |
| `firstName` | Contact person's given name (empty when unknown) |
| `lastName` | Contact person's family name (empty when unknown) |
| `companyName` | Company / organisation name (empty when absent) |
| `documentName` | Document name (e.g. "DPA — Customers") |
| `documentType` | Document type display name |
| `audience` | Audience display name |
| `versionLabel` | Version label of the rolled-out revision |
| `changeSummary` | Short change summary of the version |
| `validFrom` | Date the version becomes effective (YYYY-MM-DD) |
| `deadlineAt` | Acceptance deadline (reminder mails; YYYY-MM-DD) |
| `acceptedAt` | When the acceptance was recorded (confirmation mails; ISO 8601 timestamp) |
| `acceptanceLink` | The customer's permanent hosted-acceptance URL (empty if `PUBLIC_BASE_URL` unset) |
| `documentPdfUrl` | Stable public latest-PDF URL (empty if `PUBLIC_BASE_URL` unset) |
| `appName` | Configurable brand name (`APP_NAME`, default `clickwrap-server`) |

---

## 3. Admin — documents & versions

### POST /admin/documents
One document per (type, audience).
```json
{ "type": "dpa", "audience": "customer", "name": "Data Processing Agreement — Customers" }
```
Duplicate (type, audience) → `422 INVALID_STATE`; unknown `type`/`audience` key →
`422 UNKNOWN_DOCUMENT_TYPE` / `422 UNKNOWN_AUDIENCE`.

### GET /admin/documents
Flat list of all documents including the current PUBLISHED version as a **version DTO** (or
`null` when only drafts exist), **all upcoming** published versions (scheduled publishes with a
future `validFrom`, as an array — empty when none), and the stable public PDF URL (or `null`):
```json
{ "items": [{ "id": "doc-…", "type": "dpa", "audience": "customer",
              "name": "DPA — Customers",
              "currentVersion": { "id": "v-…", "…": "version DTO, see below" },
              "upcomingVersions": [{ "id": "v-…", "…": "version DTO" }],
              "latestPdfUrl": "https://…/documents/dpa/customer/latest.pdf" }] }
```
`upcomingVersions` lists **every** PUBLISHED version whose `validFrom` lies in the future, ordered
by `validFrom` ascending (the nearest flip first) — several future versions may be scheduled
simultaneously and all are returned, not just the next. The current version stays the compliance
baseline until the flip at the nearest one's `validFrom`. `latestPdfUrl` is
`${PUBLIC_BASE_URL}/documents/<type>/<audience>/latest.pdf` (see §5b) and is `null` when no
published version is in effect or `PUBLIC_BASE_URL` is unset.

### GET /admin/documents/:id/versions
Version history of a document (DRAFT/PUBLISHED/RETIRED). Every entry is the same **version DTO**
as `GET /admin/versions/:id`:
```json
{ "items": [{ "id": "v-…", "documentId": "doc-…", "versionLabel": "2026-06", "status": "DRAFT",
              "acceptanceMode": "ACTIVE", "changeSummary": "…", "consentText": "…",
              "objectionPeriodDays": null, "gracePeriodDays": 14, "validFrom": "…",
              "publishedAt": null, "contentHash": "sha256:…", "fileName": "dpa.pdf",
              "pdfUrl": "https://… (presigned, 15-minute TTL)" }] }
```
The internal `storageKey` is never exposed; `pdfUrl` is always a freshly resolved presigned URL.

### POST /admin/documents/:id/versions — new DRAFT version
**Primary: `multipart/form-data`** (field `file` = PDF, max 20 MB) + metadata fields;
**fallback**: a JSON body with `file` as a base64 string + `fileName`.

| Field | Required | Description |
|---|---|---|
| `file` | ✔ | PDF (multipart) or base64 (JSON fallback, then also `fileName`) |
| `versionLabel` | ✔ | e.g. "2026-06" |
| `changeSummary` | ✔ | short description for the popup (publish gate: `CHANGE_SUMMARY_REQUIRED`) |
| `acceptanceMode` | ✔ | `ACTIVE` \| `PASSIVE` |
| `consentText` | if ACTIVE | exact checkbox consent text — versioned server-side, basis of the evidence (`CONSENT_TEXT_REQUIRED`) |
| `objectionPeriodDays` | if PASSIVE | objection period, e.g. 14 |
| `gracePeriodDays` | if ACTIVE | grace period until hard block (default 14) |
| `validFrom` | ✔ | ISO date from which the revision applies; **may lie in the future** (scheduled effectiveness — see publish below) |

**201:** `{ "versionId": "…", "status": "DRAFT", "contentHash": "sha256:…", "fileName": "…" }`

### GET /admin/versions/:id · PATCH /admin/versions/:id · DELETE /admin/versions/:id
Detail (the version DTO above, incl. `pdfUrl`) / metadata or PDF change / delete — PATCH/DELETE
**only for `DRAFT`**, otherwise `409 VERSION_IMMUTABLE`. DELETE → 204.

### POST /admin/versions/:id/publish
Publishes (immutable from now on): the previous version of the same document → `RETIRED`, its
**open customer states → `SUPERSEDED`** (the sweeper never books tacit acceptance for superseded
versions), rollout to all customers with a matching role (`PENDING_NOTIFICATION`; if the previous
state was `EXPIRED_BLOCKING` → `carryOverBlocking=true`, the customer stays blocked), e-mail sending
via the configured provider, and an audit-log entry.
```json
{ "versionId": "…", "status": "PUBLISHED", "rolloutCustomers": 921, "publishedAt": "2026-07-07T09:00:00Z" }
```
Missing change summary → `422 CHANGE_SUMMARY_REQUIRED`; ACTIVE version without consent text →
`422 CONSENT_TEXT_REQUIRED`.

**Scheduled effectiveness (future `validFrom`):** the rollout still happens immediately — states
are created and rollout mails are sent, so acceptance can be collected in advance (the popup and
the hosted page mark such items with `upcoming: true`). The predecessor is **not** retired and its
open states are **not** superseded at publish: it remains the compliance baseline
(`findCurrentPublished` = newest PUBLISHED with `validFrom <= now`) until the flip. At `validFrom`
the hourly **activation sweep** retires the predecessor, supersedes its open states (never tacit
afterwards) and carries an `EXPIRED_BLOCKING` block over to the new version's state
(`carryOverBlocking=true`). Deadlines of a not-yet-effective version are anchored:
`deadlineAt = max(notifiedAt + period, validFrom)` (carry-over: `max(notifiedAt, validFrom)`) —
the recipient always gets the full objection/grace window AND nothing can block or be tacitly
booked before `validFrom`.

---

## 4. Admin — operations

### Customers (GET /admin/customers · GET /admin/customers/:id · POST /admin/customers · PATCH /admin/customers/:id)

Customer administration (also see the integration variant `POST /customers`, §5).

- `GET /admin/customers?page=&search=&documentType=&audience=&compliance=` — pages of 50, sorted by
  the derived display name then `externalRef`:
  `{ "items": [{ "id", "externalRef", "firstName", "lastName", "companyName?", "roles", "contactEmails", "compliant", "complianceStatus" }], "total": 173 }`.
  The optional `search` is a case-insensitive substring match on `firstName`, `lastName`,
  `companyName`, `externalRef` and `contactEmails`; it is applied **before** pagination, so `total`
  reflects the filtered count.
  Every row carries a **compliance indicator** — `compliant` (boolean; the domain compliance gate,
  `false` = blocked) and `complianceStatus` (`compliant | pending | objected | blocked`, the worst
  outstanding status for the list chip) — computed via the domain `computeCompliance` over the
  customer's states and the current published versions. The three filters that the removed global
  Overview page offered now live here and **fully replace** it:
  - `documentType` (type key) / `audience` (audience key) **narrow the returned rows** to customers
    who actually have a matching document/role assigned — and additionally scope the per-row
    compliance indicator to that type / audience. "Assigned" means the customer's role matches a
    document's audience:
    - `audience=A` keeps only customers whose `roles` include `A` (role-based — a document need not
      exist for that audience).
    - `documentType=T` keeps only customers with a type-`T` document assigned (∃ document of type `T`
      whose audience is one of the customer's roles). A customer whose roles match no type-`T`
      document is excluded.
    - both → the intersection (role `A` present **and** a type-`T` document with audience `A` exists).
    An unknown `documentType`/`audience` matches nothing, so the list is empty (lenient — no error).
    Narrowing runs **before** the compliance filter and pagination, so `total` reflects the narrowed
    count.
  - `compliance` — one of `compliant | non_compliant | pending | blocked | objected` — additionally
    keeps only the customers whose (scoped) compliance matches: `non_compliant` = the gate is closed
    (blocking, incl. block carry-over); `blocked` = a hard `EXPIRED_BLOCKING` state; `pending` = an
    outstanding `PENDING_NOTIFICATION`/`NOTIFIED` state; `objected` = an `OBJECTED` state; `compliant`
    = nothing outstanding. The compliance filter runs **before** pagination, so `total` reflects the
    filtered count.
- `GET /admin/customers/:id` — a single customer record
  `{ "id", "externalRef", "firstName", "lastName", "companyName", "roles", "contactEmails" }`
  (e.g. for the detail-page header); unknown id → `404 CUSTOMER_NOT_FOUND`.
- `POST /admin/customers` → 201 with the full object plus `importedAcceptances`:
  ```json
  { "externalRef": "crm-4711", "firstName": "Jane", "lastName": "Doe", "companyName": "Acme GmbH",
    "roles": ["customer"], "contactEmails": ["legal@acme.example"],
    "acceptedVersions": [{ "versionId": "v-…", "acceptedAt": "2026-07-01T00:00:00Z",
                           "reference": "HubSpot deal 12345 / signed offer" }] }
  ```
  `firstName`/`lastName` (contact person) and `companyName` are all optional; the derived display
  name (`customerName`) is `companyName` when set, else `firstName lastName`.
  `roles` are validated against the audiences (`422 UNKNOWN_AUDIENCE`); `externalRef` is unique
  **only among customers with overlapping roles** — the partner and customer external ID spaces are
  separate, so the same `externalRef` may coexist on records with disjoint roles; a duplicate that
  shares at least one role → `422 INVALID_STATE`. `contactEmails` get a basic format check. The optional
  `acceptedVersions` records versions the customer already accepted out-of-band (signed offer) as
  `IMPORT` acceptances (channel `ADMIN`, backdatable `acceptedAt`, `reference` stored as
  `evidenceNote`) with an immediate `ACCEPTED` state — the version must be PUBLISHED/RETIRED and
  covered by the roles (`422 ROLE_MISMATCH`). All imports are validated before anything is
  persisted. Writes a `CUSTOMER_CREATE` audit entry.
- `PATCH /admin/customers/:id` — any subset of `{ firstName, lastName, companyName, roles, contactEmails }` → 200; unknown id
  → `404 CUSTOMER_NOT_FOUND`. Adding a role that would overlap another customer sharing this
  `externalRef` → `422 INVALID_STATE`. Writes a `CUSTOMER_UPDATE` audit entry.

**Onboarding rollout:** creating a customer (and ADDING a role via PATCH) immediately creates
`PENDING_NOTIFICATION` states for every **current published version** covered by the (new) roles
that is not already accepted — the customer shows up in pending-agreements (popup / hosted
acceptance page) right away instead of waiting for the next publish. An `acceptedVersions` import
of the current version keeps its `ACCEPTED` state; an import of an **old (retired) version** still
yields a `PENDING_NOTIFICATION` state for the current one (the customer is asked to accept the
current revision). Like publish, the onboarding rollout **sends an acceptance-notification e-mail**
per newly rolled-out version (skipped for versions covered by an `acceptedVersions` import, and for
customers without contact e-mails); deadlines start with the first provable access as usual.
REMOVING a role still takes effect on the next publish/rollout only.

### POST /admin/customers/:id/acceptance-links — mint a hosted acceptance link
```json
{ "audienceKey": "customer", "expiresInDays": 30 }
```
Both fields optional: `audienceKey` scopes the hosted page to one audience (unknown key →
`422 UNKNOWN_AUDIENCE`); `expiresInDays` defaults to 30, max 365 (out of range →
`422 INVALID_STATE`). **`PUBLIC_BASE_URL` is required** — unset →
`422 INVALID_STATE` with an actionable message.

**201:** `{ "linkId": "al-…", "url": "https://…/accept/<token>", "expiresAt": "…" }`

The `url` is a **capability**: whoever has it can open the acceptance page (see §5a) — treat it
like a password. The raw token appears only in this response; the server persists just its
SHA-256. Writes an `ACCEPTANCE_LINK_CREATE` audit entry (linkId only, never token material).

The admin UI exposes this as the **"Copy acceptance link"** action in the agreements section of the
customer detail page (`/customers/:id`): one permanent, whole-account link covering all of that
customer's outstanding agreements.

### GET /admin/dashboard · GET /admin/versions/:id/stats — per-version acceptance dashboard

`GET /admin/dashboard` returns one entry per **relevant version** — the current published version
and **every** upcoming (scheduled, future `validFrom`) published version of **every document** (all
of them, not just the next — several futures may be scheduled at once). `GET /admin/versions/:id/stats`
returns the same shape for a single version (`404 VERSION_NOT_FOUND` for an unknown id).

```json
{
  "items": [{
    "versionId": "v-…",
    "documentName": "DPA — Customers",
    "documentType": "dpa",
    "audience": "customer",
    "versionLabel": "June 2026 edition",
    "status": "PUBLISHED",
    "validFrom": "2026-06-01T00:00:00Z",
    "upcoming": false,
    "stats": {
      "totalCustomers": 42,
      "accepted": 22,
      "acceptedByChannel": { "PORTAL": 12, "LINK": 3, "ADMIN": 5, "SYSTEM": 2 },
      "acceptedByMethod": { "ACTIVE_CONSENT": 14, "TACIT": 6, "IMPORT": 2 },
      "pending": 12,
      "blocked": 5,
      "objected": 3,
      "acceptanceRate": 0.5238
    }
  }]
}
```

The counters are computed over the version's **relevant states** — every `CustomerVersionState`
whose value is **not `SUPERSEDED`** (superseded states belong to an old revision the customer was
moved off):

- `totalCustomers` — count of relevant (non-`SUPERSEDED`) states.
- `accepted` — states in `ACCEPTED`.
- `pending` — states in `PENDING_NOTIFICATION` or `NOTIFIED`.
- `blocked` — states in `EXPIRED_BLOCKING`.
- `objected` — states in `OBJECTED`.
- `acceptedByChannel` / `acceptedByMethod` — the **effective acceptance** of every accepted customer,
  bucketed by channel resp. method; each sums to `accepted`.
- `acceptanceRate` — `accepted / totalCustomers` (0 when `totalCustomers` is 0).

### GET /admin/versions/:id/customers?state=accepted|pending|blocked|objected&search=…&page=…

Per-version customer status list — the drill-down target of the dashboard cards. Every row reports
the customer's state and acceptance **for the requested version**, not for the currently effective
one: drilling into an **upcoming** version correctly shows who has (not) accepted **that** version.
`SUPERSEDED` states are excluded; pages of 50; `404 VERSION_NOT_FOUND` for an unknown id.

- `state` — `accepted` (ACCEPTED) · `pending` (PENDING_NOTIFICATION or NOTIFIED) · `blocked`
  (EXPIRED_BLOCKING) · `objected` (OBJECTED). Omit for all.
- `search` — case-insensitive substring on the customer name / externalRef / contactEmails.
- `stats` reuses the `GET /admin/versions/:id/stats` shape so the page header matches the card.
- `acceptance` is the **effective acceptance of this version only** (absent when the customer has not
  accepted this version, even if they accepted a sibling version).

```json
{
  "items": [{
    "customerId": "c-…",
    "customerName": "Acme GmbH",
    "externalRef": "crm-4711",
    "state": "PENDING_NOTIFICATION",
    "notifiedAt": "2026-07-07T09:05:11Z",
    "deadlineAt": "2026-07-21T09:00:00Z",
    "carryOverBlocking": false,
    "acceptance": {
      "acceptedAt": "2026-06-05T10:00:00Z",
      "method": "ACTIVE_CONSENT",
      "channel": "PORTAL",
      "actorName": "Jane Doe"
    }
  }],
  "total": 42,
  "stats": { "versionId": "v-…", "documentName": "DPA — Customers", "versionLabel": "August 2026 edition", "upcoming": true, "stats": { "totalCustomers": 42, "accepted": 0, "pending": 42, "blocked": 0, "objected": 0, "acceptanceRate": 0 } }
}
```

### GET /admin/customers/:id/history
Full history including evidence data and — for the admin UI's operational actions — the rollout
states with their IDs:
```json
{
  "acceptances": [{
    "versionId": "…", "documentType": "dpa", "versionLabel": "2026-06",
    "method": "ACTIVE_CONSENT", "channel": "PORTAL", "acceptedAt": "…", "isEffective": true,
    "actor": { "userId": "u-42", "name": "Jane Doe", "email": "…", "portalRole": "admin" },
    "evidence": { "ipAddress": "…", "userAgent": "…", "consentText": "…",
                  "consentTextHash": "sha256:…", "contentHash": "sha256:…",
                  "evidenceNote": "IMPORT: e.g. \"HubSpot deal 12345 / signed offer\" · LINK: \"identity self-declared via acceptance link al-…\"" }
  }],
  "objections": [ { "…": "incl. resolution?: WITHDRAWN | RESOLVED_ACCEPTED | RESOLVED_TERMINATED" } ],
  "notifications": [{ "versionId": "…", "channel": "EMAIL", "deliveredAt": "…" }],
  "states": [{
    "id": "cvs-1", "versionId": "…", "documentType": "dpa", "versionLabel": "2026-06",
    "state": "NOTIFIED", "notifiedAt": "…", "deadlineAt": "…", "remindersSent": 1,
    "carryOverBlocking": false
  }],
  "signedDocuments": [{
    "id": "sd-…", "documentTypeKey": "signed-offer", "audience": "customer",
    "fileName": "signed-offer.pdf", "contentHash": "sha256:…", "fileSize": 20480,
    "signedAt": "2026-06-15T00:00:00Z", "signerName": "Jane Doe",
    "reference": "HubSpot deal 12345", "uploadedBy": "u-42", "uploadedAt": "…"
  }]
}
```
`signedDocuments` (newest first) is the externally-signed evidence archive (§4a). It is a **pure
evidence view** — signed documents never affect `compliant`, pending agreements, deadlines or the
dashboards.

### POST /admin/customers/:id/acceptances — manual (back-dated) recording
```json
{ "versionId": "…", "method": "ACTIVE_CONSENT", "reason": "Consent received by letter on 2026-07-01",
  "evidenceDocument": "<base64 PDF>" }
```
`method`: `ACTIVE_CONSENT` | `IMPORT` (TACIT excluded — it is only ever produced by the sweeper).
`reason` and a non-empty `evidenceDocument` are required (`422 INVALID_STATE`). `channel=ADMIN`,
actor = the Google SSO identity. Writes an audit-log entry.

### PATCH /admin/customer-version-states/:id — extend deadline / suspend block
```json
{ "deadlineAt": "2026-08-15T00:00:00Z", "suspendBlock": true, "reason": "Customer in clarification with legal" }
```
`reason` is required. `suspendBlock=true`: `EXPIRED_BLOCKING → NOTIFIED` with a new `deadlineAt`
(then required). Without `suspendBlock`: deadline extension only. Writes an audit-log entry.

### POST /admin/customer-version-states/:id/remind
Re-send the reminder (`remindersSent`++, e-mail send). Writes an audit-log entry.

---

## 4a. Admin — signed documents (externally-signed evidence archive)

For document types with `external: true` (§2). Signed PDFs are uploaded per customer as immutable
evidence — append-only (corrections are a new upload), and **never part of the compliance gate**.
The internal `storageKey` is never exposed; each response carries a presigned `pdfUrl`.

### POST /admin/customers/:id/signed-documents → 201
`multipart/form-data` (primary) or base64 JSON (fallback), mirroring the version upload:
- File: multipart field `file`, or base64 `file` + `fileName` in the JSON body.
- Metadata: `documentTypeKey` (required, must be an `external` type), `signedAt` (required, ISO —
  backdatable), `signerName?`, `reference?`, `audience?`, `note?`.
- Validation: unknown customer → `404 CUSTOMER_NOT_FOUND`; unknown type → `422
  UNKNOWN_DOCUMENT_TYPE`; a non-external type → `422 DOCUMENT_TYPE_NOT_EXTERNAL` (those use the
  version flow); unknown `audience` → `422 UNKNOWN_AUDIENCE`.
- 201 → the created `SignedDocument` (with a presigned `pdfUrl`; `contentHash` computed host-side).
  Writes a `SIGNED_DOCUMENT_UPLOAD` admin-audit entry.

### GET /admin/customers/:id/signed-documents
`{ items: SignedDocument[] }`, newest first.

### GET /admin/signed-documents/:id/pdf → 302
Redirects to a fresh presigned PDF URL. Unknown id → `404 VERSION_NOT_FOUND`.

---

## 4b. Admin — events (legal audit log)

### GET /admin/events?customerId=&from=&to=&category=&documentType=&versionId=&page=

One normalized, chronological (**newest-first**), paginated (**50/page**), filterable event list for
legal tracing — for the whole system or a single customer. It reads a **dedicated, append-only
`Event` table** that the core writes on each successful domain action (dual-write via
`EventRecorder`, ALONGSIDE the unchanged evidence/audit stores — Acceptance/Objection/
NotificationEvent/AdminAuditLog/OutboundEmail remain the legally authoritative records). The read
side is a trivial query over that table; the row fields are stored **denormalized** (customerName,
versionLabel, documentType, …) so the log stays historically accurate.

Response `{ items: Event[], total }` where `total` is the count **after filtering** (before
pagination). Each `Event`:

- `id` — stable `Event`-table id (`evt-…`).
- `occurredAt` — ISO date-time (server time at record time).
- `type` — the specific event (see the **full catalogue** below).
- `category` — one of `COMMUNICATION` (an e-mail was sent/delivered), `ACCESS` (the hosted acceptance
  page was opened — provable access), `CONSENT` (acceptances + objections), `ADMINISTRATION` (all
  admin/system config + operations actions).
- `actorKind` (`ADMIN` | `CUSTOMER` | `SYSTEM`) + `actorLabel` — **displayed, not filterable**.
- optional `customerId`, `customerName`, `versionId`, `documentType`, `audience`, `versionLabel`,
  `channel`, `recipient`; always a short English `summary` and pass-through `metadata`
  (reason/method/… — a superseded acceptance stays in the log, flagged via `metadata.isEffective`).

Query params (all optional, applied **before** pagination):

- `customerId` — exact match.
- `from` / `to` — inclusive `occurredAt` bounds. ISO date-time; a **date-only** value is widened
  (`from` = start of that day, `to` = **end** of that day) so a single-day range matches that day.
- `category` — one of the four categories.
- `documentType` — exact document type key. `versionId` — exact version id.
- `page` — 1-based (50/page).

Sort: `occurredAt` DESC, stable tiebreak by id.

#### Event catalogue (traceability guarantee)

Every state-changing action produces exactly one event, so the log is a complete audit trail.
`actorKind` is `SYSTEM` for cron/webhook-driven transitions, `ADMIN` for admin-triggered actions,
`CUSTOMER` for portal/link self-service. Grouped by `category`:

**COMMUNICATION**
- `EMAIL_SENT` (SYSTEM) — a rollout/reminder/acceptance-link mail was sent (also covers automatic,
  cron-driven reminders, whose mailer is the same instrumented `AgreementEmailService`).
- `EMAIL_DELIVERED` (SYSTEM) — provider delivery confirmation (webhook / fallback polling).
- `EMAIL_BOUNCED` (SYSTEM) — provider bounce (recipient unreachable); `metadata.inactivatedEmail`.

**ACCESS**
- `PAGE_ACCESSED` (CUSTOMER) — the hosted acceptance page was opened (provable access).

**CONSENT**
- `VERSION_ACCEPTED` — active consent (`CUSTOMER`, portal/link), admin/import recording (`SYSTEM`,
  `metadata.method=IMPORT`), or **passive/tacit** acceptance (`SYSTEM`, `metadata.method=TACIT`,
  cron-driven by the deadline sweeper when the objection period lapses).
- `OBJECTION_RAISED` (CUSTOMER) — an objection to a PASSIVE version.
- `MANUAL_ACCEPTANCE` (ADMIN) — an admin recorded an acceptance manually.
- `DEADLINE_EXTENDED` (ADMIN) — an admin extended a deadline.
- `DEADLINE_EXPIRED` (SYSTEM) — **cron**: an ACTIVE version's grace period lapsed → EXPIRED_BLOCKING
  (deadline sweeper).
- `BLOCK_SUSPENDED` (ADMIN) — an admin lifted/suspended a block.
- `BLOCK_CARRIED_OVER` (SYSTEM) — **cron**: an EXPIRED_BLOCKING predecessor block was carried onto the
  successor version's state (activation sweeper).
- `OBLIGATION_ROLLED_OUT` (ADMIN on publish/rollout, SYSTEM on integration onboarding / activation
  sweeper) — a customer was put under obligation to accept a version (one per created
  PENDING_NOTIFICATION state). The authoritative "customer became obliged" record — crucial for
  customers with **no** contact e-mail, for whom no `EMAIL_SENT` fires.
- `REMINDER_TRIGGERED` (SYSTEM) — a reminder was triggered.

**ADMINISTRATION**
- `VERSION_PUBLISHED` (ADMIN) — a version was published.
- `VERSION_ACTIVATED` (SYSTEM) — **cron**: a scheduled version became the effective one (activation
  sweeper).
- `VERSION_RETIRED` — a predecessor version was retired: `ADMIN` on an immediate publish, `SYSTEM`
  (cron) at a scheduled flip (activation sweeper).
- `DOCUMENT_CREATED` (ADMIN) — a document (type × audience container) was created.
- `VERSION_DRAFT_CREATED` (ADMIN) — a DRAFT version was created.
- `VERSION_UPDATED` (ADMIN) — a DRAFT version was patched.
- `CUSTOMER_CREATED` / `CUSTOMER_UPDATED` (ADMIN) — customer master-data changes.
- `SIGNED_DOCUMENT_UPLOADED` (ADMIN) — an externally-signed document was archived.
- `ACCEPTANCE_LINK_CREATED` (ADMIN) — a hosted acceptance link was minted.
- `DOCUMENT_TYPE_*` / `AUDIENCE_*` / `EMAIL_TEMPLATE_*` (ADMIN) — config CRUD.

---

## 5. Portal / service-to-service

Full integrator guide: [INTEGRATION.md](INTEGRATION.md).

### POST /customers — customer onboarding (integration) → 201
Auth: `x-service-token` only — **no** `x-customer-id` (the customer does not exist yet); the
optional `x-actor-*` headers name the acting user for the audit/evidence trail. Body and
semantics are identical to `POST /admin/customers` (§4) including `acceptedVersions` — the
typical call right after a signed offer:
```json
{ "externalRef": "crm-4711", "firstName": "Jane", "lastName": "Doe", "companyName": "Acme GmbH",
  "roles": ["customer"], "contactEmails": ["legal@acme.example"],
  "acceptedVersions": [{ "versionId": "v-9", "acceptedAt": "2026-07-01T00:00:00Z",
                         "reference": "HubSpot deal 12345 / signed offer" }] }
```
**201:** the customer row plus `importedAcceptances: [{ versionId, acceptanceId }]`. A duplicate
`externalRef` **that shares at least one role** → `422 INVALID_STATE` — integrators can treat this
as the idempotency signal **per overlapping role set** (the partner and customer external ID spaces
are separate, so the same ref may legitimately coexist on records with disjoint roles). Use distinct
refs per audience space, or GET first, to avoid ambiguity.

### GET /customers/:customerId/compliance?audience=customer|partner
The compliance gate. Each tool queries with **its** audience; without the parameter the result is
aggregated over all of the customer's roles. `compliant=false` **only** for `EXPIRED_BLOCKING` or a
not-yet-accepted carry-over state. A customer without any role: `compliant=true`, `roles: []`.
```json
{
  "customerId": "c-123", "audience": "customer", "roles": ["customer"], "compliant": false,
  "details": {
    "TERMS_CUSTOMER": { "requiredVersionId": "v-1", "requiredVersionLabel": "2026-04",
                        "acceptedVersionId": "v-1", "state": "ACCEPTED", "method": "TACIT" },
    "DPA_CUSTOMER": { "requiredVersionId": "v-9", "requiredVersionLabel": "2026-06",
                      "acceptedVersionId": "v-2", "state": "EXPIRED_BLOCKING",
                      "deadlineAt": "2026-06-30T00:00:00Z", "pendingMode": "ACTIVE" }
  }
}
```
Recommendation for callers: query on login **and** periodically per session (≤ 15 min), and
invalidate the cache immediately after an acceptance. On service outage: fail-open with the last
cached result.

### GET /customers/:customerId/pending-agreements?audience=…
Popup content (empty = nothing to show). Current PUBLISHED versions with an open state
(`PENDING_NOTIFICATION` | `NOTIFIED` | `EXPIRED_BLOCKING`) — plus **every upcoming** published
version (scheduled publish, `validFrom` in the future) with an open state, each marked
`upcoming: true` with its `validFrom` (ordered by `validFrom` ascending); the current one and any
number of future ones may be open at the same time:
```json
[{ "versionId": "v-9", "documentType": "dpa", "audience": "customer",
   "versionLabel": "2026-06",
   "changeSummary": "New sub-processor for e-mail delivery; TOMs section 3 updated.",
   "pdfUrl": "https://…", "mode": "ACTIVE", "deadlineAt": "2026-06-30T00:00:00Z", "blocking": true,
   "upcoming": false, "validFrom": "2026-06-01T00:00:00Z" },
 { "versionId": "v-10", "documentType": "dpa", "audience": "customer",
   "versionLabel": "2026-08",
   "changeSummary": "Scheduled revision.",
   "pdfUrl": "https://…", "mode": "ACTIVE", "blocking": false,
   "upcoming": true, "validFrom": "2026-08-01T00:00:00Z" }]
```
`blocking=true` → the tool shows the block screen (accepting lifts the block immediately).
`upcoming=true` → the version is published but not yet in effect; accepting it in advance is
valid (`POST /acceptances` allows the current **or** an upcoming version), the current version
stays required until the flip at `validFrom`. Deadlines of upcoming items are anchored at
`max(notifiedAt + period, validFrom)` — they can never expire before `validFrom`.

### POST /customers/:customerId/acceptances   (Idempotency-Key required) → 201
```json
{ "versionId": "v-9", "displayedConsentText": "I have read the new version and agree." }
```
**Evidence chain, server-side:** the actor (user id, name, portal role) comes exclusively from the
auth context; the consent text is taken from `AgreementVersion.consentText`, and
`displayedConsentText` is only used for a cross-check (`422 CONSENT_TEXT_MISMATCH`). The service
adds IP, user-agent, timestamp and `contentHash`. Body fields like `actorUserId` are rejected with
**400** (strict schema).
**201:** `{ "acceptanceId": "a-991", "state": "ACCEPTED" }` · Errors: `404 VERSION_NOT_FOUND` ·
`422 VERSION_NOT_CURRENT` (a newer version exists → reload pending) · `422 ROLE_MISMATCH` ·
`409 ALREADY_ACCEPTED`.

### POST /customers/:customerId/objections   (Idempotency-Key required) → 201
Only for **PASSIVE** versions within the objection period.
```json
{ "versionId": "v-9", "reason": "Sub-processor XY is not accepted." }
```
→ state `OBJECTED` (no tool block; escalated to legal/CS). Errors: `422 OBJECTION_NOT_APPLICABLE`
(ACTIVE version — there is no right of objection, not even from the block screen) ·
`422 OBJECTION_PERIOD_EXPIRED` (after the deadline; recorded only as an escalation note).

### POST /customers/:customerId/notifications → 200
Proof of access ("the popup was displayed"):
```json
{ "versionId": "v-9", "channel": "PORTAL", "displayedAt": "2026-07-08T08:00:12Z" }
```
`notifiedAt` is set to the **server time** (`displayedAt` is only a plausibility check, no
backdating), **atomically** and only from `PENDING_NOTIFICATION` (a superseded state is never
revived). Starts the deadline: `deadlineAt = notifiedAt + objectionPeriodDays/gracePeriodDays`;
with `carryOverBlocking` it is immediately blocking. Response:
`{ "state": "…", "notifiedAt": "…", "deadlineAt": "…" }`. Repeated reporting is harmless.

---

## 5a. Hosted acceptance page (`/accept/**` — no integration required)

The no-integration alternative to the embedded popup (guide:
[INTEGRATION.md](INTEGRATION.md) "Hosted acceptance page"): an admin mints a link (§4) and sends
it directly to the person who has to accept. **The link token IS the authentication** — there is
no service token and no context headers. Both endpoints share a simple per-token rate limit
(20 requests/minute, in-memory, single-node MVP) → `429 RATE_LIMITED`.

### GET /accept/:token → 200 (text/html)
Server-rendered, self-contained HTML (inline CSS/JS, mobile-first, no external assets).
Language: `?lang=de|en`, else `Accept-Language`, default English (strings shipped for en + de).
Content per pending agreement of the link's customer (scoped to the link's `audienceKey` when
set; same source as `GET /customers/:id/pending-agreements`): document name, version label,
change summary, presigned PDF link, and — for ACTIVE versions — the exact consent text next to a
checkbox plus signer name/e-mail inputs and an accept button. PASSIVE versions are shown
informationally (tacit acceptance continues to be handled by the sweeper). Nothing pending → a
friendly "everything is accepted" page.

- **Rendering counts as provable access**: per pending item a
  `NotificationEvent (channel=LINK, recipient="link:<linkId>")` is recorded and `notifiedAt` is
  set exactly like the portal-popup path — atomically, first access wins, `carryOverBlocking`
  respected, SUPERSEDED never revived. `lastUsedAt` of the link is updated.
- **Invalid/expired/revoked token → uniform 404 HTML page** — deliberately identical in all three
  cases (no information leak about whether the token ever existed).

### POST /accept/:token/acceptances → 201
JSON body from the page's inline JS (strict schema — actor-like fields are rejected with 400):
```json
{ "versionId": "v-9", "displayedConsentText": "I have read the new version and agree.",
  "signerName": "Max Mustermann", "signerEmail": "max@acme.example" }
```
Full acceptance flow with **channel `LINK`**: current-version check
(`422 VERSION_NOT_CURRENT`), role coverage (`422 ROLE_MISMATCH`), consent-text cross-check
(`422 CONSENT_TEXT_MISMATCH`), `409 ALREADY_ACCEPTED` (the page renders it as a friendly "already
accepted" state). **Identity is SELF-DECLARED**: the actor is recorded as
`{ userId: "link:<linkId>", name: signerName, email: signerEmail }` and the acceptance's
`evidenceNote` says `identity self-declared via acceptance link <linkId>` — the evidence never
pretends to be a verified portal identity. Consent text/`contentHash` come from the version
server-side as always; IP/user-agent from the request. Optional `Idempotency-Key` header (the
page sends a random key per attempt; replays return the identical 201). Unknown/expired/revoked
token → `404 LINK_NOT_FOUND` (uniform).

**201:** `{ "acceptanceId": "a-…", "state": "ACCEPTED" }`

---

## 5b. Public documents (`/documents/**` — no auth)

### GET /documents/:typeKey/:audienceKey/latest.pdf → 302
Stable, unauthenticated per-document URL meant to be rendered into static places (offers,
templates, e-mail footers). The path is **deterministic from the document keys**, so it stays
valid across every future publish — render it once, it always serves the latest PDF.

Each request 302-redirects to a **fresh presigned URL** of the **currently effective** published
version (newest PUBLISHED with `validFrom <= now` — never an upcoming, not-yet-effective one: an
offer must reference what is in force at signing time). Because a redirect is issued per click,
presigned-URL expiry is irrelevant and the endpoint works with any file-storage plugin.

- **Uniform 404** (`{ "code": "VERSION_NOT_FOUND", … }`) for unknown type/audience/document, no
  published version, or an only-upcoming version — never reveals which case it was.
- **Side-effect-free**: a GET writes no notification, state or evidence — acceptance happens
  implicitly by signing the offer and is recorded later via the `acceptedVersions` import on
  customer creation (`POST /customers`).
- The admin documents list (`GET /admin/documents`) exposes the full URL as `latestPdfUrl`
  (built from `PUBLIC_BASE_URL`) so the admin UI can offer "copy public PDF link".

---

## 6. Webhooks & background jobs

### POST /webhooks/postmark → 200
Only mounted when `EMAIL_PROVIDER=postmark`. Auth: `token` header (see §1), invalid → **403**.
This is the provider-specific ingestion for the generic delivery-event pipeline; the events it
produces (delivery confirmation, bounce escalation) are provider-agnostic. RecordTypes:

- **`Delivery`** → correlated via the Postmark `MessageID` (stored on send): writes a
  `NotificationEvent (channel=EMAIL)` and sets `notifiedAt` atomically (deadlines start).
  **Unknown MessageIDs → 200, ignored** (shared Postmark servers in review environments). Duplicate
  delivery is idempotent.
- **`Bounce`** → escalation "unreachable" (the deadline does **not** start); `inactivated_email` is
  recorded. Unknown MessageID → no-op.
- Other RecordTypes → 200, no-op.

A provider that offers webhooks/polling registers its own controller/job gated on the selected
`EMAIL_PROVIDER` (see the e-mail plugin guide in the README). Providers without delivery tracking
(`smtp`, `noop`) send but do not confirm delivery — in those modes deadlines start exclusively via
the portal popup (`POST /customers/:id/notifications`).

### Background jobs (not HTTP, but part of the contract)
- **Activation sweep** — hourly, runs BEFORE the deadline pass: for every (type, audience) whose
  scheduled version has become effective (`validFrom` reached), it retires the predecessor,
  supersedes its open states (SUPERSEDED — never tacit afterwards) and carries
  `EXPIRED_BLOCKING` blocks over to the new version's states (`carryOverBlocking=true`).
  Idempotent, per-document error isolation. Kill switch `SWEEPER_ENABLED=false`.
- **Deadline sweeper** — hourly: PASSIVE deadline expiry → `Acceptance(TACIT, channel=SYSTEM)`;
  ACTIVE grace expiry → `EXPIRED_BLOCKING`. Kill switch `SWEEPER_ENABLED=false`.
- **Reminders** — daily (7 and 2 days before `deadlineAt`).
- **Postmark fallback polling** — every 10 minutes, to recover lost delivery webhooks
  (Postmark provider only).

---

## 7. Error codes (complete)

| HTTP | Code | Meaning |
|---|---|---|
| 400 | — (Zod) | Body validation failed (incl. actor fields sent in the body) |
| 401 | — | Missing/invalid authentication (Google token, service token) |
| 403 | `FORBIDDEN` | Path customer ≠ auth context; webhook token invalid |
| 404 | `VERSION_NOT_FOUND` | Unknown / not-visible version (incl. versions outside an acceptance link's audience scope) |
| 404 | `CUSTOMER_NOT_FOUND` | Unknown customer |
| 404 | `LINK_NOT_FOUND` | Acceptance link unknown/expired/revoked — deliberately uniform (no information leak) |
| 409 | `VERSION_IMMUTABLE` | Mutation of a PUBLISHED/RETIRED version |
| 409 | `ALREADY_ACCEPTED` | Version is already effectively accepted |
| 422 | `VERSION_NOT_CURRENT` | Acceptance of a version that is neither current nor an upcoming (published, future `validFrom`) one |
| 422 | `CHANGE_SUMMARY_REQUIRED` | Publish without a popup change summary |
| 422 | `CONSENT_TEXT_REQUIRED` | Publish of an ACTIVE version without consent text |
| 422 | `UNKNOWN_AUDIENCE` | Unknown/invalid `audience` key |
| 422 | `UNKNOWN_DOCUMENT_TYPE` | Unknown/invalid document `type` key |
| 422 | `DOCUMENT_TYPE_EXTERNAL` | Version/document operation on an `external` document type (use the signed-documents flow) |
| 422 | `DOCUMENT_TYPE_NOT_EXTERNAL` | Signed-document upload targeting a non-external type (use the version/clickwrap flow) |
| 422 | `ROLE_MISMATCH` | Customer does not have the document audience's role |
| 422 | `CONSENT_TEXT_MISMATCH` | Displayed text ≠ versioned consent text |
| 422 | `OBJECTION_NOT_APPLICABLE` | Objection on an ACTIVE version |
| 422 | `OBJECTION_PERIOD_EXPIRED` | Objection after the deadline |
| 422 | `INVALID_STATE` | Invalid state transition / missing required field (reason, evidenceDocument, duplicate document, slug validation, still-referenced category, `PUBLIC_BASE_URL` unset / `expiresInDays` out of range for acceptance links, blank/invalid signer fields) |
| 429 | `RATE_LIMITED` | Hosted acceptance page: per-token rate limit exceeded (20 req/min, in-memory MVP) |
