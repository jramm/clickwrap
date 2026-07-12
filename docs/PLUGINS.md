# Plugin author guide

clickwrap-server is extensible through npm packages: a third party can ship an **e-mail provider**,
a **file storage**, an **admin-auth method**, or an **acceptance-page renderer** as their own
package — without touching this repo. The built-ins (postmark/smtp/noop, memory/local/s3,
google-sso/static-token/supertokens, default) go through the exact same mechanism; there is no
special path.

- SDK contracts: [`src/plugin-sdk/`](../src/plugin-sdk/README.md) (prepared for extraction as a
  published package).
- Working example of a complete third-party package:
  [`test/fixtures/plugins/acme-email/`](../test/fixtures/plugins/acme-email/).

## How discovery works

At boot the host builds a **plugin registry** from four sources (all validated identically):

1. **Built-ins** (`src/plugins/builtins/`).
2. **Installed dependencies**: every entry in the app's `package.json` `dependencies` +
   `devDependencies` whose own package.json carries the manifest field:

   ```json
   { "clickwrap": { "kind": "email-provider" | "file-storage" | "admin-auth" | "acceptance-page" | "admin-notification", "key": "<slug>" } }
   ```

3. **`CLICKWRAP_PLUGIN_PATHS`** — comma-separated local plugin directories (each a package with a
   package.json + main entry), loaded explicitly by path.
4. **`CLICKWRAP_PLUGIN_DIR`** — comma-separated directories that are **scanned**: every immediate
   subdirectory carrying a `"clickwrap"` manifest is loaded. This is the **drop-in / runtime** path
   — no rebuild: take a published image, mount a volume of plugin folders and they are picked up at
   boot. The container images default this to **`/app/plugins`**, so mounting a volume there and
   activating the key via env is all it takes. Subdirs without a manifest are ignored; a missing
   scan dir is a no-op.

   ```bash
   docker run -p 3000:3000 \
     -v /host/my-plugin:/app/plugins/my-plugin:ro \
     -e EMAIL_PROVIDER=my-key \
     ghcr.io/jramm/clickwrap-combined:latest
   ```

   The plugin must be **compiled to JS** (the images ship no TS toolchain) and bring its own deps
   (bundle them, or mount under `/app/…` so the container's `node_modules` is on the resolution
   path). It needs no SDK import — a plain default-export object of the `{ kind, key, create }`
   shape is enough (see below).

Rules:

- The package **main entry must default-export** the plugin (see below); it must match the
  manifest's `kind`/`key`, otherwise the boot fails.
- A **duplicate `(kind, key)`** pair — including a clash with a built-in — is a hard boot error.
- Every loaded plugin is logged one-line (`[PluginRegistry] loaded email-provider plugin "acme" (package @acme/clickwrap-email)`).
- Discovery never activates anything. **Activation is explicit via env:**

  | Env var | Default | Meaning |
  |---|---|---|
  | `EMAIL_PROVIDER` | `noop` | ONE active email-provider key |
  | `FILE_STORAGE` | `memory` | ONE active file-storage key |
  | `ADMIN_AUTH` | `google-sso,static-token` | ORDERED comma list of admin-auth keys |
  | `ACCEPTANCE_PAGE` | `default` | ONE active acceptance-page renderer key |
  | `ADMIN_NOTIFICATIONS` | `email` | ORDERED comma list of admin-notification keys |

  An unknown key fails the boot with the list of available keys.

## The plugin module

```ts
// index.ts — compiled to CommonJS, default export required
import { definePlugin } from '@jramm/clickwrap-plugin-sdk'; // optional — a plain { kind, key, create } object works too

export default definePlugin({
  kind: 'email-provider',
  key: 'acme',
  create(ctx) {
    // ctx.env(name, fallback?) / ctx.requireEnv(name)  — the only way to read configuration
    // ctx.logger.log/warn/error                        — namespaced host logger
    const client = new AcmeClient(ctx.requireEnv('ACME_API_TOKEN'));
    return { async send(mail) { return { providerRef: await client.send(mail) }; } };
  },
  // OPTIONAL: a Nest DynamicModule for plugins that need controllers or scheduled jobs
  // (webhooks, polling, file serving). Mounted ONLY while the plugin is active; its
  // `controllers`, `providers` and `imports` are merged into the host module (`exports` ignored).
  // Requires @nestjs/common as a peer dependency.
  module: () => ({ module: AcmeWebhookModule, controllers: [AcmeWebhookController] }),
});
```

