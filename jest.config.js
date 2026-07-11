/**
 * Unit suite. The backend is ESM ("type": "module"), so ts-jest runs in ESM mode
 * (extensionsToTreatAsEsm + useESM) and jest is invoked with
 * NODE_OPTIONS=--experimental-vm-modules (see package.json scripts). The moduleNameMapper strips
 * the mandatory NodeNext `.js` extension off relative imports so they resolve to the `.ts` sources.
 */
/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: { rootDir: '.' } }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Force the CJS build: under jest's experimental ESM the package's ESM entry require()s a
    // submodule while it is itself being import()ed, which throws "Cannot require() ES Module …
    // synchronously". The CJS build (only used to register the aws-sdk-client-mock matchers) is
    // internally consistent and race-free.
    '^aws-sdk-client-mock-jest$': '<rootDir>/node_modules/aws-sdk-client-mock-jest/dist/cjs/jest.js',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  // Prisma repos need a real database — run them via `pnpm test:integration` (CI: Postgres service).
  testPathIgnorePatterns: ['/node_modules/', '\\.prisma\\.spec\\.ts$'],
};
