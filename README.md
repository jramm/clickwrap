# clickwrap-server

[![CI](https://github.com/jramm/clickwrap/actions/workflows/ci.yml/badge.svg)](https://github.com/jramm/clickwrap/actions/workflows/ci.yml)

A self-hosted **legal signed document service** — for provable acceptance of versioned agreements
(terms of service, data processing agreements, privacy policies, or any contract document you need
your users to accept and you need to prove they did) **and** for archiving documents that were
signed externally (e.g. counter-signed offers) as immutable per-customer evidence.

For the acceptance side it supports two modes side by side:

- **Active click-consent** — the user explicitly checks a box / clicks "I agree". The exact
  consent text shown is versioned and stored as part of the evidence.
- **Passive tacit acceptance** — a new version is considered accepted unless the user objects
  within an objection period. Crucially, **that period only starts on provable access** (an
  e-mail delivery confirmation, or a confirmed in-app popup display), never on publish alone.

Downstream applications ask a single **compliance-gate API** — "is this customer allowed in?" —
and get a `compliant: true|false` answer with per-document detail. Everything is backed by an
append-only **evidence chain** (who accepted what version, when, from which IP/user-agent, against
which exact consent text and document hash).

Document types (e.g. `terms`, `dpa`) and audiences (e.g. `customer`, `partner`) are declared in a
**configuration file** (`config/legal-entities.json`, JSON) that is the single source of truth and
is **reconciled into the store at every boot** — so the legal-entity state is reproducible and
consistent, and the admin UI lists them **read-only** (see
[`docs/PERSISTENCE.md §Legal-entities configuration`](docs/PERSISTENCE.md)). A document type can be
marked **external**: external types skip the whole
clickwrap machinery and instead accept **externally-signed PDFs uploaded per customer** — a pure
evidence archive that never touches the compliance gate. E-mail delivery, file storage and admin auth are **plugins** discovered from installed npm
packages (Postmark/SMTP/no-op, in-memory/local-disk storage, Google SSO/static token/SuperTokens
built in — see [`docs/PLUGINS.md`](docs/PLUGINS.md)), and an **admin web UI** is included for
legal/operations staff.

License: **Apache-2.0**.

---

## Features

- **Versioned agreement documents** — one document per (type × audience), with an immutable
  version history (DRAFT → PUBLISHED → RETIRED). Each version carries a PDF, a `versionLabel`, a
  change summary, a content hash, and — for active mode — the exact consent text.
- **Two acceptance modes** — `ACTIVE` (click-consent with an **absolute** acceptance deadline
  `hardDeadlineAt`: every customer must accept by that calendar date or is blocked, independent of
  access) and `PASSIVE` (tacit acceptance with a per-customer objection period from delivery).
- **Externally-signed documents** — document types flagged `external` skip versions/publish/gate;
  instead already-signed PDFs (e.g. counter-signed offers) are uploaded per customer via the admin
  or integration API as immutable, append-only evidence (with a host-computed content hash, signer,
  reference and signature date). They appear in the customer history but are **never** part of the
  compliance gate.
- **PASSIVE deadlines start on provable access only** — the objection period begins when access is
  proven (e-mail `Delivery` webhook, delivery polling, or a confirmed popup display), not when a
  version is published; a PASSIVE customer who never accessed is never tacit-booked. **ACTIVE uses
  an absolute hard deadline** stamped at rollout — it applies to all customers regardless of access.
- **Compliance-gate API** — `GET /customers/:id/compliance` returns a single boolean plus
  per-document detail; the intended integration point for portals and tools.
- **Append-only evidence chain** — acceptances, objections and notification events are immutable
  (enforced by DB privileges in the Prisma driver), with corrections modelled as new rows.
- **Config-driven audiences & document types** — declared in `config/legal-entities.json` and
  reconciled into the store at every boot (create/update + delete-only-if-unused); no code change or
  enum migration to add a new agreement kind, and no divergence between environments. The admin
  surface for these is read-only.
- **Managed e-mail templates, per document type** — rollout notification, reminder and
  acceptance-confirmation mails are rendered from admin-managed templates, selectable **per document
  type** (so `terms` and `dpa` can use different wording). Templates are authored in the admin UI
  with the Unlayer drag-and-drop editor (design JSON + exported HTML stored) and support
  `{{placeholders}}` (`{{firstName}}`/`{{lastName}}`/`{{companyName}}`/`{{customerName}}`, document
  details, `{{acceptedAt}}`, a permanent acceptance link, the public PDF link `{{documentPdfUrl}}`,
  app name). The three built-in default templates (one per kind) ship as real, editable rows and are
  used whenever a document type has no assignment. See [`docs/API.md §2a`](docs/API.md).
  *Trade-off: the template **editor** iframe loads from
  Unlayer's CDN, so authoring needs internet access and a third-party (free-tier) service; sending
  and rendering do not — the stored HTML is self-contained.*
- **Acceptance-confirmation e-mails with the signed PDF attached** — every real acceptance
  (`ACTIVE_CONSENT` via portal/link/admin, and `TACIT` booked by the sweeper — never bulk `IMPORT`)
  triggers a confirmation mail rendered from the per-document-type `ACCEPTANCE_CONFIRMATION` template,
  carrying the accepted document as a PDF attachment. Delivery is best-effort and never fails the
  acceptance itself. See [`docs/INTEGRATION.md §6b`](docs/INTEGRATION.md).
- **Permanent acceptance links in mails** — the `{{acceptanceLink}}` placeholder resolves to a
  per-customer, non-expiring (but revocable) hosted-acceptance link so notification/reminder mails
  never go stale; only the token's hash is stored at rest. See
  [`docs/INTEGRATION.md §6a`](docs/INTEGRATION.md).
- **Plugin architecture** — e-mail delivery, file storage, admin auth and the customer source are
  plugins, auto-discovered from installed npm packages (built-ins: `postmark`/`smtp`/`noop`,
  `memory`/`local`, `google-sso`/`static-token`/`supertokens`) and activated explicitly via env.
  Third parties ship their own provider as an npm package — see
  [`docs/PLUGINS.md`](docs/PLUGINS.md).
  The default `none` source keeps the sync disabled.
- **Scheduled effectiveness ("publish now, effective later")** — one or more versions may be
  published with a future `validFrom` (several future revisions can be scheduled simultaneously —
  they surface as the `upcomingVersions[]` array): the rollout happens immediately, so acceptance
  can be collected in advance (popup and hosted page mark such items as `upcoming`), while the
  current version stays the compliance baseline until the flip at the nearest `validFrom`. The
  hourly activation sweep then retires the predecessor and supersedes its open states. Deadlines of
  a not-yet-effective version are
  anchored at `max(notifiedAt + period, validFrom)` — recipients always get the full
  objection/grace window and nothing blocks or is tacitly booked before the version is in force.
- **Stable public document URLs** — `GET /documents/<type>/<audience>/latest.pdf` (no auth)
  302-redirects to the currently effective published PDF; the URL is deterministic from the
  document keys, so a link rendered into an offer stays valid across future publishes.
- **Background jobs** — hourly activation sweep (scheduled-effectiveness flip at `validFrom`) and
  deadline sweeper (tacit acceptance / hard block on expiry), daily reminders (7 and 2 days
  before a deadline), and Postmark fallback delivery polling.
- **Hosted acceptance page** — the server itself serves a mobile-first acceptance page under
  `/accept/<token>`: an admin mints a link in the UI ("copy acceptance link" in the agreements
  section of the customer detail page) and sends it directly to the person who has to accept — no
  portal integration required. The link
  token is a capability (only its SHA-256 is stored, expiry/revocation supported); the signer's
  identity is self-declared (typed name + e-mail) and recorded as such in the evidence chain.
  Rendering the page counts as provable access, so deadlines start exactly like with the popup.
- **Legal event / audit log** — a single normalized, chronological (newest-first), paginated,
  filterable **Events** list (`GET /admin/events`) backed by a dedicated, append-only `Event` table
  the core writes on each successful action (dual-write via `EventRecorder`, alongside the unchanged
  evidence/audit stores) so a legal user can trace, for the whole system or one customer, which
  e-mails were sent/delivered/bounced to whom & when, who accessed/viewed what, when agreements were
  accepted/objected, and every admin/system action. Filter by customer, date range, category
  (COMMUNICATION / ACCESS / CONSENT / ADMINISTRATION), document type or version.
  **Every state-changing action produces an event** — including the automatic (cron/webhook)
  transitions: passive/tacit acceptance and deadline expiry (deadline sweeper), scheduled version
  activation / retirement and block carry-over (activation sweeper), and e-mail delivery/bounce
  (provider webhook). The full event-type catalogue (grouped by category, with which are
  system/cron-driven) is in [docs/API.md](docs/API.md#event-catalogue-traceability-guarantee).
- **Admin web UI** — React + Google SSO front end for managing documents, versions, rollouts,
  the per-version acceptance dashboard, per-customer history, the legal event log, manual
  (back-dated) recording, acceptance links, and the dynamic categories. See [`admin-ui/`](admin-ui/).
- **Two persistence drivers** — an in-memory driver (no database, starts instantly, for
  dev/demo/tests) and a PostgreSQL driver via Prisma.

---

## Architecture

The backend is a [NestJS](https://nestjs.com/) application built around a **pure domain core**
with a **ports-and-adapters** boundary:

```
            HTTP controllers (agreements, consent, compliance, admin, webhooks)
                                      │
        application services (use-cases: publish, accept, object, sweep, remind, …)
                                      │
   ┌──────────────────────────────────┴──────────────────────────────────┐
   │  pure domain (src/domain/)                                           │
   │  state machine · consent rules · compliance rules · clock            │
   │  no NestJS / no Prisma imports · time only via an injected Clock      │
   └──────────────────────────────────┬──────────────────────────────────┘
                                      │  ports (repository interfaces)
                      ┌───────────────┴───────────────┐
              in-memory driver                   Prisma / PostgreSQL driver
        (src/persistence/inmemory)          (src/persistence/prisma)
```

- **`src/domain/`** — pure transition functions (state machine, consent/compliance rules); no
  framework imports; all time comes from an injected `Clock`.
- **Ports** — repository interfaces in `src/domain/ports.ts`. Both persistence drivers implement
  the same ports; the driver is chosen at boot via `REPOSITORY_DRIVER`.
- **Plugin SDK & registry** — `src/plugin-sdk/` defines the plugin contracts (e-mail provider,
  file storage, admin auth, customer source); `src/plugins/registry/` discovers plugins in the installed
  dependencies (package.json `"clickwrap"` manifest) and `CLICKWRAP_PLUGIN_PATHS`. Built-ins live
  in `src/plugins/builtins/` and use the same mechanism. Activation is explicit:
  `EMAIL_PROVIDER`, `FILE_STORAGE`, `ADMIN_AUTH`.

See [`docs/API.md`](docs/API.md) for the HTTP API, [`docs/INTEGRATION.md`](docs/INTEGRATION.md)
for the integrator guide (service-to-service surface), [`docs/PLUGINS.md`](docs/PLUGINS.md) for
the plugin author guide, and [`docs/PERSISTENCE.md`](docs/PERSISTENCE.md)
for the schema and database details.

---

## Quickstart

Requirements: Node.js 20+, [pnpm](https://pnpm.io/). Commands below assume `pnpm` on your PATH.

### 1. Run with the in-memory driver (no database)

```bash
pnpm install
cp .env.example .env          # defaults are fine: REPOSITORY_DRIVER=inmemory, EMAIL_PROVIDER=noop
pnpm start:dev                # http://localhost:3000 (.env is loaded via dotenv)
```

The in-memory driver starts without Postgres and keeps nothing across restarts — ideal for a
first look, demos, and the test suite.

Load a small example dataset (a few documents, versions and customers). The audiences
`customer`/`partner` and document types `terms`/`dpa` are not created by the seed — they come from
`config/legal-entities.json`, reconciled at boot:

```bash
pnpm seed-example
```

### 2. Run with PostgreSQL (Prisma driver)

```bash
docker compose up -d          # local Postgres (user/password/db: clickwrap)

DATABASE_URL=postgresql://clickwrap:clickwrap@localhost:5432/clickwrap \
  pnpm prisma migrate dev --name init

# Apply the post-migration SQL (partial unique index + append-only REVOKEs).
# Run this after every migrate deploy. app_role = the app runtime role (locally: clickwrap).
psql "postgresql://clickwrap:clickwrap@localhost:5432/clickwrap" \
  -v app_role=clickwrap -f prisma/partial-indexes.sql

REPOSITORY_DRIVER=prisma \
DATABASE_URL=postgresql://clickwrap:clickwrap@localhost:5432/clickwrap \
  pnpm start:dev
```

`partial-indexes.sql` ships the two things Prisma cannot express declaratively: the partial unique
index enforcing "exactly one effective acceptance per (customer, version)", and append-only
enforcement (`REVOKE UPDATE, DELETE`) on the evidence tables. See
[`docs/PERSISTENCE.md`](docs/PERSISTENCE.md), including the note on separating the migration/owner
role from the app runtime role in staging/production.

---

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)):

| Variable | Default | Description |
|---|---|---|
| `REPOSITORY_DRIVER` | `inmemory` | `inmemory` (no DB, nothing persists) or `prisma` (PostgreSQL). |
| `DATABASE_URL` | – | PostgreSQL connection string; required for `REPOSITORY_DRIVER=prisma`. |
| `LEGAL_ENTITIES_CONFIG` | `config/legal-entities.json` | Path to the JSON config declaring audiences + document types (reconciled at boot). A missing/malformed file fails the boot. |
| `PORT` | `3000` | HTTP port. |
| `CLICKWRAP_PLUGIN_PATHS` | – | Comma-separated local plugin directories (development/fixtures; see [`docs/PLUGINS.md`](docs/PLUGINS.md)). |
| `EMAIL_PROVIDER` | `noop` | E-mail delivery plugin key. Built-ins: `postmark`, `smtp`, `noop`. |
| `EMAIL_FROM` | – | Sender address; **required** for `postmark` and `smtp` (no hardcoded fallback). |
| `POSTMARK_API_TOKEN` | – | Postmark server token; empty = no real sending, fake provider refs. |
| `POSTMARK_WEBHOOK_TOKEN` | – | Token header expected on `POST /webhooks/postmark` (403 on mismatch). |
| `SMTP_HOST` | `localhost` | SMTP host (`EMAIL_PROVIDER=smtp`). |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_SECURE` | `false` | `true` = implicit TLS (port 465). |
| `SMTP_USER` | – | SMTP username; empty = no auth. |
| `SMTP_PASS` | – | SMTP password. |
| `FILE_STORAGE` | `memory` | File-storage plugin key. Built-ins: `memory` (nothing persists), `local` (server disk, single-node). |
| `FILE_STORAGE_LOCAL_DIR` | – | **Required** for `FILE_STORAGE=local`: blob directory (created recursively). |
| `FILE_STORAGE_LOCAL_SECRET` | – | **Required** for `FILE_STORAGE=local`: HMAC secret for the time-limited `/files` links. |
| `PUBLIC_BASE_URL` | – | Absolute public base URL of this service. Used for `/files` links (empty = relative, same-origin only) and **required** for minting hosted acceptance links (`/accept/<token>` URLs). |
| `ADMIN_AUTH` | `google-sso,static-token` | Ordered admin-auth plugin keys; the first strategy returning an identity wins. |
| `ADMIN_API_TOKEN` | `change-me` | `static-token` strategy (`x-admin-token`, dev/CI); empty = disabled. |
| `SERVICE_API_TOKEN` | `change-me` | Service-to-service token (`x-service-token`) for the `/customers/**` API. |
| `GOOGLE_CLIENT_ID` | – | `google-sso` strategy: OAuth 2.0 client ID; empty = Bearer path disabled. Served to the UI via `GET /admin/auth/methods` — a frontend-side `VITE_GOOGLE_CLIENT_ID` is obsolete. |
| `ADMIN_ALLOWED_DOMAIN` | – | Required for Google SSO: admin e-mail must end in `@<domain>`. |
| `ADMIN_ALLOWED_EMAILS` | – | Optional comma-separated exact allowlist, in addition to the domain. |
| `SUPERTOKENS_JWKS_URL` | – | `supertokens` strategy: JWKS endpoint of the SuperTokens core; **required** when active. |
| `SUPERTOKENS_ISSUER` | – | Optional issuer check for SuperTokens access tokens. |
| `SUPERTOKENS_LOGIN_URL` | – | Optional login URL advertised as the `oidc-redirect` method; empty = verify-only. |
| `ADMIN_SUPERTOKENS_ROLE` | `admin` | Role required in the SuperTokens `st-role` claim. |
| `ADMIN_UI_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Comma-separated CORS origins of the admin UI (vite dev + preview ports); empty = CORS off (a bootstrap warning is logged). |
| `SWEEPER_ENABLED` | `true` | Kill switch for the background sweeper. |
| `OPENAPI_DOCS_ENABLED` | `false` | `true` = serve Swagger UIs at `/docs/admin` and `/docs/integration`. |

The server, the seed script and `pnpm openapi` load `.env` automatically (dotenv).

### OpenAPI specs

`pnpm openapi` regenerates the two committed OpenAPI 3 documents at the repo root:
[`openapi.admin.json`](openapi.admin.json) (admin surface, source for the admin-UI client) and
[`openapi.integration.json`](openapi.integration.json) (service-to-service surface, see
[`docs/INTEGRATION.md`](docs/INTEGRATION.md)). Re-run it whenever controllers or DTOs change and
commit the result.

---

## Plugins

E-mail delivery, file storage and admin auth are plugins. They are auto-discovered from the
installed dependencies (any package whose package.json carries a
`"clickwrap": { "kind", "key" }` manifest) plus local `CLICKWRAP_PLUGIN_PATHS` directories, and
activated explicitly via `EMAIL_PROVIDER`, `FILE_STORAGE` and `ADMIN_AUTH`. Built-ins register
through the exact same mechanism. A third party ships a provider as their own npm package —
implement the SDK interface, `pnpm add` it, set the env var. The full author guide (manifest,
`definePlugin`, kind interfaces, login-method flows, local development, publishing) is in
[`docs/PLUGINS.md`](docs/PLUGINS.md); the SDK contracts live in
[`src/plugin-sdk/`](src/plugin-sdk/README.md).

E-mail providers without delivery tracking (`smtp`, `noop`) can send but not confirm delivery; in
those modes the PASSIVE objection period starts exclusively via the in-app popup access confirmation
(`POST /customers/:id/notifications`). ACTIVE blocking is unaffected — its hard deadline is absolute
and independent of access.

---

## API overview

- **`/admin/**`** — document & version management, publish/rollout, the per-version acceptance
  dashboard, per-customer history, the legal event log (`GET /admin/events`), manual recording,
  deadline/block admin actions, and the **read-only** audiences / document-types list routes
  (`GET /admin/audiences`, `GET /admin/document-types` — these are managed via
  `config/legal-entities.json`; there are no create/update/delete routes). Auth: the active
  `ADMIN_AUTH` strategies (default: Google SSO
  Bearer token or the `x-admin-token` dev fallback). `GET /admin/auth/methods` is the
  unauthenticated login-method discovery for the admin UI login page.
- **`/customers/:id/**`** — the service-to-service surface for downstream tools: the compliance
  gate, pending agreements (popup content), and recording acceptances / objections /
  notifications. Auth: `x-service-token` + forwarded context headers.
- **`/accept/:token`** — the hosted acceptance page (server-rendered HTML + its JSON acceptance
  endpoint). No service token: the capability link token in the URL is the authentication;
  invalid/expired/revoked tokens render a uniform 404.
- **`/documents/:type/:audience/latest.pdf`** — public, unauthenticated 302 redirect to the
  currently effective published PDF of that document (stable URL for offers/templates); every
  miss is a uniform 404.
- **`/webhooks/postmark`** — delivery/bounce webhook (only mounted when `EMAIL_PROVIDER=postmark`).

Full request/response shapes and the complete error-code table are in
[`docs/API.md`](docs/API.md).

---

## Admin UI

A React admin web interface lives in [`admin-ui/`](admin-ui/) (Vite + React + TypeScript + MUI).
It authenticates via Google SSO and drives the `/admin/**` API: per-version acceptance dashboard,
document/version management with PDF upload and publish, a customers list with per-row compliance
indicator and document-type / audience / compliance-status filters that **narrow the list** to the
assigned/role-matching customers (fully replacing the former
global Overview page), per-customer history with expandable
evidence, a filterable legal **Events** log (`/events`, with a per-customer activity section on the
detail page), manual
acceptance, deadline extension / block suspension, reminders, and a **read-only** view of the
audiences and document types (managed via `config/legal-entities.json`). See
[`admin-ui/README.md`](admin-ui/README.md) for setup.

---

## Testing

```bash
# Backend
pnpm test           # Jest unit suite (uses the in-memory driver; no DB needed)
pnpm lint           # tsc --noEmit
pnpm build          # tsc production build

# Admin UI
cd admin-ui && pnpm test && pnpm build
```

The Prisma repository tests (`*.prisma.spec.ts`) are excluded from the default unit run and require
a real Postgres instance; see [`docs/PERSISTENCE.md`](docs/PERSISTENCE.md) for how to run them.

---

## Known limitations

- **No cross-repo transaction.** Recording an acceptance writes the evidence row and the state
  transition as two separate repo calls; the invariants are protected independently (conditional
  state update, partial unique index, idempotency store) but there is no single unit of work yet.
- **Service-to-service auth is a shared-secret seam.** The `/customers/**` API trusts a static
  `SERVICE_API_TOKEN` plus forwarded context headers; production deployments should move this to
  mTLS/JWT.
- **The hosted acceptance page rate limit is in-memory** (per link token, 20 requests/minute,
  single node). Multi-node deployments need a shared limiter; link revocation currently has no
  admin endpoint (revoke via DB / repo).
- **CSV export and customer self-service endpoints** are not implemented.

---

## Deployment

A multi-stage `Dockerfile` builds the backend and the admin UI:

```bash
docker build -t clickwrap-server .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://clickwrap:clickwrap@db:5432/clickwrap \
  -e REPOSITORY_DRIVER=prisma \
  -e ADMIN_AUTH=google-sso,static-token \
  -e GOOGLE_CLIENT_ID=... -e ADMIN_ALLOWED_DOMAIN=example.com \
  -e SERVICE_API_TOKEN=... -e ACCEPTANCE_LINK_SECRET=... \
  -e PUBLIC_BASE_URL=https://clickwrap.example.com \
  -e EMAIL_PROVIDER=postmark -e POSTMARK_API_TOKEN=... -e EMAIL_FROM=legal@example.com \
  clickwrap-server
```

Apply `prisma db push`/migrations plus `prisma/partial-indexes.sql` against the database before the
first start (see Quickstart). The admin UI production build ships inside the image at
`/app/admin-ui-dist` — serve it with any static host or reverse proxy (it is a plain SPA; set
`VITE_API_URL` as a build arg when the API origin differs). The backend deliberately does not serve
static files.

CI (GitHub Actions) runs on every push/PR: backend lint/unit/build, **Prisma integration tests
against a real Postgres 16 service container** (verifying the partial-unique-index and
atomic-transition guarantees), OpenAPI/kubb drift checks, and the admin-ui suite.

## Releasing

Tag a version to publish: `git tag v0.1.0 && git push --tags` — the release workflow builds and
pushes `ghcr.io/jramm/clickwrap` (version + latest) and creates a GitHub release with the two OpenAPI
specs attached.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup, the TDD workflow and conventions
([`CONVENTIONS.md`](CONVENTIONS.md)), and PR expectations. Security issues: see
[`SECURITY.md`](SECURITY.md).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
Copyright 2026 metergrid GmbH.
