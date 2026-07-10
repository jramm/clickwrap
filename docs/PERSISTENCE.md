# Persistence — clickwrap-server

Short documentation for the Prisma schema (`prisma/schema.prisma`), the post-migration script
(`prisma/partial-indexes.sql`) and the local Postgres environment (`docker-compose.yml`).

## Legal-entities configuration (audiences + document types)

Audiences and document types are **not** UI-managed CRUD entities. They are declared in a
**JSON configuration file** that is the single source of truth and is **reconciled into the store on
every boot** (for both the in-memory and Prisma drivers, and in the real server, the seed script and
the boot tests). This makes the legal-entity state reproducible and consistent across environments.

- **File:** `config/legal-entities.json` (path overridable via env `LEGAL_ENTITIES_CONFIG`). Shape:

  ```json
  {
    "audiences":     [{ "key": "customer", "name": "Customers" }],
    "documentTypes": [{ "key": "terms", "name": "Terms of Service", "external": false,
                        "notificationTemplateId": null, "reminderTemplateId": null,
                        "acceptanceConfirmationTemplateId": null }]
  }
  ```

  The three template-id fields are optional (absent or `null` ⇒ the built-in default template of that
  kind is used); `external` is optional and defaults to `false`. `key` must be a slug
  (`[a-z0-9-]{2,32}`, the same rule as `src/domain/keys.ts`).

- **Validation (fail-fast):** the file is loaded + validated with Zod
  (`src/legal-entities/legal-entities.config.ts`). A missing file, invalid JSON, or a schema
  violation (missing field, bad slug, wrong type, unknown extra key) **fails the boot** with a clear
  error — an inconsistent legal-entity state must never start serving.

- **Reconciler** (`src/legal-entities/legal-entities.reconciler.ts`, an `OnApplicationBootstrap`
  step wired via `LegalEntitiesModule`; audiences before document types):
  - **upsert by key** every config entry — create the missing ones (new id), update a changed
    `name` / `external` / template-id, keeping the stored **id stable** (look up by key first);
  - for each stored entity whose key is **not** in the config: `deleteIfUnused(key)`. An entity still
    referenced (by a document, or a customer role for audiences) is **kept and logged as a WARNING** —
    never hard-deleted;
  - logs a concise summary (created/updated/kept/deleted counts). **Idempotent:** a second boot with
    the same config performs no writes.

- **Admin surface is read-only:** only `GET /admin/audiences` and `GET /admin/document-types` remain;
  the create/update/delete routes were removed, and the admin-ui Settings page lists these entities
  read-only with a "managed via configuration file" note. To change an audience or document type
  (including its e-mail-template assignments), edit `config/legal-entities.json` and restart.

## Schema decisions

- **IDs:** `String @id @default(cuid())` for all models (standard for NestJS+Prisma services).
- **Dynamic entities instead of enums:** rather than hardcoding document types and audiences as
  database enums (e.g. `DocumentType { TERMS, DPA }`, `Audience { CUSTOMER, PARTNER }`), they are
  modelled as data-driven entities:
  - `DocumentTypeDef { id, key, name, external, notificationTemplateId?, reminderTemplateId?, acceptanceConfirmationTemplateId? }`
    — e.g. key `terms`, `dpa`. `external` (default `false`) splits the two document worlds:
    `false` = the clickwrap version/publish/acceptance flow, `true` = externally-signed documents
    uploaded per customer (`SignedDocument`, no versions/gate); it is settable at creation only and
    immutable afterwards. The three optional template ids are the per-type e-mail template
    assignments (see the `EmailTemplate` note below), validated app-side with no FK.
  - `Audience { id, key, name }` — e.g. key `customer`, `partner`.
  `key` is a URL-safe slug (`[a-z0-9-]{2,32}`, validated in the application layer via
  `src/domain/keys.ts`) and unique per entity (`@unique`).
