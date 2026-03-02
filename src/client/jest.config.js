const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

const config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/**',
    '!src/instrumentation.ts',
    // UI components are not unit-testable without full rendering setup
    '!src/components/**',
    // ClickHouse connection pool setup
    '!src/clickhouse/**',
    '!src/lib/platform/clickhouse/**',
    // Complex AI provider adapters and OpenGround internals
    '!src/lib/platform/openground/**',
    '!src/lib/platform/openground-clickhouse/**',
    '!src/lib/platform/manage-dashboard/**',
    // DB clients/singletons
    '!src/lib/prisma.ts',
    '!src/lib/posthog.ts',
    // TypeScript type definitions only
    '!src/types/**',
  ],
  testMatch: [
    '**/__tests__/**/*.{ts,tsx}',
    '**/*.test.{ts,tsx}',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
  ],
};

module.exports = createJestConfig(config);
