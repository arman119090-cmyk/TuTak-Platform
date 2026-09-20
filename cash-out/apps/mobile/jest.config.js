/** @type {import('jest').Config} */
// Pure logic only: routing decisions, language and theme resolution, the
// failure vocabulary, and the Armenian layout guards. Nothing here renders a
// React Native view — a runner has no simulator, and the screens are
// typechecked instead.
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: { '^.+\\.(t|j)sx?$': ['@swc/jest'] },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  testMatch: ['**/*.spec.ts'],
};