- **Key reference WITHOUT foreign keys (deliberate):** `AgreementDocument.type`/`.audience` and
  `Customer.roles` store the entity keys as plain strings. `Customer.roles` is a Postgres
  string array — an FK is technically impossible there; adding an FK only on
  `AgreementDocument` would make the integrity guarantees uneven and complicate key handling.
  Referential integrity is enforced in the application layer instead:
  - Using an unknown key raises `UNKNOWN_DOCUMENT_TYPE` / `UNKNOWN_AUDIENCE` (422).
  - `AudienceRepo.deleteIfUnused` / `DocumentTypeRepo.deleteIfUnused` refuse to delete an
    entity that is still referenced (documents' `type`/`audience`, customers' `roles`).
  The check-then-delete in `deleteIfUnused` is not transactional; a concurrent insert of a
  referencing row can race it. This is acceptable for an admin-only, low-frequency operation.
- **Compliance detail keys** are built from the dynamic keys via
  `src/domain/keys.ts::detailKey(typeKey, audienceKey)` → `TYPE_AUDIENCE`, uppercased.
  Collision-free because keys are slugs (never contain `_`).
- **`Acceptance` has no hard `@@unique([customerId, versionId])`:** deliberately only a normal
  `@@index` in the schema. The invariant "exactly one effective acceptance" is enforced as a
  **partial** unique index (`WHERE "isEffective"`) via `prisma/partial-indexes.sql` — Prisma
  does not support partial indexes declaratively. Without this, the append-only correction
  (old entry `isEffective=false` + new entry) would be impossible.
- **Append-only via DB privileges, not just convention:** `Acceptance`, `Objection`,
  `NotificationEvent` (and additionally `AdminAuditLog`, see below) have no `updatedAt` and are
  locked after migration via `REVOKE UPDATE, DELETE` for the app runtime role. The Prisma
  schema itself cannot express DB privileges.
- **`AgreementVersion` immutability after publish** is **not** enforced by a DB constraint but
  by application logic (`PATCH` only for `status=DRAFT`, error code `409 VERSION_IMMUTABLE`) —
  the table must stay writable for DRAFT editing; a table-wide `REVOKE UPDATE` like on the
  evidence tables would be wrong here.
- **Self-reference `Acceptance.supersededByAcceptanceId`:** modelled as an optional 1:1
  relation (`@unique` on the FK field) — exactly one predecessor per superseding acceptance,
  matching the correction chain.
- **`Customer.roles` as a Postgres array** (`String[]` of audience keys) instead of a join
  table — sufficient for the requirement (few values, no role metadata needed).
- **Customer identity is `firstName`/`lastName` (contact person) + optional `companyName`**
  (`firstName`/`lastName` default `''` when unknown; `companyName` nullable). There is no stored
  `name` column: the display label is *derived* (`src/domain/customer.ts::customerDisplayName` —
  `companyName` when set, else `firstName lastName`) and surfaced as `{{customerName}}` in mails and
  as `customerName` in dashboard / per-version customer rows.
- **`Customer.externalRef` is NOT `@unique` — only `@@index([externalRef])`:** the external ID
  spaces of partners and customers are separate, so the same `externalRef` may legitimately appear
  on a partner record and a customer record (different entities). Uniqueness is therefore
  *overlap-aware*: an `externalRef` must be unique only among customers that share at least one
  role (audience key). A conditional "unique per overlapping array element" cannot be expressed as a
  Postgres constraint (the roles live in an array), so the check is enforced in the application
  layer (`CustomerAdminService.assertExternalRefUniqueForRoles`, run on create and on a role-adding
  PATCH). Like the `deleteIfUnused` reference checks above, this check-then-write is not
  transactional; a concurrent create/update with the same ref and an overlapping role could in
  theory race it. Acceptable — customer onboarding is a low-frequency admin/integration operation.
