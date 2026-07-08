# Persistence — clickwrap-server

Short documentation for the Prisma schema (`prisma/schema.prisma`), the post-migration script
(`prisma/partial-indexes.sql`) and the local Postgres environment (`docker-compose.yml`).

## Schema decisions

- **IDs:** `String @id @default(cuid())` for all models (standard for NestJS+Prisma services).
- **Dynamic entities instead of enums:** rather than hardcoding document types and audiences as
  database enums (e.g. `DocumentType { TERMS, DPA }`, `Audience { CUSTOMER, PARTNER }`), they are
  modelled as data-driven entities:
  - `DocumentTypeDef { id, key, name }` — e.g. key `terms`, `dpa`.
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
- **Compliance/overview detail keys** are built from the dynamic keys via
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
    P2002 → `DomainError('ALREADY_ACCEPTED', …)`. **Caution:** this index is unknown to Prisma
    from its own schema; the query engine reports `meta.target` as a raw constraint-name string
    (`"Acceptance_customerId_versionId_effective_key"`) instead of a field array. The detection
    in `acceptance.repo.ts` therefore additionally checks for the name fragment `"effective"` —
    a best effort that has **not yet been verified against a real Postgres instance**
    (see validation status, open item).
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

### `*.prisma.spec.ts` — test skeletons

One `*.prisma.spec.ts` per repo (`src/persistence/prisma/<repo>.repo.prisma.spec.ts`),
counterpart to the respective `src/persistence/inmemory/*.spec.ts` with the most important
invariant tests (incl. partial unique index → `ALREADY_ACCEPTED`, FK violation →
`INVALID_STATE`, `setNotifiedAtomically` idempotency incl. a real concurrency test via
`Promise.all`, `findCurrentPublished` tie-break, `delete` status check, and for the new
entities: key uniqueness, slug validation, `deleteIfUnused` reference checks). Shared helper
`testing/reset-database.ts` resets the test DB between tests (FK-safe delete order). Gate:
`const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;` — without
`DATABASE_URL` the whole block is skipped. Invocation once Postgres is available:

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
context) that could not be verified without a real Postgres instance — hence deliberately
**documented instead of half-implemented** (TODO comment in `src/consent/acceptance.service.ts`).

Risk assessment (why this is acceptable for now):

- The state transition is **conditional** (`UPDATE … WHERE state = expected`) — lost updates
  between the two writes are impossible; the worst case after a crash between transition and
  append is a state `ACCEPTED` without an acceptance row (discoverable via overview/history,
  correctable via admin manual recording).
- The invariant "exactly one effective acceptance" is guaranteed independently by the partial
  unique index (`ALREADY_ACCEPTED`).
- The idempotency store reserves the key before processing (putIfAbsent) — duplicate
  processing of the same request is also excluded.

Approach when implemented (once testable with a DB): introduce a UnitOfWork port (e.g.
`runInTransaction(fn)`, Prisma implementation via `prisma.$transaction` with the interactive
transactions client, in-memory implementation as a pass-through) and move acceptance append +
state transition inside.

### IdempotencyRecord: reservation marker

`PrismaIdempotencyStore.reserve` creates a marker `{"__idempotencyPending": true}` via `create`
(unique on `key`) — the first writer wins (P2002 → `false`, the second request waits for the
replay). `get` treats the marker as "no response yet", `release` deletes marker rows only
(error path), never finished responses.

## Applying migrations

This environment has **no** working Docker/Postgres — only `prisma format`/`prisma validate`/
`prisma generate` were executed against a dummy `DATABASE_URL`; no migration was created or
applied. Procedure once Postgres is available (locally via `docker-compose.yml`, in
staging/prod via the Postgres there):

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

Executed without Docker/Postgres in this environment (WASM query engine, no network access
needed — the engine was already vendored in `node_modules`):

```bash
DATABASE_URL=postgresql://x:x@localhost:5432/x node_modules/.bin/prisma format    # ✅ formatted
DATABASE_URL=postgresql://x:x@localhost:5432/x node_modules/.bin/prisma validate  # ✅ "is valid"
DATABASE_URL=postgresql://x:x@localhost:5432/x node_modules/.bin/prisma generate  # ✅ client generated
```

All three steps ran successfully again after the dynamic-entities refactor (Audience/
DocumentTypeDef models, enum removal, string key columns).

What could **not** be verified because no real Postgres instance is available:

- Whether `prisma migrate dev` actually produces an applicable migration (schema validity was
  checked, SQL generation against a real DB was not).
- Whether `partial-indexes.sql` runs cleanly against the generated schema — table/column names
  were aligned manually, not tested live.
- **The P2002 detection of the partial index in `acceptance.repo.ts`** (detection via the name
  fragment `"effective"` in `meta.target`) — the point with the largest residual uncertainty,
  as it depends on an undocumented detail of the Prisma query engine. **First priority for the
  end-to-end test** once Postgres is available: run `acceptance.repo.prisma.spec.ts` and adapt
  the target detection in `prisma-errors.ts`/`acceptance.repo.ts` if needed.
- The (column-scoped) `GRANT`/`REVOKE` behaviour with separated roles — documented only.
- All `*.prisma.spec.ts` files: they compile cleanly (`tsc --noEmit`) and are excluded from the
  unit run, but were never actually executed for lack of Postgres.

Recommendation: once a Postgres instance is available, run in this order: (1) `migrate dev` +
`partial-indexes.sql`, (2) `DATABASE_URL=… pnpm jest --testPathIgnorePatterns=/node_modules/
src/persistence/prisma` (all `*.prisma.spec.ts`), (3) only then switch deployments to
`REPOSITORY_DRIVER=prisma`.

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
- **`Customer.contactEmails String[] @default([])`**: rollout/reminder mails go to all stored
  contacts; mapper + domain type aligned.
- `prisma format`/`validate`/`generate` ran successfully after all schema changes
  (dummy `DATABASE_URL`, see "Validation status").

Still open (verifiable only with a real Postgres instance):

- Verify the P2002 target detection for the partial acceptance index mentioned under
  "Validation status" (highest priority).
- `migrate dev` + `partial-indexes.sql` against a real DB; then run the `*.prisma.spec.ts`
  files. For `PrismaOutboundEmailRepo`/`PrismaIdempotencyStore`/`PrismaEscalationLog`/
  `PrismaAdminAuditRepo` there are no `*.prisma.spec.ts` yet — add them following the existing
  pattern once a DB is available.
