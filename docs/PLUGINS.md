# Plugin author guide

clickwrap-server is extensible through npm packages: a third party can ship an **e-mail provider**,
a **file storage**, or an **admin-auth method** as their own package — without touching this repo.
The built-ins (postmark/smtp/noop, memory/local, google-sso/static-token/supertokens) go through
the exact same mechanism; there is no special path.

- SDK contracts: [`src/plugin-sdk/`](../src/plugin-sdk/README.md) (prepared for extraction as a
  published package).
- Working example of a complete third-party package:
  [`test/fixtures/plugins/acme-email/`](../test/fixtures/plugins/acme-email/).

## How discovery works

At boot the host builds a **plugin registry** from three sources (all validated identically):

1. **Built-ins** (`src/plugins/builtins/`).
2. **Installed dependencies**: every entry in the app's `package.json` `dependencies` +
   `devDependencies` whose own package.json carries the manifest field:

   ```json
   { "clickwrap": { "kind": "email-provider" | "file-storage" | "admin-auth" | "customer-source", "key": "<slug>" } }
   ```

3. **`CLICKWRAP_PLUGIN_PATHS`** — comma-separated local directories (each a package with a
   package.json + main entry). For development and test fixtures.

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
  | `CUSTOMER_SOURCE` | `none` | ONE active customer-source key (`none` = sync disabled) |

  An unknown key fails the boot with the list of available keys.

## The plugin module

```ts
// index.ts — compiled to CommonJS, default export required
import { definePlugin } from '@clickwrap/plugin-sdk'; // until published: copy the types or export a plain object

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
  `'clickwrap:file-storage'` (the active storage instance).

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
- An **S3 plugin** is `store` = `PutObject`, `getPresignedUrl` = `getSignedUrl(GetObject, { expiresIn: 900 })`,
  `retrieve` = `GetObject` — no `module()` needed, S3 serves the URL itself.
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

### `customer-source` — `CustomerSource`

```ts
interface ExternalCustomer {
  externalRef: string;      // stable id from the source — the reconciliation key
  firstName?: string;
  lastName?: string;
  companyName?: string;
  contactEmails: string[];
}
interface CustomerSourceSnapshot {
  customers: ExternalCustomer[];    // FULL current set of ACTIVE source customers
  deletedExternalRefs?: string[];   // optional explicit deletions (explicit deletion wins)
}
interface CustomerSource { fetchAll(): Promise<CustomerSourceSnapshot>; }
```

The read side of the **scheduled customer sync** (`CustomerSyncService`, cron every 12h). The host
fetches the full snapshot and reconciles it into clickwrap, scoped strictly to customers tagged with
the active source key (`Customer.source`): create new (`CUSTOMER_CREATED`), update changed identity
fields — `firstName`/`lastName`/`companyName`/`contactEmails` only, never roles (`CUSTOMER_UPDATED`),
reactivate a soft-deleted customer that reappears (`CUSTOMER_UPDATED`), and **soft-delete** (preserve
the evidence chain) source-managed customers that disappeared or are listed in `deletedExternalRefs`
(`CUSTOMER_DELETED`). Manually-created (`source='manual'`) customers are never touched. The reconcile
is idempotent (an unchanged snapshot produces zero writes/events) with per-record error isolation.

Activation + config:

| Env var | Default | Meaning |
|---|---|---|
| `CUSTOMER_SOURCE` | `none` | ONE active customer-source key; `none` (built-in) reports an empty snapshot ⇒ sync disabled |
| `CUSTOMER_SYNC_DEFAULT_ROLES` | *(empty)* | Comma-separated audience keys assigned to newly-created customers (empty ⇒ no roles ⇒ no rollout) |
| `CUSTOMER_SYNC_ENABLED` | `true` | Kill switch (mirrors `SWEEPER_ENABLED`); `false` disables the cron |

A real adapter is an ordinary `customer-source` plugin (`create(ctx)` returns a `CustomerSource`
doing the HTTP + auth + field mapping), activated via `CUSTOMER_SOURCE=<its-key>`.

#### `metergrid` built-in

Set `CUSTOMER_SOURCE=metergrid` (plus the vars below) to enable the 12-hourly sync against the
metergrid partner API. It authenticates with SuperTokens in cookie mode (`POST /auth/signin`,
emailpassword recipe), then pulls the full active customer set in a single
`POST /api/configurator/customers?skip_total_items=true` call and maps each record to an
`ExternalCustomer` (`id`→`externalRef`, `companyName`, `contactPerson.firstName/lastName`, and the
unique trimmed non-empty `contactPerson.email` + `email` as `contactEmails`). Deletion is by absence
— the snapshot carries no `deletedExternalRefs`; the reconcile engine soft-deletes source-managed
customers that disappear.

| Env var | Default | Meaning |
|---|---|---|
| `METERGRID_BASE_URL` | `https://api-partners.metergrid.de` | Partner API base URL |
| `METERGRID_USERNAME` | *(required)* | Service-account e-mail — boot error if missing |
| `METERGRID_PASSWORD` | *(required)* | Service-account password — boot error if missing; never logged |

Use a **dedicated service account** rather than a personal login. The password is never included in
any error message or log line. Reference implementation:
`src/plugins/customer-source/metergrid/metergrid.source.ts` (+ the built-in
`src/plugins/builtins/metergrid-customer-source.plugin.ts`).

## Local development, publishing, activating

```bash
# 1. Develop locally — no publish needed:
CLICKWRAP_PLUGIN_PATHS=/path/to/my-plugin EMAIL_PROVIDER=my-key pnpm start:dev

# 2. Publish to npm (any registry), with the manifest in package.json:
npm publish

# 3. Consumers install and activate it:
pnpm add @acme/clickwrap-email
EMAIL_PROVIDER=acme            # + the plugin's own env (ACME_API_TOKEN=…)
```

Test the boot: the registry logs your plugin; an invalid export, a manifest mismatch or a
duplicate key fails the boot with a descriptive error (see `test/plugin-discovery.spec.ts` for the
exact behavior).