- **`actorUserId` is required** on `Acceptance`/`Objection` (not optional) — matches
  `src/common/auth/actor.ts::Actor` where only `name`/`email`/`portalRole` are optional but
  `userId` is always set. For `TACIT`/`SYSTEM` bookings (sweeper) the application layer
  supplies a defined system actor `userId` (e.g. `"system:sweeper"`).
- **Hot-path indexes:**
  - `CustomerVersionState @@index([customerId, state])` — compliance lookup (target ≤ 50 ms).
  - `CustomerVersionState @@index([state, deadlineAt])` — deadline sweeper (daily).
  - `NotificationEvent @@index([providerRef])` — Postmark webhook correlation via MessageID.
  - `AgreementVersion @@index([documentId, status, validFrom])` for determining the
    "applicable revision", plus indexes on `Acceptance`/`Objection` for per-customer/version
    history queries.

## Deviations / additions (for review)

- **`CustomerVersionState.lastReminderAt`** (in addition to `remindersSent`): a pure counter
  does not allow the reminder job ("7 and 2 days before `deadlineAt`") to idempotently detect
  *whether* the 7-day or the 2-day reminder was already sent, so `lastReminderAt` was added.
- **`AdminAuditLog` additionally append-only via REVOKE:** an audit log is subject to the same
  audit-safety requirement, so it is locked in `partial-indexes.sql` as well. If that is not
  desired, simply remove the corresponding `REVOKE` line.
- **`AgreementVersion.consentText`/PDF immutability** is deliberately **not** enforced via a DB
  trigger or REVOKE (see above) — only documented. An alternative would be a `BEFORE UPDATE`
  trigger rejecting changes to `PUBLISHED`/`RETIRED` rows.
- No dedicated DB constraint for "at most one `PUBLISHED` version per `AgreementDocument`"
  (publish sets the predecessor version to `RETIRED`) — that is a use-case flow (two writes),
  not a data-integrity case warranting a DB constraint.

## Schema ↔ domain model alignment

Alignment of `prisma/schema.prisma` against `src/domain/types.ts` + `src/domain/ports.ts`:

- **`CustomerVersionState.carryOverBlocking`** (`Boolean @default(false)`) — block carry-over;
  the application layer sets `true` on publish/rollout when the predecessor state was
  `EXPIRED_BLOCKING`.
- **`Acceptance.contentHash` stays required in the schema** although the domain type declares
  it optional. Rationale: an acceptance without a content hash is worthless as audit evidence —
  the Prisma mapping layer (`persistence/prisma/mappers/acceptance.mapper.ts::toCreateData`)
  therefore ALWAYS fills the field (fallback `''` if the domain exceptionally provides none).
- All remaining enums (`VersionStatus`, `AcceptanceMode`, `RolloutState` ↔
  `CustomerVersionStateValue`, `AcceptanceMethod`, `AcceptanceChannel`, `ObjectionResolution`,
  `NotificationChannel`) are value-identical with the domain union types. Fields that exist
  only in the schema (`createdAt`/`updatedAt`, relation fields, `lastReminderAt`,
  `AdminAuditLog` as a whole) are pure infrastructure/audit fields — the mappers in
  `persistence/prisma/mappers/*.ts` omit them on read and never write them.

## Prisma repository layer (`src/persistence/prisma/`)

All domain ports from `src/domain/ports.ts` are implemented, one file per port + one mapper
under `mappers/` (domain ↔ Prisma cleanly separated, see `CONVENTIONS.md`):

