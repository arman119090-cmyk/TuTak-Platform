const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jest-environment-jsdom',
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  // `next/jest` reads tsconfig `paths` only when a `baseUrl` is set, and this
  // project does not set one, so any test importing via the `@/...` alias
  // (as apps/admin found first) needs this mapped explicitly.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

module.exports = createJestConfig(customJestConfig);
