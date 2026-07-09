# clickwrap-server — Admin UI

React admin web interface for **clickwrap-server**: manage agreement documents
(PDF + metadata), roll out new versions to customers, and review audit-proof
acceptance evidence (active / tacit / import). Target audience: legal /
operations.

Document types and audiences are **dynamic entities** managed from the UI (see
_Settings_), so the app is not tied to any particular set of agreement kinds.

## Stack

- Vite + React 18 + TypeScript (strict)
- MUI (`@mui/material` + `@emotion`) and `@mui/x-data-grid` (**Community**, no Pro license)
- `@tanstack/react-query` (all calls, invalidation after mutations)
- `react-router-dom`, `@react-oauth/google`
- `zod` (response validation)
- **`kubb`** — the typed API client (types + zod + react-query hooks) is generated
  from the backend OpenAPI contract into `src/gen/` (see _API client_ below)
- Custom lightweight i18n layer (no extra dependency)
- Fully responsive / touch-friendly (phones, tablets, desktop)
- Tests: `vitest` + `@testing-library/react` + `msw`

## Setup

```bash
pnpm install
cp .env.example .env          # fill in the values (see below)
pnpm dev                      # http://localhost:5173
```

Scripts:

| Command | Purpose |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | `tsc -b` + `vite build` (must be green) |
| `pnpm test` | Vitest (msw), single run |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm lint` | `tsc --noEmit` |
| `pnpm generate:api` | Regenerate `src/gen/` from `../openapi.admin.json` (kubb) |

## Environment (`.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | ✔ | Base URL of the backend, e.g. `http://localhost:3000` |
| `VITE_GOOGLE_CLIENT_ID` | – | **Deprecated.** Legacy fallback only — the login screen now reads the Google client ID from `GET /admin/auth/methods`. Used only when that endpoint is unavailable (older backend) |
| `VITE_APP_NAME` | – | Brand name shown in the AppBar, page title and login screen (default `clickwrap-server`) |
| `VITE_DEV_ADMIN_TOKEN` | – | Dev fallback; when set, the header `x-admin-token` is also sent. Do NOT set in production |

## Authentication (dynamic login methods)

- On load the login screen calls the **unauthenticated** `GET /admin/auth/methods`
  → `{ methods: [{ key, flow, label, params }] }` and renders one option per
  method:
  - `google` — Google SSO (`@react-oauth/google`); the client ID comes from
    `params.clientId`.
  - `token` — a dev/admin token input; the value is stored and sent as
    `x-admin-token` (and as the session token).
  - `oidc-redirect` — a button linking to `params.authorizeUrl`.
- **Graceful fallback:** if the endpoint is unavailable (older backend) the UI
  falls back to the legacy Google flow using the deprecated
  `VITE_GOOGLE_CLIENT_ID` and logs a console warning.
- The Google **ID token (credential)** / token is kept in memory **and** in
  `sessionStorage` (`src/auth/tokenStore.ts`) and attached as
  `Authorization: Bearer <token>` to **all** API calls (`src/api/client.ts`).
- **401/403** → the token is discarded and the user is returned to `/login`.
- **Dev fallback:** if `VITE_DEV_ADMIN_TOKEN` is set (build-time), the client
  additionally sends `x-admin-token: <token>`. A runtime token from the `token`
  login method takes precedence. Do **not** set this in production.

> When creating a Google OAuth client, add the admin UI origin(s) as
> **Authorized JavaScript origins** — e.g. `http://localhost:5173` for local
> development. The actual authorization (allowed domain / role) is verified by
> the **backend** when it validates the ID token.

## Responsive / mobile

The UI is fully responsive. Below the `md` breakpoint the AppBar navigation
collapses into a hamburger + temporary Drawer (the language switcher and user
menu stay in the bar); the Customers and Documents lists render as
tappable **card lists** instead of the desktop DataGrid; and all dialogs go
**full screen** below `sm`. The responsive breakpoint policy lives in
`src/ui/useIsMobile.ts`.

## Functional scope

- **Login** `/login` — dynamic methods from `GET /admin/auth/methods` (Google
  SSO / dev token / OIDC redirect), with a legacy Google fallback.
- **Dashboard** `/` — per-version acceptance dashboard (`GET /admin/dashboard`):
  one card per current and **upcoming** (scheduled) version of every document,
  with accept/pending/blocked/objected counters and acceptance rate. Clicking a
  card drills into the per-version customer list.
- **Version customers** `/versions/:id` — the drill-down target
  (`GET /admin/versions/:id/customers` + `/stats`): who has (not) accepted **that**
  version, filterable by state, with the matching stats header.
- **Customers** `/customers` — list (display name, external ref, role chips,
  contact e-mails) with pagination (`GET /admin/customers`); **New customer**
  (`POST /admin/customers`) with `firstName`/`lastName` + optional `companyName`,
  roles (from `GET /admin/audiences`), contact e-mail chips and a signed-offer
  **"already accepted documents"** section (`acceptedVersions` IMPORT); **Edit**
  (`PATCH /admin/customers/:id`, firstName/lastName/companyName/roles/contactEmails;
  `externalRef` is immutable).