| Port | Repo class | Mapper |
| --- | --- | --- |
| `AudienceRepo` | `audience.repo.ts` | `mappers/audience.mapper.ts` |
| `DocumentTypeRepo` | `document-type.repo.ts` | `mappers/document-type.mapper.ts` |
| `AgreementDocumentRepo` | `agreement-document.repo.ts` | `mappers/agreement-document.mapper.ts` |
| `AgreementVersionRepo` | `agreement-version.repo.ts` | `mappers/agreement-version.mapper.ts` |
| `CustomerRepo` | `customer.repo.ts` | `mappers/customer.mapper.ts` |
| `CustomerVersionStateRepo` | `customer-version-state.repo.ts` | `mappers/customer-version-state.mapper.ts` |
| `AcceptanceRepo` | `acceptance.repo.ts` | `mappers/acceptance.mapper.ts` (+ `mappers/actor.mapper.ts`) |
| `ObjectionRepo` | `objection.repo.ts` | `mappers/objection.mapper.ts` (+ `mappers/actor.mapper.ts`) |
| `NotificationEventRepo` | `notification-event.repo.ts` | `mappers/notification-event.mapper.ts` |

Shared building blocks: `prisma.service.ts` (NestJS lifecycle), `prisma-errors.ts` (Prisma
error-code detection), `mappers/null.ts` (`null` ↔ `undefined`), `mappers/actor.mapper.ts`
(`Actor` ↔ the four `actor*` columns, used by Acceptance AND Objection).

### PrismaService (lifecycle)

Standard NestJS recipe: `PrismaService extends PrismaClient`, `onModuleInit` calls
`$connect()`, `onModuleDestroy` calls `$disconnect()`; additionally `enableShutdownHooks(app)`
so a process exit signal reliably triggers `app.close()` → `onModuleDestroy`. Wired in
`main.ts` (`app.get(PrismaService).enableShutdownHooks(app)`).

### Mapping decisions

- **`save()` is an upsert by `id` everywhere** (`Audience`, `DocumentTypeDef`,
  `AgreementDocument`, `AgreementVersion`, `Customer`, `CustomerVersionState`) — exactly like
  the in-memory fakes (`Map.set` overwrites existing entries). `append()` (`Acceptance`,
  `Objection`, `NotificationEvent`) is a pure `create` — a second call with the same `id` is a
  programming error, not an update.
- **Error translation instead of manual pre-checks:** where the in-memory fakes check
  invariants manually before writing, the Prisma repos rely on the real DB constraints and
  translate the resulting error:
  - `Audience.key`/`DocumentTypeDef.key` `@unique` → P2002 → `DomainError('INVALID_STATE', …)`.
  - `AgreementDocument` `@@unique([type, audience])` → P2002 → `DomainError('INVALID_STATE', …)`.
  - `AgreementVersion.documentId` FK missing → P2003 → `DomainError('INVALID_STATE', …)`.
  - `Acceptance`/`Objection`/`NotificationEvent` PK duplicate (append-only violation) → P2002
    (target `id`) → `DomainError('INVALID_STATE', …)`.
  - `Acceptance` partial unique index (`WHERE "isEffective"`, from `partial-indexes.sql`) →
    P2002 → `DomainError('ALREADY_ACCEPTED', …)`. This index is unknown to Prisma from its own
    schema, so how the query engine surfaces it in `meta.target` had to be determined empirically.
    The Prisma integration suite (`acceptance.repo.prisma.spec.ts`, run against real Postgres 16
    in CI) showed the engine maps the partial index back to its **column list**
    (`["customerId", "versionId"]`) rather than the raw constraint name — so `acceptance.repo.ts`
    detects the violation primarily by that column pair (unambiguous: the hard `@@unique` was
    dropped in favour of the partial index), keeping the constraint-name / `"effective"` fragment
    checks as a fallback for engines that report the name instead.
  - `supersede`/`resolve` on an unknown `id` → P2025 (record not found) →
    `DomainError('INVALID_STATE', …)`.
  - Slug validation for `Audience.key`/`DocumentTypeDef.key` happens in the application layer
    (`assertValidEntityKey`) in both the fakes and the Prisma repos — invalid keys never reach
    the DB.
- **`deleteIfUnused`** (Audience/DocumentTypeDef): read entity → count referencing
  `AgreementDocument` rows (and for audiences: `Customer` rows via `roles: { has: key }`) →
  delete only when unreferenced. Returns `false` for unknown or still-referenced keys.
