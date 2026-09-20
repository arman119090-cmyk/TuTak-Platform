/** @type {import('jest').Config} */
// The panel's own logic: roster parsing and the operator-facing formatting.
// Pages are server components verified by `next build` in CI.
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: { '^.+\\.(t|j)sx?$': ['@swc/jest'] },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  testMatch: ['**/*.spec.ts'],
};
