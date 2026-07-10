# clickwrap-server — integrator guide (service-to-service API)

This guide is for the **calling tools** (portals, backends) that gate access on agreement
compliance and record consent on behalf of their users. The machine-readable contract is the
committed [`openapi.integration.json`](../openapi.integration.json) (regenerate with
`pnpm openapi`); with `OPENAPI_DOCS_ENABLED=true` the running service also serves a Swagger UI at
`/docs/integration`. The admin surface is documented separately
([`openapi.admin.json`](../openapi.admin.json), [API.md](API.md)).

---

## 1. Authentication

All integration routes share one secret: header **`x-service-token`** = `SERVICE_API_TOKEN`
(timing-safe comparison; this is an MVP seam — move to SSO/mTLS for production).

Two flavours:

| Routes | Extra headers | Why |
|---|---|---|
| `/customers/:customerId/**` (compliance, pending, consent writes) | **`x-customer-id`** (required, must equal the path id) + `x-actor-user-id` (required), `x-actor-name`, `x-actor-email`, `x-actor-role` (optional) | The calling backend authenticates its own users and forwards the **verified** context. Actor and customer NEVER come from the body — bodies with actor fields are rejected (400, strict schemas). |
| `POST /customers` (onboarding) | optional `x-actor-*` (defaults to actor `service`) | No customer exists yet, so there is no customer context to forward. |