- **`setNotifiedAtomically`** is literally `updateMany({ where: { id, notifiedAt: null }, data })`
  followed by a `findUnique` that returns the (possibly unchanged) current state — the
  `WHERE notifiedAt IS NULL` condition makes it an atomic "set only on first delivery" without
  lost updates under concurrency (guaranteed by Postgres itself). Unknown `id` →
  `DomainError('INVALID_STATE', …)`, like the fake.
- **`findCurrentPublished`** resolves the hot path as two queries: first `AgreementDocument`
  via the `type_audience` unique index (string keys), then `AgreementVersion` filtered on
  `documentId` + `status=PUBLISHED` + `validFrom <= now`, sorted `validFrom desc, publishedAt
  desc` with `nulls: 'last'`.
- **`Objection`/`NotificationEvent` sort `findByCustomerAndVersion`/`findByCustomer`/
  `findByState` by `createdAt`, not by the business date** (`objectedAt`/`occurredAt`): the
  fakes preserve pure insertion order (map iteration); `createdAt` (auto timestamp per
  `INSERT`) mirrors that most closely. `Acceptance.findByCustomer` deliberately sorts by
  `acceptedAt` (port doc: "complete history … chronological" — business chronology).
- **Actor mapping** (`mappers/actor.mapper.ts`): `Actor.userId/name/email/portalRole` ↔
  `actorUserId/actorName/actorEmail/actorPortalRole` on `Acceptance` and `Objection`.
- **No `AgreementVersionRepo` constructor dependency on `AgreementDocumentRepo`** (unlike the
  in-memory fake): the Prisma variant relies on the real FK constraint and needs no cross-repo
  injection. The fakes for `AudienceRepo`/`DocumentTypeRepo` DO take repo dependencies
  (documents, customers) to implement `deleteIfUnused`; the Prisma variants query the tables
  directly.

### `*.prisma.spec.ts` — Prisma integration suite

A `*.prisma.spec.ts` per repo (`src/persistence/prisma/<repo>.repo.prisma.spec.ts`), the
counterpart to the respective `src/persistence/inmemory/*.spec.ts`, with the most important
invariant tests (incl. partial unique index → `ALREADY_ACCEPTED`, FK violation →
`INVALID_STATE`, `setNotifiedAtomically` idempotency incl. a real concurrency test via
`Promise.all`, `findCurrentPublished` tie-break, `delete` status check, and for the added
entities: key uniqueness, slug validation, `deleteIfUnused` reference checks, e-mail-template
and signed-document round-trips, acceptance-link token lookup). Shared helper
`testing/reset-database.ts` resets the test DB between tests (FK-safe delete order). Gate:
`const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;` — without
`DATABASE_URL` the whole block is skipped, which is why the default unit run needs no Postgres.
**These specs run on every push/PR in CI against a real Postgres 16 service container** (the
`backend-integration` job; see `.github/workflows/ci.yml`). Local invocation once Postgres is
available (`pnpm test:integration`, or directly):

```bash
DATABASE_URL=postgresql://clickwrap:clickwrap@localhost:5432/clickwrap \
  ~/.local/bin/pnpm jest --testPathIgnorePatterns=/node_modules/ src/persistence/prisma
```

(deliberately overrides `testPathIgnorePatterns` from `jest.config.js`, which excludes
`*.prisma.spec.ts` from the normal unit run).

## Open item: transactionality of Acceptance + CustomerVersionState

`AcceptanceService.accept` (and likewise `ManualAcceptanceService`/`DeadlineSweeperService`)
writes the consent evidence (`AcceptanceRepo.append`) and the state transition
(`CustomerVersionStateRepo.transition`) as **two separate repo calls**. In
`REPOSITORY_DRIVER=prisma` mode the underlying queries therefore do **not** run in a single DB
transaction — there is no cross-repo unit of work, and a clean `prisma.$transaction` across two
port implementations would be an architectural change (ports would need to pass a transaction
context) — hence deliberately **documented instead of half-implemented** (TODO comment in
`src/consent/acceptance.service.ts`), with the risk mitigated as below.

