/**
 * Test-only values for the variables `env.validation.ts` requires, set
 * before any module is imported.
 *
 * ## Why the unit suite needs this at all
 *
 * It does not touch a database. But `@Module({ imports: [ConfigModule.forRoot({
 * validate })] })` runs its validation when the decorator is *evaluated* —
 * import time, not boot time — so any spec that transitively imports
 * `AppModule` (through `seed-demo.ts`, say) demands `DATABASE_URL` and both
 * JWT secrets before a single test runs. The result was that
 * `pnpm --filter @tutak/api test:unit` failed on a clean checkout with a
 * message about environment configuration, which reads like the developer's
 * machine is misconfigured rather than like a quirk of decorator evaluation.
 *
 * ## Why this is not weakening the guard
 *
 * `env.validation.ts` exists so a *deployment* cannot boot half-configured,
 * and it keeps doing exactly that: this file is registered only on the `unit`
 * Jest project, and only ever fills in a variable that is *not already set*.
 * CI sets the real ones and they win. Its own spec —
 * `config/env.validation.spec.ts` — passes explicit objects and never reads
 * `process.env`, so the rules themselves are still tested against the real
 * thing.
 *
 * The values are deliberately obvious nonsense pointed at a host that does
 * not exist. Nothing in the unit suite opens a connection; if something ever
 * starts to, it will fail loudly against `unit-tests.invalid` rather than
 * quietly succeed against a database somebody happened to have running.
 */
const TEST_ONLY_DEFAULTS: Record<string, string> = {
  DATABASE_URL: 'postgresql://unit:unit@unit-tests.invalid:5432/unit?schema=public',
  // 32 characters is the floor `env.validation.ts` enforces; these say what
  // they are so a leaked log line is self-explaining.
  JWT_ACCESS_SECRET: 'unit-test-access-secret-not-a-real-key',
  JWT_REFRESH_SECRET: 'unit-test-refresh-secret-not-a-real-key',
};

for (const [key, value] of Object.entries(TEST_ONLY_DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}