Notes:

- `create(ctx)` is called once at boot and only when the plugin is active. `requireEnv` throws a
  descriptive boot error naming the plugin — use it for everything mandatory.
- The SDK is not required at runtime: the host validates the default export structurally, so a
  plain object of the same shape works (see the acme fixture).
- Host services are injected into plugin controllers via **string DI tokens**
  (`PLUGIN_DI_TOKENS`): `'clickwrap:inbound-delivery-event-sink'` (email) and
  `'clickwrap:file-storage'` (the active storage instance). The active acceptance-page renderer is
  bound to `'clickwrap:acceptance-page'`.

## Kinds and their interfaces

### `email-provider` — `EmailDeliveryProvider`

```ts
interface EmailDeliveryProvider {
  send(mail: {
    to; subject; text; html?;
    attachments?: Array<{ filename: string; contentBase64: string; contentType: string }>;
  }): Promise<{ providerRef: string }>;
  fetchDeliveryStatus?(providerRef): Promise<{ kind: 'delivered' | 'pending' | 'unsupported' }>;
}
```

The `mail` fields:

| Field | Meaning |
|---|---|
| `to` | Recipient address |
| `subject` | Subject line |
| `text` | Plain-text body (always set — derived from the HTML) |
| `html` | Optional HTML body |
| `attachments` | Optional files, each `{ filename, contentBase64, contentType }` (`contentBase64` = base64-encoded content). Used e.g. for the accepted document PDF on the acceptance-confirmation mail. |

A provider that **cannot send attachments must document that it silently ignores** the
`attachments` field (the host still records the send). Postmark maps them to `Attachments`
(`{ Name, Content, ContentType }`), SMTP/nodemailer to `attachments`
(`{ filename, content: Buffer.from(contentBase64, 'base64'), contentType }`), and the `noop`
built-in just logs the filename + byte size.

`providerRef` correlates later delivery/bounce events to the send. Providers with webhooks ship a
controller via `module()` and hand translated `InboundDeliveryEvent`s to the host sink:

```ts
@Controller('webhooks/acme')
class AcmeWebhookController {
  constructor(@Inject('clickwrap:inbound-delivery-event-sink') private readonly sink: InboundDeliveryEventSink) {}
  @Post() async handle(@Body() payload: AcmePayload) {
    await this.sink.handle({ providerRef: payload.id, recipient: payload.to, kind: 'DELIVERED' });
    return { ok: true };
  }
}
```

Delivery events start objection deadlines — but always from **server time**; `occurredAt` from a
payload is informational only. Reference implementation: `src/plugins/builtins/postmark-email.plugin.ts`
(webhook + fallback polling via the optional `fetchDeliveryStatus`).

### `file-storage` — `FileStorage`

```ts
interface FileStorage {
  store(buffer: Buffer, meta: { fileName: string; contentType?: string }): Promise<{ storageKey: string }>;
  getPresignedUrl(storageKey: string): Promise<string>; // time-limited, tamper-proof; ~15 min TTL
  retrieve(storageKey: string): Promise<Buffer>; // load the raw content back (e.g. to attach a PDF)
}
```

- The `storageKey` format is yours (S3 key, generated id, …). The host computes `contentHash`,
  `fileName`, `fileSize` itself — a plugin is never trusted with evidence metadata.
- The same plugin backs **both** blob kinds: clickwrap version PDFs / acceptance evidence **and**
  externally-signed documents (the `SignedDocument` archive). Both go through the identical
  `store` / `getPresignedUrl` (download) / `retrieve` contract and the host-side content hashing —
  a plugin needs no awareness of which kind it is storing.
- `getPresignedUrl` and `retrieve` must reject unknown keys.
- `retrieve` loads the whole file into memory — the host uses it to attach the accepted document PDF
  to the acceptance-confirmation mail.
