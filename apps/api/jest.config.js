/**
 * Two suites, deliberately separated.
 *
 *  * `unit` runs with no external dependency: pure arithmetic, validation and
 *    invariant guards. Fast enough to run on every save.
 *  * `integration` runs against a real PostgreSQL database, because the money
 *    guarantees this project cares about — transactional atomicity,
 *    Serializable conflict handling, CHECK constraints, unique indexes — do
 *    not exist in a mocked Prisma client. Mocking them would test the mock.
 */
const path = require('node:path');

/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  // Serial on purpose. Every integration suite shares one database and
  // truncates between tests; run in parallel, one worker's TRUNCATE deadlocks
  // against another's open transaction and wipes its fixtures mid-assertion.
  // Jest only honours this at the top level when `projects` is used.
  maxWorkers: 1,
  projects: [
    {
      displayName: 'unit',
      rootDir: __dirname,
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: path.join(__dirname, 'tsconfig.spec.json') }],
      },
    },
    {
      displayName: 'integration',
      rootDir: __dirname,
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
      globalSetup: '<rootDir>/test/setup/global-setup.ts',
      setupFilesAfterEnv: ['<rootDir>/test/setup/jest-setup.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: path.join(__dirname, 'tsconfig.spec.json') }],
      },
    },
  ],
  collectCoverageFrom: [
    'src/common/utils/money.ts',
    'src/common/validators/**/*.ts',
    'src/modules/wallet/**/*.ts',
  ],
};