Risk assessment (why this is acceptable for now):

- The state transition is **conditional** (`UPDATE … WHERE state = expected`) — lost updates
  between the two writes are impossible; the worst case after a crash between transition and
  append is a state `ACCEPTED` without an acceptance row (discoverable via customer history,
  correctable via admin manual recording).
- The invariant "exactly one effective acceptance" is guaranteed independently by the partial
  unique index (`ALREADY_ACCEPTED`).
- The idempotency store reserves the key before processing (putIfAbsent) — duplicate
  processing of the same request is also excluded.

Approach when implemented: introduce a UnitOfWork port (e.g.
`runInTransaction(fn)`, Prisma implementation via `prisma.$transaction` with the interactive
transactions client, in-memory implementation as a pass-through) and move acceptance append +
state transition inside.

### IdempotencyRecord: reservation marker

`PrismaIdempotencyStore.reserve` creates a marker `{"__idempotencyPending": true}` via `create`
(unique on `key`) — the first writer wins (P2002 → `false`, the second request waits for the
replay). `get` treats the marker as "no response yet", `release` deletes marker rows only
(error path), never finished responses.

## Applying migrations

CI provisions the schema against its Postgres 16 service container with `prisma db push` (see the
`backend-integration` job). For a real deployment you create and apply a migration instead
(locally via `docker-compose.yml`, in staging/prod via the Postgres there):

```bash
# 1) start the local Postgres instance (local only)
docker compose up -d

# 2) create + apply the migration
DATABASE_URL=postgresql://clickwrap:clickwrap@localhost:5432/clickwrap \
  pnpm prisma migrate dev --name init

# 3) apply the post-migration SQL (partial index + REVOKE for the app role)
#    Set app_role to the actual runtime role (see role note below); locally "clickwrap" by default.
psql "$DATABASE_URL" -v app_role=clickwrap -f prisma/partial-indexes.sql

# In staging/deploy pipelines: run the same step 3 after every `prisma migrate deploy`.
```

Note for existing installations migrating from the enum-based schema: the migration must drop
the `DocumentType`/`Audience` enums (columns become `text`), create the `Audience` and
`DocumentTypeDef` tables, and seed one row per previously used enum value (with keys of your
choosing) plus a data migration mapping old enum values to the new keys in
`AgreementDocument.type`/`.audience` and `Customer.roles`.

### Role separation migration vs. runtime (important for staging/prod)

