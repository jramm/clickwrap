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
  instead of waiting for the next publish. No e-mails are sent by this rollout; deadlines start
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
("copy acceptance link" on the overview page, backed by
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