- The **`s3` built-in** (`src/plugins/builtins/s3-file-storage.plugin.ts` +
  `src/plugins/file-storage/s3/`) stores blobs in an S3 (or S3-compatible, e.g. MinIO) bucket:
  `store` = `PutObject` under a generated `<keyPrefix>/<uuid>` key, `getPresignedUrl` =
  `getSignedUrl(GetObject, { expiresIn: 900 })` (a `HeadObject` first rejects unknown keys),
  `retrieve` = `GetObject` — no `module()` needed, S3 serves the URL itself. Activate with
  `FILE_STORAGE=s3`; env: `FILE_STORAGE_S3_BUCKET` + `FILE_STORAGE_S3_REGION` (required),
  `FILE_STORAGE_S3_ENDPOINT` (optional S3-compatible endpoint → path-style addressing),
  `FILE_STORAGE_S3_ACCESS_KEY_ID`/`FILE_STORAGE_S3_SECRET_ACCESS_KEY` (optional — omit BOTH to use
  the AWS SDK default credential chain, e.g. an IAM role), `FILE_STORAGE_S3_KEY_PREFIX` (optional
  key namespace), `FILE_STORAGE_S3_FORCE_PATH_STYLE` (optional `true`/`false`, overrides the
  endpoint default). Missing bucket/region while active is a boot error.
- The **`local` built-in** (`src/plugins/builtins/local-file-storage.plugin.ts` +
  `src/plugins/file-storage/local/`) is the copyable reference for storages that must serve files
  themselves: generated uuid-only keys (strict pattern check before any fs access), HMAC-signed
  `GET /files/:storageKey?expires&sig` links (secret `FILE_STORAGE_LOCAL_SECRET`, 403 on
  expired/tampered), streaming controller mounted only while active, absolute URLs from
  `PUBLIC_BASE_URL` (relative fallback for same-origin deployments). Single-node only — the disk
  is not replicated.

### `admin-auth` — `AdminAuthStrategy`

```ts
interface AdminAuthStrategy {
  authenticate(req: { headers }): Promise<AdminIdentity | null>; // AdminIdentity = { userId, name? }
  describeLoginMethod(): LoginMethodDescriptor | null;
}
```

The host runs the ACTIVE strategies in `ADMIN_AUTH` order on every `/admin` request: first
non-null identity wins; all null → 401. Throw `AdminAuthError('…')` to abort with a specific 401
message (verified user failing a policy check); return `null` for "not my credential" so later
strategies can claim the request. Never let anything become a 500.

`describeLoginMethod()` is the **frontend contract**: the admin UI calls the unauthenticated
`GET /admin/auth/methods` and renders a login page from `{ methods: LoginMethodDescriptor[] }`:

| `flow` | `params` | The UI… |
|---|---|---|
| `google` | `{ clientId }` | renders Google Identity Services, sends the ID token as `Authorization: Bearer` |
| `token` | `{}` | prompts for a token, sends it as `x-admin-token` (optional `x-admin-user`) |
| `oidc-redirect` | `{ authorizeUrl, clientId? }` | redirects to `authorizeUrl`; the returned access token is sent as `Authorization: Bearer` |

Return `null` to stay unadvertised while still verifying tokens (e.g. `supertokens` without
`SUPERTOKENS_LOGIN_URL`). The Google `clientId` comes from the **backend** env — a frontend-side
`VITE_GOOGLE_CLIENT_ID` is obsolete.

The **`supertokens` built-in** (`src/common/auth/strategies/supertokens.strategy.ts`) is the
copyable reference for JWT/JWKS-style auth: it verifies SuperTokens access tokens
(`Authorization: Bearer`, header-based auth mode) against `SUPERTOKENS_JWKS_URL` with `jose`
(signature, `exp`, optional `SUPERTOKENS_ISSUER`), requires `ADMIN_SUPERTOKENS_ROLE` (default
`admin`) in the `st-role` claim (`{ v: string[] }`, UserRoles recipe), and builds the identity
from `sub` (+ `email`). How the fronting app hands the access token back to the admin UI after the
`SUPERTOKENS_LOGIN_URL` redirect is deployment-specific — e.g. a shared-domain setup where
SuperTokens header-based auth exposes the access token to the UI, or a small token relay page.

### `acceptance-page` — `AcceptancePageRenderer`

```ts
type AcceptancePageLang = 'en' | 'de';

interface AcceptancePageRenderer {
  renderAcceptPage(view: AcceptancePageView, lang: AcceptancePageLang): string; // 200
  renderNotFoundPage(lang: AcceptancePageLang): string;                         // 404
}
```

