/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  // Prisma repos need a real database — run them via `pnpm test:integration` (CI: Postgres service).
  testPathIgnorePatterns: ['/node_modules/', '\\.prisma\\.spec\\.ts$'],
};
