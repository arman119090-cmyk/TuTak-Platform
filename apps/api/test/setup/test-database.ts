/**
 * Test database location.
 *
 * Deliberately a *separate* database, never the development one: the suites
 * truncate every table between tests, and pointing this at `tutak` would
 * destroy the developer's data on the first `pnpm test`.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://tutak:tutak_dev_password@localhost:5432/tutak_test?schema=public';

/** Same server, `postgres` maintenance database — used only to CREATE DATABASE. */
export function maintenanceUrl(url = TEST_DATABASE_URL): string {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  parsed.search = '';
  return parsed.toString();
}

export function databaseName(url = TEST_DATABASE_URL): string {
  return new URL(url).pathname.replace(/^\//, '');
}