The renderer of the customer-facing **hosted acceptance page** (`GET /accept/:token`). It is a pure
**HTML-renderer contract**: given the host-assembled, provider-agnostic `AcceptancePageView` (the
customer name, the signer prefill and the pending `items[]` — each with `versionId`, `documentType`,
`audience`, `versionLabel`, `changeSummary`, `pdfUrl`, `mode`, `consentText`, `deadlineAt`,
`blocking`, `upcoming`, `validFrom`), it returns a complete HTML document. There is **no redirect and
no new JSON API** — the host resolves the capability token, records the access proof (deadlines
start), rate-limits, and processes the acceptance write, all server-side; a renderer only produces
markup. `renderNotFoundPage` renders the uniform page for unknown/expired/revoked tokens (never
reveals whether the token existed). Both methods must be pure — no I/O, no token handling.

The view-model types (`AcceptancePageView`, `AcceptancePageItem`, `AcceptancePageLang`) are the
**stable SDK contract** — import them from the SDK and type your renderer against them.

The **`default` built-in** (`src/plugins/builtins/default-acceptance-page.plugin.ts` +
`src/plugins/acceptance-page/default/`) is the current server-rendered page (inline CSS/JS,
mobile-first, self-contained) and the selected default (`ACCEPTANCE_PAGE=default`).

#### Writing a custom (org-branded) renderer

To render the page with your own client UI (e.g. your own component library), ship an `acceptance-page`
plugin whose `renderAcceptPage` returns a **shell that hands the view-model to your client app** —
the capability-token flow stays server-side, so no new API is needed:

1. **Embed the view-model as JSON** in a `<script type="application/json">` tag (escape `</` so it
   can't terminate the block or inject markup) — use `renderEmbeddedView(view)` from the SDK's
   `accept-client` entry so the client can read it back with `readEmbeddedView()`.
2. **Load your client assets.** Either reference an external host
   (`<script src="https://your-ui.example/…">`), inline the bundle, or — to keep them same-origin
   and cacheable — let the backend serve them: set **`ACCEPT_ASSETS_DIR`** to your plugin's built
   asset directory and the container serves it at **`/accept-assets`**, so the renderer references
   `<script src="/accept-assets/app.js">`. (Off by default; the built-in page is self-contained.)
3. **Mount your client app**, which reads the embedded `AcceptancePageView` and renders the cards, the signer
   block and the accept controls in your design system.
4. **Accept/object via the SDK client — you don't need to know the HTTP contract.** Import
   `createAcceptanceClient` from `@jramm/clickwrap-plugin-sdk/accept-client`; it derives the
   endpoints from the page URL, sets the `Idempotency-Key`, and maps `{ code, message }` errors to a
   typed outcome:

   ```ts
   import { createAcceptanceClient, readEmbeddedView } from '@jramm/clickwrap-plugin-sdk/accept-client';
   const view = readEmbeddedView();                       // the embedded AcceptancePageView
   const client = createAcceptanceClient();               // basePath defaults to /accept/<token>
   const r = await client.accept({ versionId, displayedConsentText, signerName, signerEmail });
   if (!r.ok && r.code === 'ALREADY_ACCEPTED') { /* … */ }   // typed result + error codes
   await client.object({ versionId, reason, signerName, signerEmail });
   ```

   (Under the hood it POSTs to `/accept/:token/acceptances` and `…/objections` — the same contract
   the default page uses; `displayedConsentText` is omitted for a `PASSIVE` early acceptance.)

Activate it with `ACCEPTANCE_PAGE=<key>`. A minimal skeleton:

```ts
export default definePlugin({
  kind: 'acceptance-page',
  key: 'custom-ui',
  create() {
    return {
      renderAcceptPage(view, lang) {
        const json = JSON.stringify(view).replace(/</g, '\\u003c');
        return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
          <link rel="stylesheet" href="https://your-ui.example/accept.css"></head><body>
          <div id="accept-root"></div>
          <script type="application/json" id="accept-view">${json}</script>
          <script src="https://your-ui.example/accept.js"></script></body></html>`;
      },
      renderNotFoundPage(lang) {
        return `<!doctype html><html lang="${lang}"><body>…link not available…</body></html>`;
      },
    };
  },
});
```

### `admin-notification` — `AdminNotifier`

Notifies admins/operators about noteworthy events — the first trigger is a customer **objection
(Widerspruch)**. Several notifiers can be ACTIVE at once (`ADMIN_NOTIFICATIONS`, ordered); the host
fans one `AdminNotification` out to all of them and **isolates failures per notifier**, so a broken
Slack/HubSpot/e-mail call never blocks the objection.

```ts
interface AdminNotifier {
  notify(notification: AdminNotification): Promise<void>; // best-effort; catch your own transport errors
}
// AdminNotification: { event: 'OBJECTION_RAISED', title, body, customerId, customerName?, versionId,
//                      versionLabel?, documentType?, audience?, reason?, occurredAt }
```

Built-ins:
- **`email`** — sends `title`/`body` to `ADMIN_NOTIFICATION_EMAIL` through the active e-mail provider
  (reuses the `email-provider` plugin; skipped with a warning when the recipient is unset). Because
  it depends on that host-provided provider it is wired host-side, not via `create(ctx)`.
- **`slack`** / **`hubspot`** — self-contained transports (see their env config).

An external notifier package is a normal plugin: `definePlugin({ kind: 'admin-notification', key,
create(ctx) })`, returning an object with `notify()`. Read transport config (webhook URLs, tokens)
from `ctx.env`.

## The SDK package

The types + `definePlugin` are published as **`@jramm/clickwrap-plugin-sdk`** on the public npm
registry (built from `src/plugin-sdk/` by `scripts/build-sdk.mjs`, released on a `v*` tag). Depend on
it for type safety — a plugin needs it only at build time, never at runtime (the host validates
default exports structurally). No registry config needed:

```bash
npm i -D @jramm/clickwrap-plugin-sdk @nestjs/common   # @nestjs/common only for plugins that ship a module()
```

## Local development, publishing, activating

```bash
# 1. Develop locally — no publish needed:
CLICKWRAP_PLUGIN_PATHS=/path/to/my-plugin EMAIL_PROVIDER=my-key pnpm start:dev

