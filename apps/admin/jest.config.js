const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jest-environment-jsdom',
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  // `next/jest` reads tsconfig `paths` only when a `baseUrl` is set, and this
  // project does not set one. Every test until now imported relatively and so
  // never noticed; the first one to `jest.mock('@/lib/...')` did.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

module.exports = createJestConfig(customJestConfig);
