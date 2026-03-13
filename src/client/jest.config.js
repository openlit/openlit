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
    // Type-only exports (no runtime code to cover)
    '!src/middleware/middlewareFactory.ts',
    '!src/constants/dbConfig.ts',
    '!src/constants/prompts.ts',
    '!src/constants/sidebar.tsx',
    // Complex OS-level operations (cron file management, child process spawning)
    '!src/helpers/server/cron.ts',
    // NextAuth session internals (requires full framework context)
    '!src/lib/session.ts',
    // Store initialization (individual slices are tested in their own files)
    '!src/store/index.ts',
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