# 2. Ship it: either publish your plugin to a registry (manifest in package.json), or just build it
#    to JS and drop it into a running container's plugin dir (default /app/plugins) — no rebuild.
npm publish

# 3. Consumers install and activate it:
pnpm add @acme/clickwrap-email
EMAIL_PROVIDER=acme            # + the plugin's own env (ACME_API_TOKEN=…)
```

Test the boot: the registry logs your plugin; an invalid export, a manifest mismatch or a
duplicate key fails the boot with a descriptive error (see `test/plugin-discovery.spec.ts` for the
exact behavior).

## Using a published plugin package (no source clone, no clickwrap rebuild)

Once your plugin is published to a registry (npm / GitHub Packages), consume it as a **package** —
you never clone or mount its source. Pick one:

**A. Derived image (recommended — immutable, version-pinned).** A ~3-line image `FROM` a clickwrap
image installs the package into the scan dir; the registry's `node_modules` scan picks it up:

```dockerfile
FROM ghcr.io/jramm/clickwrap-combined:0.2.0
# (private registry? add an .npmrc/token here). --prefix keeps it out of the app's own node_modules.
RUN npm install --prefix /app/plugins @acme/clickwrap-email
ENV EMAIL_PROVIDER=acme            # activate it (+ the plugin's own env, e.g. ACME_API_TOKEN)
```

**B. No image build — install into a mounted volume at runtime.** Pre-install the package into a
volume (host, CI, or an initContainer) and mount it at the scan dir (`/app/plugins`):

```bash
npm install --prefix ./clickwrap-plugins @acme/clickwrap-email     # once, anywhere
docker run -p 3000:3000 \
  -v "$PWD/clickwrap-plugins:/app/plugins:ro" \
  -e EMAIL_PROVIDER=acme \
  ghcr.io/jramm/clickwrap-combined:0.2.0
```

Both drop `@acme/clickwrap-email` (and its deps) into `/app/plugins/node_modules`, which `CLICKWRAP_PLUGIN_DIR`
(default `/app/plugins`) scans — the package is loaded by its manifest, its deps resolve locally, and
activation is the usual env var. No source beside the container.