Mismatched path/context customer → `403 FORBIDDEN`. Errors are always `{ "code", "message" }`
(codes: [API.md §7](API.md#7-error-codes-complete)).

## 2. Onboard a customer — `POST /customers` → 201

Create the customer the moment it appears in your CRM — typically right after a **signed offer**.
Versions the customer already accepted on paper are recorded in the same call:

```json
{
  "externalRef": "crm-4711",
  "firstName": "Jane",
  "lastName": "Doe",
  "companyName": "Acme GmbH",
  "roles": ["customer"],
  "contactEmails": ["legal@acme.example"],
  "acceptedVersions": [
    { "versionId": "v-9", "acceptedAt": "2026-07-01T00:00:00Z",
      "reference": "HubSpot deal 12345 / signed offer" }
  ]
}
```

- `firstName`/`lastName` (contact person) and `companyName` (optional) are all optional; the
  derived display name (`{{customerName}}`) is `companyName` when set, else `firstName lastName`.
- `roles` are audience keys and are validated (`422 UNKNOWN_AUDIENCE`).
- **Creation triggers an onboarding rollout**: for every current published version — and every
  **upcoming** one (published with a future `validFrom`, see §4a) — covered by `roles` and not
  covered by an `acceptedVersions` import, a `PENDING_NOTIFICATION` state is created — the
  customer immediately appears in pending-agreements (your popup and the hosted acceptance page)
  instead of waiting for the next publish. Like a publish, the onboarding rollout **sends an
  acceptance-notification e-mail** per newly rolled-out version (skipped for versions covered by an
  `acceptedVersions` import and for customers without contact e-mails); deadlines still start only
  with the first provable access. The same applies when a role is **added** later
  (`PATCH /admin/customers/:id`); removing a role takes effect on the next publish only.
- If an import covers only an **old (retired) version**, the current version still becomes
  `PENDING_NOTIFICATION` — the customer is asked to accept the current revision right away.
- `contactEmails` receive rollout/reminder mail; empty = the customer shows up as "unreachable".
- `acceptedVersions` becomes `IMPORT` acceptances (channel `ADMIN`) with an immediate `ACCEPTED`
  state: `acceptedAt` may be backdated to the signature date, `reference` is stored as evidence
  (`evidenceNote`). The version must be PUBLISHED (or RETIRED, if it was superseded between
  signing and onboarding) and covered by `roles` (`422 ROLE_MISMATCH`). Validation is atomic — on
  any error nothing is created.
- **201** returns the customer plus `importedAcceptances: [{ versionId, acceptanceId }]`.
- `externalRef` is unique **only among customers with overlapping roles**: the partner and customer
  external ID spaces are separate, so the same `externalRef` may legitimately exist on a partner
  record and a customer record at the same time. A duplicate that **shares at least one role**
  returns `422 INVALID_STATE`, which doubles as the idempotency signal **per overlapping role set**
  when you retry. If your systems can reuse an ID across audiences, use a **distinct ref per
  audience space** (or `GET` first) so a retry maps to exactly one record; adding a role via
  `PATCH` is likewise rejected if it would overlap another record sharing the ref.

## 2a. Push a provider-group customer — `PUT` / `DELETE /customers/by-external-ref/:externalRef`

For an upstream system that owns a set of customers and wants to keep clickwrap in sync by
**pushing** changes (clickwrap is DOWNSTREAM — it never pulls), use the two idempotent endpoints
below. Auth: the shared `x-service-token` only (no `x-customer-id`); the optional `x-actor-*`
headers name the acting user for the audit/evidence trail. All writes are recorded as **SYSTEM**
actions.

Both endpoints resolve the record by **(`externalRef`, `audience`)**, not by `source`. In clickwrap
an `externalRef` is only unique **in combination with an audience** (the partner and customer
external ID spaces are separate — see §2): two customers may share an `externalRef` as long as
their `roles` do not overlap. The target is therefore the record carrying `externalRef` whose
`roles` **overlap** the request's audience/roles; a different-audience customer sharing the same
`externalRef` is never touched. `source` is a **provenance tag stored on create only** — it is not
part of the lookup.

### `PUT /customers/by-external-ref/:externalRef` → 200 (idempotent upsert)

Body:
```json
{ "firstName": "Jane", "lastName": "Doe", "companyName": "Acme GmbH",
  "contactEmails": ["legal@acme.example"], "roles": ["customer"], "source": "mainportal" }
```
- `contactEmails` and `roles` are required; `firstName`/`lastName`/`companyName` are optional; a PUT
  is a full representation of the identity fields (an omitted `firstName`/`lastName` normalises to
  `''`, an omitted `companyName` clears it). `source` defaults to `external` and is stored as a
  provenance tag only.
- `roles` are audience keys and are validated (`422 UNKNOWN_AUDIENCE`); e-mails are validated
  (`422 INVALID_STATE`). Unknown body fields → `400` (strict schema — no actor in the body).
- Behaviour, resolved by (`externalRef`, `audience`) = the record whose `roles` overlap the body's
  `roles`, **including soft-deleted** records:
  - **no overlapping match** → CREATE → `CUSTOMER_CREATED`;
  - **soft-deleted match** → REACTIVATE (clear `deletedAt`) + apply fields → `CUSTOMER_UPDATED`;
  - **active match, something changed** → UPDATE the changed fields → `CUSTOMER_UPDATED`;
  - **active match, nothing changed** → **no write, no event** (roles/e-mails are compared
    order-insensitively, so re-sending an identical payload is a true no-op).
- **200** returns the customer row (`{ id, externalRef, firstName, lastName, companyName?, roles,
  contactEmails, deletedAt? }`).

### `DELETE /customers/by-external-ref/:externalRef?audience=…` → 204 (idempotent deactivate)

Used when an upstream provider group is merged away. The **required `?audience=`** query param names
the audience whose record is deactivated (the resolution discriminator). **Soft-deletes** the active
customer carrying `externalRef` whose `roles` include `audience` (`deletedAt` set →
`CUSTOMER_DELETED`) — the evidence chain is preserved (never a hard delete). A different-audience
customer sharing the same `externalRef` is left untouched. Not found or already deactivated →
idempotent no-op (no event). Always returns **204 No Content**. Missing `audience` → `400`.

These two endpoints REPLACE the pull-based customer sync as the integration mechanism for the main
portal.

### `GET /customers/by-external-ref/:externalRef/compliance?audience=…` → 200 (compliance by external ref)

The compliance gate for a caller that only knows the customer by its own external reference (not
clickwrap's internal id). Auth: the shared `x-service-token` only (no `x-customer-id`). The
**required `?audience=`** query param is both the resolution discriminator and the compliance scope:
the ACTIVE customer carrying `externalRef` whose `roles` include `audience` is resolved, then the
same result as [§3](#3-gate-access--get-customersidcomplianceaudience) is returned unchanged
(`{ compliant, details, … }`).

- Errors: `404 CUSTOMER_NOT_FOUND` when no active customer matches (unknown/soft-deleted
  `externalRef`+`audience`, or a same-`externalRef` record of a different audience); `422
  UNKNOWN_AUDIENCE`; `400` if `audience` is missing; `401` without the service token.
- **Fail-open contract.** The metergrid Main Portal queries this endpoint **live per request (no
  cache)** and **FAILS OPEN**: any clickwrap error/timeout **OR a `404`** is treated as *compliant*
  (access is never blocked on it). clickwrap returns the real compliance result or a `404` — it
  never guesses. Only an explicit `compliant: false` blocks.

### `GET /customers/by-external-ref/:externalRef/pending-agreements?audience=…` → 200 (outstanding agreements by external ref)

The outstanding-agreements feed for a caller that only knows the customer by its own external
reference (not clickwrap's internal id). Auth: the shared `x-service-token` only (no
`x-customer-id`). The **required `?audience=`** query param is the resolution discriminator: the
ACTIVE customer carrying `externalRef` whose `roles` include `audience` is resolved, then the same
result as [§4](#4-show-the-popup--get-customersidpending-agreementsaudience) is returned unchanged
(the open items — `type`/`documentType`, `audience`, `versionId`, `versionLabel`, `changeSummary`,
presigned `pdfUrl`, `mode`, `deadlineAt?`, `blocking`, `upcoming`, `validFrom`; `[]` = nothing to
show).

This is what backs the metergrid Main Portal (**Betreiberportal**) **native accept overlay**: the
portal renders the outstanding AGBs itself with `mg-ui` from this response instead of embedding the
hosted page.

- Errors: `404 CUSTOMER_NOT_FOUND` when no active customer matches (unknown/soft-deleted
  `externalRef`+`audience`, or a same-`externalRef` record of a different audience); `422
  UNKNOWN_AUDIENCE`; `400` if `audience` is missing; `401` without the service token.

### `POST /customers/by-external-ref/:externalRef/acceptances?audience=…` → 201 (record acceptance by external ref)

Records the portal user's acceptance from the native overlay for a caller that only knows the
customer by its external reference. Auth: the shared `x-service-token` only (no `x-customer-id`) plus
the **`Idempotency-Key`** header (as in the per-customerId accept flow). The **required
`?audience=`** query param resolves the ACTIVE customer by (`externalRef`, `audience`); the
acceptance is then recorded through the **same** `AcceptanceService` as
[§5](#5-report-display--record-consent) — same idempotency, version-current check and consent-text
rules.

```json
{ "versionId": "v-9", "signerName": "Bob Portal", "signerEmail": "bob@operator.example",
  "displayedConsentText": "I have read the new revision and agree." }
```

- The **actor/identity** is the Betreiberportal user the Main Portal passes: `signerName`/
  `signerEmail` in the body take precedence, falling back to the forwarded `x-actor-*` headers; the
  recorded `channel` is `PORTAL`.
- ACTIVE versions **require** `displayedConsentText` (cross-checked against the server-side text →
  `422 CONSENT_TEXT_MISMATCH`); PASSIVE early acceptances omit it. The server-side `consentText` is
  always authoritative. Unknown body fields → `400` (strict schema).
- **201** returns `{ "acceptanceId", "state": "ACCEPTED" }`; a replay with the same
  `Idempotency-Key` returns the identical response.
- Errors: `404 CUSTOMER_NOT_FOUND` (no active match) / `404 VERSION_NOT_FOUND`; `422
  VERSION_NOT_CURRENT · CONSENT_TEXT_MISMATCH · ROLE_MISMATCH · UNKNOWN_AUDIENCE`; `400` if
  `audience` or `Idempotency-Key` is missing; `409 ALREADY_ACCEPTED`; `401` without the service
  token.

## 3. Gate access — `GET /customers/:id/compliance?audience=…`

Query with **your** audience key. `compliant=false` only for `EXPIRED_BLOCKING` (or a blocking
carry-over) — pending items alone never block. Recommended: check on login and periodically
(≤ 15 min) per session, invalidate immediately after an acceptance, fail-open with the last
cached result on outage.

## 4. Show the popup — `GET /customers/:id/pending-agreements?audience=…`

Returns the open items (empty array = show nothing) with `versionLabel`, `changeSummary`,
presigned `pdfUrl` (15-minute TTL — do not cache), `mode`, `deadlineAt`, `blocking`, `upcoming`
and `validFrom`. `blocking=true` → show the block screen; accepting lifts the block immediately.
`upcoming=true` → see §4a; render the item with its `validFrom` (e.g. "valid from 2026-08-01").

## 4a. Scheduled effectiveness — upcoming versions & advance acceptance

A version may be **published with a future `validFrom`** ("publish now, effective later"). What
that means for integrators:

- **Multiple upcoming versions are supported.** More than one future version may be scheduled at
  the same time (e.g. an August and an October revision). The documents list exposes them as the
  `upcomingVersions` **array** (ordered by `validFrom` ascending), the dashboard emits an entry per
  upcoming version, and each appears in the pending list and hosted page — not just the nearest one.
- **Current + all upcoming can be open at once.** The pending list then contains the current version
  (`upcoming: false`) AND every upcoming one (`upcoming: true`, each with its `validFrom`). The
  current version remains the compliance baseline — `GET /compliance` keeps requiring it until the flip.
- **Advance acceptance is valid.** `POST /customers/:id/acceptances` accepts the current version
  **or ANY** upcoming one (the nearest or a far-future one alike); anything else is
  `422 VERSION_NOT_CURRENT`. Collecting the acceptance of an upcoming version before its `validFrom`
  means the customer is already covered when the flip happens.
- **The flip is automatic and one-by-one.** At each `validFrom` the compliance baseline switches to
  that version (server time); the hourly activation sweep retires the predecessor, closes its open
  states as SUPERSEDED (no tacit acceptance is ever booked for them afterwards) and carries an
  existing hard block over to the new version's state. With several futures the nearest becomes
  current at its `validFrom` while later ones stay upcoming until their own `validFrom`.
- **Deadlines never bite before `validFrom`.** For states of a not-yet-effective version the
  deadline is `max(notifiedAt + objection/grace period, validFrom)` — recipients always get the
  full window, and nothing can block or be tacitly accepted before the version is in force.

## 4b. Externally-signed documents — clickwrap vs. signed-document types

The service supports two kinds of document, distinguished by the document type's `external` flag
(set once at creation, admin API):

- **Clickwrap types (`external: false`, default).** Versioned PDFs the customer must *accept*
  (active consent or tacit) — the flow described in §3–§5, driving the compliance gate.
- **Externally-signed types (`external: true`).** Documents that were signed *outside* the system
  (e.g. a counter-signed offer, a wet-ink contract). There is no acceptance flow — you simply
  **upload the signed PDF** as immutable evidence. These are a pure archive: they **never** affect
  `GET /compliance`, the pending popup or deadlines.

### Upload a signed document — `POST /customers/:id/signed-documents` → 201

Auth: the shared `x-service-token` (no `x-customer-id` needed — the customer is in the path). The
uploader is taken from the forwarded `x-actor-*` headers (recorded as `uploadedBy`), never the body.

`multipart/form-data` (field `file`) or base64 JSON (`file` + `fileName`) — same convention as the
admin version upload. Metadata: `documentTypeKey` (required, **must be an external type** — a
non-external type → `422 DOCUMENT_TYPE_NOT_EXTERNAL`), `signedAt` (required, ISO — backdatable to
the real signature date), `signerName?`, `reference?` (e.g. `"HubSpot deal 12345"`), `audience?`,
`note?`. Unknown customer → `404 CUSTOMER_NOT_FOUND`; unknown type → `422 UNKNOWN_DOCUMENT_TYPE`.

201 returns the created record with a presigned `pdfUrl` and a host-computed `contentHash`
(`sha256:…`). The record is append-only — a correction is a new upload, not an edit.

### List — `GET /customers/:id/signed-documents`

`{ items: [...] }`, newest first (each with a fresh presigned `pdfUrl`).

## 5. Report display & record consent

1. `POST /customers/:id/notifications` `{ "versionId", "channel": "PORTAL" }` → 200 — proof the
   popup was displayed; starts the objection/grace deadline (server time, idempotent).
2. ACTIVE versions: `POST /customers/:id/acceptances` `{ "versionId", "displayedConsentText" }`
   with an **`Idempotency-Key` header** → 201. The displayed text is cross-checked against the
   server-side versioned consent text (`422 CONSENT_TEXT_MISMATCH`); replays with the same key
   return the identical response.
3. PASSIVE versions: the user may object within the period —
   `POST /customers/:id/objections` `{ "versionId", "reason" }` (+ `Idempotency-Key`) → 201.

## 6. No integration at all? The hosted acceptance page (`/accept/<token>`)

If a customer's users never touch an integrated portal (or you have not built the popup yet),
the service itself can collect the consent: an admin mints an **acceptance link** in the admin UI
("copy acceptance link" in the agreements section of the customer detail page, backed by
`POST /admin/customers/:id/acceptance-links`) and sends the URL directly to the person who has to
accept. The recipient opens `${PUBLIC_BASE_URL}/accept/<token>` on any device and accepts there —
zero code on your side. Details: [API.md §5a](API.md#5a-hosted-acceptance-page-accept--no-integration-required).

The signer's **name** field is pre-filled from the customer's `firstName`/`lastName` and the
**e-mail** field from the customer's first contact e-mail; when a `companyName` is known it is shown
as context ("On behalf of …"). Both fields stay **editable** — the recorded signer identity is still
self-declared, the prefill is a convenience only and does not change the evidence semantics.

Security model, in short:

- **The link token is a capability** — possession of the URL is the authentication. Treat it like
  a password when forwarding it; it is 32 random bytes, only its SHA-256 is stored server-side,
  and unknown/expired/revoked tokens all render the same 404 page.
- **Expiry & revocation** — links expire (default 30 days, max 365) and can be revoked
  server-side (`revokedAt`); both render the uniform 404 afterwards.
- **Self-declared identity** — unlike the portal path there is no authenticated user: the signer
  types their name and e-mail. The evidence records the actor as `link:<linkId>` plus the typed
  identity AND an `evidenceNote` ("identity self-declared via acceptance link …"), so a hosted-page
  acceptance is never mistaken for a verified portal identity. Everything else in the evidence
  chain (server-side consent text, hashes, IP/UA, server timestamps) is identical.
- **Deadlines** — rendering the page is provable access (`NotificationEvent channel=LINK`), so
  objection/grace periods start exactly like with the popup display report.

Compliance results are shared: an acceptance collected via the hosted page immediately shows up
in your `GET /customers/:id/compliance` gate.

### 6a. Permanent acceptance links in rollout/reminder mails

Rollout notification and reminder e-mails can embed the `{{acceptanceLink}}` placeholder. This
resolves to the customer's **one permanent acceptance link** — a hosted-acceptance URL that, unlike
the admin-minted links above, **never expires**, so the same URL stays valid across every future
mail. It is created lazily (once per customer, reused afterwards) and shares the hosted-page flow,
evidence model and self-declared identity described above.

Security trade-off (deliberate):

- **Permanent capability.** The URL is a non-expiring capability — anyone with it can open the
  page. It is still fully **revocable** server-side (`revokedAt`), after which it renders the uniform
  404 like any other link.
- **Hash at rest.** As with all links, only the token's SHA-256 is stored — the raw token is never
  persisted. The token is derived deterministically via HMAC from a server secret
  (`ACCEPTANCE_LINK_SECRET`) and the customer id, so the same URL can be re-injected into every mail
  without storing it. Set a strong `ACCEPTANCE_LINK_SECRET` in production (a dev fallback is used when
  unset, which makes the tokens predictable); rotating it invalidates all existing permanent links.
- **Rate limiting** on the hosted page applies unchanged.

The `{{documentPdfUrl}}` placeholder is the stable public latest-PDF link from §7. Both variables
render empty when `PUBLIC_BASE_URL` is unset.

### 6b. Acceptance-confirmation e-mails

On acceptance the service e-mails the customer a confirmation with the **accepted document attached
as a PDF**, rendered from the per-document-type `ACCEPTANCE_CONFIRMATION` template (falling back to
the built-in `tpl-default-acceptance-confirmation` row). The template supports the `{{acceptedAt}}`
and `{{documentPdfUrl}}` placeholders in addition to the usual set.

**When it is sent** (the trigger rule):

- method **`ACTIVE_CONSENT`** — portal popup (channel `PORTAL`), hosted acceptance page (`LINK`) and
  admin manual recording (`ADMIN`); and
- method **`TACIT`** — booked by the deadline sweeper (`SYSTEM`).
- **Never** for method **`IMPORT`** (bulk / out-of-band onboarding acceptances get no confirmation).

**Recipient:** the accepting actor's e-mail if present (portal actor / hosted-page self-declared
signer), otherwise all of the customer's `contactEmails`. A customer with neither is skipped (a
warning is logged). Delivery is **best-effort**: a failure to render/attach/send is logged and never
fails the acceptance itself. The attachment requires the active `FileStorage` plugin to support
`retrieve` (all built-ins do; an S3 plugin uses `GetObject`).

## 7. Public documents — a stable PDF link for offers

`GET ${PUBLIC_BASE_URL}/documents/<type>/<audience>/latest.pdf` (no auth, no token) 302-redirects
to a fresh presigned URL of the **currently effective** published version — never an upcoming one:
an offer must reference what is in force at signing time. The URL is deterministic from the
document keys, so it stays valid across every future publish.

**Setup:** render `${PUBLIC_BASE_URL}/documents/<type>/<audience>/latest.pdf` into your offer
templates (the admin UI offers "copy public PDF link" per document). The signature on the offer is
the **implicit acceptance** of the referenced document — close the loop by importing it on
onboarding: create the customer via `POST /customers` with `acceptedVersions` pointing at the
version that was in force at signing time (see §2). Unknown type/audience/document or no effective
published version → uniform 404; the endpoint is side-effect-free (no notification/state/evidence
writes).

## 8. Postmark webhook — `POST /webhooks/postmark`

Only relevant when you operate the service with `EMAIL_PROVIDER=postmark`: point Postmark's
Delivery/Bounce webhooks here with the `token` header = `POSTMARK_WEBHOOK_TOKEN`. Delivery events
start deadlines; bounces escalate "unreachable". Everything else is answered 200 no-op.
