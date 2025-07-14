export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/evals/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  roots: ['<rootDir>/src/evals'],
};
