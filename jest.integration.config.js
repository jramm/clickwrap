/**
 * Integration suite: the Prisma repository specs (*.prisma.spec.ts) that need a real
 * Postgres (DATABASE_URL). Excluded from the default `pnpm test` run; executed in CI
 * against a Postgres 16 service container (see .github/workflows/ci.yml) — this is
 * where the partial-unique-index P2002 translation and the atomic conditional state
 * transitions are verified against a real database.
 *
 * The specs gate themselves on DATABASE_URL and skip cleanly when it is unset.
 *
 * ESM mode (see jest.config.js for the rationale): ts-jest useESM + the `.js`-stripping
 * moduleNameMapper; run via NODE_OPTIONS=--experimental-vm-modules (package.json scripts).
 */
/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.prisma.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  transform: {
    // rootDir '.' is set explicitly: this config's testMatch is a single directory
    // (src/persistence/prisma), so ts-jest would otherwise infer that folder as the common source
    // dir and fail with TS5011.
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: { rootDir: '.' } }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Integration tests share one database — never run them concurrently.
  maxWorkers: 1,
};
