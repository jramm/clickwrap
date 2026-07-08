-- clickwrap-server — post-migration SQL
--
-- Prisma cannot express two things declaratively:
--
--   1. Invariant: "exactly one effective Acceptance per (customerId, versionId)" is a
--      PARTIAL unique index (WHERE "isEffective"), not a hard @@unique — otherwise
--      append-only corrections (old entry isEffective=false + new entry) would be impossible.
--   2. Audit safety: Acceptance/Objection/NotificationEvent are append-only — technically
--      enforced via DB privileges (REVOKE UPDATE, DELETE for the app role), not just by
--      convention.
--
-- Usage: run AFTER every `prisma migrate deploy` (or `prisma migrate dev` locally).
-- This script is idempotent (CREATE ... IF NOT EXISTS, REVOKE is a no-op if the privilege
-- is already revoked) and can safely be re-run — it is worth wiring it firmly into the
-- deploy pipeline (step after `migrate deploy`, before rollout traffic).
--
-- Note on the dynamic entities (Audience/DocumentTypeDef): AgreementDocument.type/audience and
-- Customer.roles reference the entity `key` columns as PLAIN STRINGS, deliberately without FK
-- constraints (Customer.roles is a Postgres array — no FK possible; a one-sided FK on
-- AgreementDocument only would make the integrity guarantees uneven). Referential integrity is
-- enforced by the application layer (UNKNOWN_AUDIENCE / UNKNOWN_DOCUMENT_TYPE on use of
-- unknown keys; AudienceRepo/DocumentTypeRepo.deleteIfUnused refuses to delete referenced
-- entities). No additional SQL is needed here for them.
--
-- Role note: in local development (docker-compose.yml) a single Postgres user ("clickwrap") is
-- used for both migration and app runtime — the REVOKE below then has effectively no impact
-- because that user usually owns the tables (owner privileges cannot be revoked from the owner
-- itself). That is fine for local development. In staging/production the app runtime role MUST
-- be separate from the migration/owner role (e.g. "clickwrap_migrator" as owner, "clickwrap_app"
-- as the runtime role in DATABASE_URL), otherwise the protection does not apply. See
-- docs/PERSISTENCE.md.

-- Role whose runtime privileges are restricted (app connection user from DATABASE_URL).
-- Overridable in psql via `-v app_role=clickwrap_app`; default = local dev user.
\if :{?app_role}
\else
  \set app_role clickwrap
\endif

-- 1) Partial unique index ("exactly one effective acceptance")
CREATE UNIQUE INDEX IF NOT EXISTS "Acceptance_customerId_versionId_effective_key"
  ON "Acceptance" ("customerId", "versionId")
  WHERE "isEffective";

-- 2) Append-only enforcement on the evidence tables.
--    Deliberately NOT on AgreementVersion/AgreementDocument/CustomerVersionState/Audience/
--    DocumentTypeDef — their controlled mutation (DRAFT editing, rollout state transitions,
--    deadline extension via admin action, entity CRUD) is intended and remains application
--    logic. AdminAuditLog is treated as append-only as well for consistency — see the note in
--    docs/PERSISTENCE.md.
--
--    Column-scoped GRANT after the blanket REVOKE (correction discovered while building the
--    Prisma repos): src/domain/ports.ts defines one controlled correction operation each for
--    Acceptance/Objection that UPDATEs an EXISTING row instead of appending:
--      - AcceptanceRepo.supersede(id, byId)  → UPDATE isEffective=false, supersededByAcceptanceId
--      - ObjectionRepo.resolve(id, ...)      → UPDATE resolution, resolvedBy, resolvedAt
--    A blanket REVOKE UPDATE would block these domain-mandated operations in staging/prod
--    (separate migration/runtime roles, see above). Instead of dropping REVOKE UPDATE entirely
--    (which would weaken the append-only guarantee for all other columns), the approach is
--    column-scoped: REVOKE UPDATE fully, then GRANT UPDATE only on exactly the columns the two
--    correction operations need. Content columns (acceptedAt, contentHash, actor*, ...) remain
--    immutable for the app role. NotificationEvent has no correction operation in its port →
--    the full REVOKE stays.
REVOKE UPDATE, DELETE ON TABLE "Acceptance" FROM :"app_role";
GRANT UPDATE ("isEffective", "supersededByAcceptanceId") ON TABLE "Acceptance" TO :"app_role";

REVOKE UPDATE, DELETE ON TABLE "Objection" FROM :"app_role";
GRANT UPDATE ("resolution", "resolvedBy", "resolvedAt") ON TABLE "Objection" TO :"app_role";

REVOKE UPDATE, DELETE ON TABLE "NotificationEvent" FROM :"app_role";
REVOKE UPDATE, DELETE ON TABLE "AdminAuditLog" FROM :"app_role";
-- EscalationEntry: append-only like AdminAuditLog — the port
-- (src/common/escalation/escalation-log.ts) has no update/delete operation.
-- OutboundEmail/IdempotencyRecord stay writable (markDelivered and upsert are port semantics).
REVOKE UPDATE, DELETE ON TABLE "EscalationEntry" FROM :"app_role";
