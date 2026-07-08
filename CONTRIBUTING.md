# Contributing to clickwrap-server

Thanks for your interest in contributing! This project is released under the Apache-2.0 license;
by submitting a contribution you agree that it is licensed under the same terms.

## Development setup

Requirements: Node.js 20+ and [pnpm](https://pnpm.io/).

```bash
# Backend (repo root)
pnpm install
cp .env.example .env          # defaults use the in-memory driver + noop e-mail; no DB needed
pnpm start:dev                # http://localhost:3000
pnpm seed-example             # optional: load the example dataset

# Admin UI
cd admin-ui
pnpm install
cp .env.example .env          # set VITE_API_URL (login methods come from the backend)
pnpm dev                      # http://localhost:5173
```

The in-memory driver means you can develop and run the full unit suite without Postgres. To work
against a real database, follow the Prisma quickstart in the [README](README.md#quickstart).

## Conventions & TDD

Please read [`CONVENTIONS.md`](CONVENTIONS.md). In short:

- **Test-first.** Write the failing `*.spec.ts` next to the implementation, then make it green.
- **Pure domain.** No NestJS/Prisma imports in `src/domain/`; time only via the injected `Clock`.
- **Ports & adapters.** New persistence behaviour is added to the port and to *both* drivers
  (in-memory fake + Prisma), with the in-memory fake backing the unit tests.
- **Errors** are `DomainError` codes mapped to HTTP by the global filter — don't throw NestJS HTTP
  exceptions from services/domain.
- **English everywhere** in code, comments, tests and docs. UI translations live only in
  `admin-ui/src/i18n/`.
- TypeScript strict; no `any`.

## Before you open a PR

Make sure everything is green:

```bash
# Backend
pnpm test
pnpm lint
pnpm build

# Admin UI (if you touched it)
cd admin-ui && pnpm test && pnpm build
```

## Pull request expectations

- Keep PRs focused on one change; describe the motivation and the approach.
- Include tests for every behavioural change (bug fixes get a regression test).
- Update the relevant docs (`README.md`, `docs/API.md`, `docs/PERSISTENCE.md`) when you change
  behaviour, the API surface, or configuration.
- Note any deliberate deviation from the conventions.
- Use clear, English commit messages.

## Reporting bugs & requesting features

Please open a GitHub issue with enough detail to reproduce (version/commit, configuration,
expected vs. actual behaviour). For security-sensitive reports, do **not** open a public issue —
see [`SECURITY.md`](SECURITY.md).
