# Development conventions (clickwrap-server)

These are the coding and workflow conventions for the backend. They are intentionally short; the
code is the source of truth.

## TDD workflow (mandatory)

1. Write the test first (`*.spec.ts` next to the implementation) and watch it fail.
2. Implement until green: `pnpm jest src/<your-directory>`.
3. `pnpm lint` (`tsc --noEmit`) must be clean.
4. `pnpm build` must succeed before opening a PR.

## Architecture

- **The domain is pure** (`src/domain/`): no NestJS or Prisma imports; time is obtained only via an
  injected `Clock` (never `new Date()` in domain code) so behaviour is deterministic in tests.
- **Ports** (repository interfaces) live in `src/domain/ports.ts`. In-memory fakes in
  `src/persistence/inmemory/` back every unit test; Prisma implementations in
  `src/persistence/prisma/` are compile-checked and covered by `*.prisma.spec.ts` (excluded from
  the default unit run — they need a real Postgres instance).
- **Errors:** throw `DomainError` from `src/common/errors.ts` (the codes are the public API error
  codes). HTTP mapping is done by the global `DomainErrorFilter` — domain and service code never
  import NestJS HTTP exceptions.
- **Auth:** `ServiceGuard` populates `req.customerContext`; the actor and customer come ONLY from
  the authenticated context, never from the request body. `AdminGuard` protects `/admin`. Both
  live in `src/common/auth/`.
- **Deadline timestamps are always set server-side** (via `Clock`), never taken from client
  payloads — client-provided times are used only for plausibility checks.

## Language & style

- **All code, comments, commit messages and docs are in English.** (User-facing UI strings are the
  only place translations live — see `admin-ui/src/i18n/`.)
- TypeScript strict mode; no `any`. Prefer discriminated unions over booleans-with-implications.
- One port implementation per file; keep the domain ↔ persistence mapping in `mappers/`.

## Pull requests

- Every behavioural change ships with tests (red → green). Keep the full suite green:
  `pnpm test`, `pnpm lint`, `pnpm build` — and, for admin-ui changes, `cd admin-ui && pnpm test &&
  pnpm build`.
- Keep changes focused; note any deliberate deviation from these conventions in the PR description.