Locally `docker-compose.yml` uses a single Postgres user (`clickwrap`) for migration and app runtime
— sufficient for development, but the `REVOKE UPDATE, DELETE` in `partial-indexes.sql` then has
**no effect** because that user usually owns the tables (owner privileges cannot be revoked
from the owner itself). In staging/production the app runtime role (from the running
application's `DATABASE_URL`) **must** be separate from the migration/owner role for the
append-only enforcement to apply, e.g.:

- `clickwrap_migrator` — owner of the tables, runs `prisma migrate deploy`.
- `clickwrap_app` — runtime role of the application (in the app `DATABASE_URL`), only gets
  `SELECT, INSERT` on `Acceptance`/`Objection`/`NotificationEvent`/`AdminAuditLog` (no
  `UPDATE`/`DELETE`).

`partial-indexes.sql` takes the target role as the psql variable `app_role` (default: `clickwrap`
for local development).

## Validation status

The Prisma driver is exercised against a **real Postgres 16** on every push/PR: the CI
`backend-integration` job (`.github/workflows/ci.yml`) provisions the schema with `prisma db push`,
applies the index section of `partial-indexes.sql`, verifies the partial unique index exists, and
then runs the full `*.prisma.spec.ts` suite (`pnpm test:integration`). `prisma format`/`validate`/
`generate` remain green as well.

What the integration suite confirmed (previously open items, now closed):

- **The partial unique index on effective acceptances behaves as intended.** A second effective
  acceptance for the same `(customerId, versionId)` raises P2002 and is translated to
  `ALREADY_ACCEPTED`; the append-only correction (`isEffective=false` + new row) works.
- **P2002 target detection.** Against real Postgres the query engine reports the partial index by
  its **column list** (`["customerId", "versionId"]`), not the raw constraint name — the primary
  detection in `acceptance.repo.ts` matches on that pair, with the constraint-name / `"effective"`
  fragment checks kept as a fallback.
- **`partial-indexes.sql` runs cleanly** against the pushed schema (the index/constraint section;
  see the CI note about the role-scoped `GRANT`/`REVOKE` below).
- **Atomic conditional writes** (`setNotifiedAtomically`, `transition`) hold under concurrency
  (`Promise.all` tests), and `findCurrentPublished` tie-breaking, FK violations, `deleteIfUnused`
  reference checks, key uniqueness/slug validation, and the e-mail-template / signed-document /
  acceptance-link round-trips all pass.

Environment caveats that remain **documented, not test-enforced**:

- The **column-scoped `GRANT`/`REVOKE` behaviour with separated migration/app roles** is not
  exercised in CI — CI runs as a single role, so `partial-indexes.sql` applies only the
  index/constraint statements and skips the role management (see the job comment). The append-only
  REVOKE enforcement must be validated in a staging environment with the two roles set up (see the
  role-separation note above).
- `prisma migrate deploy` in a real deployment (CI uses `db push`); create the migration as
  described under "Applying migrations".

## Integration

- **`RepositoryModule.forRoot()`** (`src/persistence/repository.module.ts`, `@Global`) is the
  composition root of all persistence ports. Env `REPOSITORY_DRIVER=prisma|inmemory` (default
  `inmemory` — the service starts without Postgres): `prisma` binds the `PersistenceModule`,
  `inmemory` the fakes (including `InMemoryAudienceRepo`/`InMemoryDocumentTypeRepo`, wired with
  their document/customer repo dependencies for `deleteIfUnused`).
- **Additional models + Prisma repos** (each with a mapper):
  - `Audience` ↔ `PrismaAudienceRepo`, `DocumentTypeDef` ↔ `PrismaDocumentTypeRepo`
    (ports `src/domain/ports.ts::AudienceRepo`/`DocumentTypeRepo`).
  - `OutboundEmail` ↔ `PrismaOutboundEmailRepo` (port `src/plugins/email/core/outbound-email.ts`;
    `markDelivered` atomic via `updateMany … deliveredAt: null`).
  - `IdempotencyRecord` ↔ `PrismaIdempotencyStore` (port `src/consent/ports.ts`).
  - `EscalationEntry` ↔ `PrismaEscalationLog` (shared port
    `src/common/escalation/escalation-log.ts`); append-only via REVOKE in
    `partial-indexes.sql`.
  - `AdminAuditLog` ↔ `PrismaAdminAuditRepo` (port `src/agreements/audit.ts`).
  - `EmailTemplate` ↔ `PrismaEmailTemplateRepo` (port `src/domain/ports.ts::EmailTemplateRepo`;
    `deleteIfUnused` refuses templates still assigned to a document type; default rows seeded on
    boot).
  - `SignedDocument` ↔ `PrismaSignedDocumentRepo` (externally-signed evidence archive, append-only).
  - `AcceptanceLink` ↔ `PrismaAcceptanceLinkRepo` (hosted-acceptance capability links; lookup by
    `tokenHash`).
  - `Event` ↔ `PrismaEventRepo` (port `src/domain/ports.ts::EventRepo`, mapper
    `mappers/event.mapper.ts`) — the append-only **activity log** backing `GET /admin/events`. The
    core writes ONE row per successful domain action via the shared `EventRecorder`
    (`src/events/event-recorder.ts`, provided globally by `RepositoryModule` like `ADMIN_AUDIT_TOKEN`
    so agreements/consent/admin/plugin services inject it cycle-free). This is a **dual-write**: it
    runs ALONGSIDE — never replaces — the legally authoritative evidence/audit stores
    (`Acceptance`/`Objection`/`NotificationEvent`/`AdminAuditLog`/`OutboundEmail`), which are
    unchanged. Row fields are stored **denormalized** (customerName, versionLabel, documentType, …)
    so the read side (`EventsService`) is a trivial filter-before-paginate query (occurredAt DESC,
    stable id tiebreak, 50/page). A recorder failure is logged (warn) and swallowed — it never breaks
    the business action, which has already succeeded. `append` is a pure create (duplicate id →
    `INVALID_STATE`); like the other evidence tables it can be locked append-only via REVOKE. Indexes:
    `@@index([occurredAt])`, `@@index([customerId, occurredAt])`, `@@index([category])`,
    `@@index([documentType])`.
    **Traceability guarantee:** every state-changing action writes exactly one event — including the
    AUTOMATIC (cron/webhook) transitions that have no human actor: passive/tacit acceptance
    (`VERSION_ACCEPTED`, `metadata.method=TACIT`) and deadline expiry (`DEADLINE_EXPIRED`) from the
    deadline sweeper; scheduled version activation/retirement (`VERSION_ACTIVATED`/`VERSION_RETIRED`)
    and block carry-over (`BLOCK_CARRIED_OVER`) from the activation sweeper; e-mail delivery/bounce
    (`EMAIL_DELIVERED`/`EMAIL_BOUNCED`) from the provider webhook (`actorKind=SYSTEM`). Rollout also
    emits `OBLIGATION_ROLLED_OUT` per created `PENDING_NOTIFICATION` state — the authoritative
    "customer became obliged" record, independent of whether an `EMAIL_SENT` fires (customers without
    a contact e-mail still appear). The `EventRecorder` centrally denormalizes `documentType`/
    `audience`/`versionLabel` (from `versionId` via `AgreementVersionRepo`/`AgreementDocumentRepo`)
    and `customerName` (from `customerId` via `CustomerRepo`) when the caller did not supply them —
    all lookups inside the swallow-guard, so a resolution failure never breaks the business action.
    The full event-type catalogue (grouped by category, noting system/cron-driven types) is in
    docs/API.md.
- **`Customer.contactEmails String[] @default([])`**: rollout/reminder/confirmation mails go to all
  stored contacts; mapper + domain type aligned.
- **`Customer.source String?` + `Customer.deletedAt DateTime?` (+ `@@index([source])`)**: provenance
  and soft-delete for the inbound integration API (`CustomerAdminService`). `source` records the
  record's origin as reported by the pushing system (`null`/`'manual'` = admin-created; otherwise the
  caller's namespace, e.g. `'mainportal'`); `deletedAt` marks a customer deactivated via
  `deactivateByExternalRef`. Soft-delete **preserves the row and its evidence chain** — the customer
  is excluded from the admin list / dashboard / compliance ("never blocking/pending") but its
  detail/history stays viewable, and it is reactivated (deletedAt cleared) on a subsequent upsert of
  the same external ref. `softDelete(id, at)` stamps `deletedAt` (`updateMany`, unknown id = no-op).
  `prisma db push` covers both columns; `reset-database` truncates by row (no change).
- `prisma format`/`validate`/`generate` run green after every schema change.

Still open (not blocking — the driver is exercised in CI, see "Validation status"):

- `PrismaOutboundEmailRepo`/`PrismaIdempotencyStore`/`PrismaEscalationLog`/`PrismaAdminAuditRepo`
  have no dedicated `*.prisma.spec.ts` yet — add them following the existing pattern.
- The role-separated append-only enforcement (`REVOKE` for a distinct app role) is validated only
  in staging, not in the single-role CI job.