- **Customer detail** `/customers/:id` — header from `GET /admin/customers/:id`
  (Edit + Record-acceptance actions); an **Agreements & status** section listing
  the customer's per-document/version states (from `GET /admin/customers/:id/history`)
  with the outstanding items and their deadlines — its header action is **"Copy
  acceptance link"** (`POST /admin/customers/:id/acceptance-links`), one permanent
  whole-account link covering all the customer's outstanding agreements; the rest of
  the history (acceptances incl. expandable evidence, objections, notifications); the
  **signed-documents** archive (`GET /admin/customers/:id/signed-documents`) with an
  upload dialog (`POST …/signed-documents`, external document types only); per-item
  actions: extend deadline / suspend block (`PATCH /admin/customer-version-states/:id`,
  mandatory reason), send reminder (`POST …/remind`), manual acceptance
  (`POST /admin/customers/:id/acceptances`, evidence PDF → base64).
- **Documents & versions** `/documents` — `GET /admin/documents` +
  `GET /admin/documents/:id/versions`; **New document**
  (`POST /admin/documents`, type + audience selected from the dynamic
  endpoints); **New version** (multipart field `file` + metadata) → DRAFT;
  delete DRAFT; **Publish** (`POST /admin/versions/:id/publish`) with a
  confirmation dialog showing the `rolloutCustomers` count from the response.
- **E-mail templates** `/email-templates` — manage the admin-managed templates
  (`GET/POST/PATCH/DELETE /admin/email-templates`) per kind
  (`VERSION_NOTIFICATION` / `REMINDER` / `ACCEPTANCE_CONFIRMATION`), authored with
  the embedded Unlayer editor (design JSON + exported HTML), with a sandboxed
  preview (`POST …/:id/preview`). The three built-in default rows are editable but
  not deletable.
- **Settings** `/settings` — manage the dynamic **audiences** and **document
  types**: list, create (key + name, with slug validation — and, for document
  types, the **`external`** flag, settable at creation only), rename (name only;
  the key is immutable), delete (surfacing the `422 INVALID_STATE` "still in use"
  error cleanly). Document-type rows also carry the per-type **e-mail template
  assignments** (notification / reminder selects; `POST …/document-types/:id`
  template fields). Endpoints: `GET/POST /admin/audiences`,
  `PATCH/DELETE /admin/audiences/:id` and the identical `/admin/document-types`
  family. Audience shape `{ id, key, name }`; document-type shape
  `{ id, key, name, external, notificationTemplateId?, reminderTemplateId?, acceptanceConfirmationTemplateId? }`.

## Internationalization (i18n)

A small, dependency-free i18n layer lives in `src/i18n/`:

- **English is the default locale**, German is the secondary one.
- All UI strings are in `src/i18n/en.json` / `de.json` (nested keys, dot paths,
  `{{param}}` interpolation).
- `useTranslation()` returns `{ t, language, setLanguage }`; the language
  switcher is in the AppBar and the choice is persisted to `localStorage`.
- To add a locale: add a `<code>.json` file, register it in
  `src/i18n/index.tsx` (`RESOURCES` + `LANGUAGES`).

## Theming & branding

- **Design tokens** are the single source of truth in `src/theme/tokens.ts`
  (colors, radii, typography, spacing, elevation). `src/theme/theme.ts` maps
  them onto MUI's semantic palette — the only file aware of MUI's theme shape.
- To **re-brand**, adjust the ramps in `tokens.ts` (the default is a neutral
  indigo/teal). The brand **name** is configurable via `VITE_APP_NAME` and the
  **logo/name** appears in the AppBar, page title and login screen.

### Design-system layer `src/ui/`

All pages import UI building blocks **exclusively** from `src/ui/` (Button, Card,
DataTable, TextField/Select, Dialog, PageHeader, StatusChip, Toast), never
directly from `@mui/*`. This adapter layer is the single, central place to swap
the underlying component library: re-point the adapters and the pages stay
unchanged.

## API client

The typed client is **generated with kubb** from the backend contract
(`../openapi.admin.json`) into `src/gen/` (committed): TypeScript types
(`src/gen/types`), zod schemas (`src/gen/zod`) and react-query hooks
(`src/gen/hooks`). Regenerate with `pnpm generate:api`. **Never edit `src/gen/`
by hand** — all types and zod come from there.

- The react-query plugin is configured with a **custom client**
  (`src/api/kubbClient.ts`) that wraps the shared auth behavior: base URL from
  `VITE_API_URL`, `Authorization: Bearer` from the token store, the
  `x-admin-token` dev fallback, 401/403 → logout, and typed error bodies
  `{ code, message }` → `ApiError` (`src/api/errors.ts`, language-neutral; the UI
  translates by error `code` via the i18n `errors.*` namespace). The generated
  hooks validate every response with the generated zod schemas (`parser: 'zod'`).
- `src/api/hooks.ts` provides thin wrappers over the generated hooks — ergonomic
  signatures plus targeted cache invalidation after mutations. Pages import from
  there; types come from `src/gen`.
- `src/api/client.ts` remains the shared fetcher (used by `kubbClient` and for the
  multipart PDF upload).
- The pre-login **login-method discovery** (`GET /admin/auth/methods`) uses a small
  standalone fetcher with a local zod schema (`src/auth/authMethods.ts`) rather than a
  generated hook — it runs before any auth/client bootstrap exists. The endpoint itself
  is part of the committed `openapi.admin.json`.

## What the backend needs (not part of this UI)

- **CORS:** the backend must allow the admin UI origin (including the
  `Authorization` and `x-admin-token` headers, methods `GET/POST/PATCH/DELETE`).
- **Google token verification:** server-side verification of the
  `Bearer <idToken>` (signature, `aud` = client ID, allowed domain) and mapping
  to the admin role. The UI does **not** verify the token (it only decodes
  display claims).
