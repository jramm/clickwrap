/**
 * Integration suite: the Prisma repository specs (*.prisma.spec.ts) that need a real
 * Postgres (DATABASE_URL). Excluded from the default `pnpm test` run; executed in CI
 * against a Postgres 16 service container (see .github/workflows/ci.yml) — this is
 * where the partial-unique-index P2002 translation and the atomic conditional state
 * transitions are verified against a real database.
 *
 * The specs gate themselves on DATABASE_URL and skip cleanly when it is unset.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.prisma.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Integration tests share one database — never run them concurrently.
  maxWorkers: 1,
};
