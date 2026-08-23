// `validate()` runs `class-transformer`'s `plainToInstance`, which reads
// design-time type metadata via `Reflect.getMetadata` — patched onto the
// global `Reflect` object by this import, exactly as `main.ts` does as its
// own first line, for the same reason. Needed here because Jest gives each
// spec file its own sandboxed module registry, so another spec file having
// already imported this polyfill does not help this one.
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { assertProductionJwtSecretsAreStrong, validate } from './env.validation';

/**
 * Security hardening (2026-08-23): regression suite for the boot-time
 * guard that stops production from ever starting on an example, default,
 * predictable, or duplicated JWT secret. Reproduced live before this guard
 * existed — `validate()` returned normally for `NODE_ENV=production` with
 * `.env.example`'s own secrets copied verbatim (see the doc comment on
 * `assertProductionJwtSecretsAreStrong` in `env.validation.ts`) — so every
 * case here pins a shape that used to boot and now must not.
 */
describe('assertProductionJwtSecretsAreStrong', () => {
  const strongSecret = () => randomBytes(32).toString('hex');

  const validEnv = (overrides: Partial<Record<string, unknown>> = {}) => ({
    NODE_ENV: 'production' as const,
    PORT: 4000,
    DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
    JWT_ACCESS_SECRET: strongSecret(),
    JWT_REFRESH_SECRET: strongSecret(),
    ...overrides,
  });

  it('accepts two independently strong, distinct secrets in production', () => {
    expect(() => assertProductionJwtSecretsAreStrong(validEnv() as never)).not.toThrow();
  });

  /**
   * Regression for a real false positive found while verifying this guard
   * live (2026-08-23): the entropy floor was first written as "fewer than
   * 16 distinct characters", reasoning that `openssl rand -hex 32` clears
   * it easily. It does not, reliably — hex has only 16 *possible* distinct
   * characters, and a 20,000-sample check of genuine random hex strings at
   * 32-64 characters found real ones landing as low as 9 distinct
   * characters purely by chance (birthday-paradox clustering). A threshold
   * anywhere near 16 would have randomly refused a meaningful fraction of
   * perfectly good production secrets on every boot attempt — the exact
   * failure mode a hardening pass must not introduce. This test runs many
   * genuinely random hex and base64 secret pairs — the two encodings this
   * codebase actually documents (`.env.example`, `docs/DEPLOYMENT.md`) —
   * and asserts every single one clears the guard.
   */
  it('never rejects genuinely random secrets, across many trials and encodings', () => {
    for (let i = 0; i < 200; i++) {
      const hexA = randomBytes(32).toString('hex');
      const hexB = randomBytes(32).toString('hex');
      expect(() =>
        assertProductionJwtSecretsAreStrong(
          validEnv({ JWT_ACCESS_SECRET: hexA, JWT_REFRESH_SECRET: hexB }) as never,
        ),
      ).not.toThrow();

      const b64A = randomBytes(32).toString('base64');
      const b64B = randomBytes(32).toString('base64');
      expect(() =>
        assertProductionJwtSecretsAreStrong(
          validEnv({ JWT_ACCESS_SECRET: b64A, JWT_REFRESH_SECRET: b64B }) as never,
        ),
      ).not.toThrow();
    }
  });

  it('is a no-op outside production, even with the exact .env.example placeholders', () => {
    for (const env of ['development', 'test', 'staging']) {
      expect(() =>
        assertProductionJwtSecretsAreStrong(
          validEnv({
            NODE_ENV: env,
            JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars-long',
            JWT_REFRESH_SECRET: 'change-me-refresh-secret-min-32-chars-long',
          }) as never,
        ),
      ).not.toThrow();
    }
  });

  it('rejects the exact .env.example access secret in production', () => {
    expect(() =>
      assertProductionJwtSecretsAreStrong(
        validEnv({ JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars-long' }) as never,
      ),
    ).toThrow(/placeholder\/example value/);
  });

  it('rejects the exact .env.example refresh secret in production', () => {
    expect(() =>
      assertProductionJwtSecretsAreStrong(
        validEnv({ JWT_REFRESH_SECRET: 'change-me-refresh-secret-min-32-chars-long' }) as never,
      ),
    ).toThrow(/placeholder\/example value/);
  });

  it.each([
    'ExampleAccessSecretThatIsThirtyTwoPlusChars',
    'a-placeholder-secret-that-is-long-enough-really',
    'YOUR-SECRET-GOES-HERE-AND-MUST-BE-32-CHARS',
    'this-is-an-insecure-default-secret-value-here',
    'test-secret-value-that-satisfies-min-length-32',
  ])('rejects known placeholder pattern: %s', (placeholder) => {
    expect(() =>
      assertProductionJwtSecretsAreStrong(validEnv({ JWT_ACCESS_SECRET: placeholder }) as never),
    ).toThrow(/placeholder\/example value/);
  });

  it('rejects a low-entropy secret (repeated character) even if long enough', () => {
    expect(() =>
      assertProductionJwtSecretsAreStrong(
        validEnv({ JWT_ACCESS_SECRET: 'a'.repeat(40) }) as never,
      ),
    ).toThrow(/does not look cryptographically random/);
  });

  it('rejects a low-entropy secret (short repeating pattern) even if long enough', () => {
    expect(() =>
      assertProductionJwtSecretsAreStrong(
        validEnv({ JWT_ACCESS_SECRET: 'ab12'.repeat(10) }) as never,
      ),
    ).toThrow(/does not look cryptographically random/);
  });

  it('rejects duplicated access/refresh secrets, even when each is individually strong', () => {
    const shared = strongSecret();
    expect(() =>
      assertProductionJwtSecretsAreStrong(
        validEnv({ JWT_ACCESS_SECRET: shared, JWT_REFRESH_SECRET: shared }) as never,
      ),
    ).toThrow(/must not be the same value/);
  });

  it('reports every problem at once rather than stopping at the first', () => {
    try {
      assertProductionJwtSecretsAreStrong(
        validEnv({
          JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars-long',
          JWT_REFRESH_SECRET: 'change-me-access-secret-min-32-chars-long',
        }) as never,
      );
      fail('expected assertProductionJwtSecretsAreStrong to throw');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toMatch(/JWT_ACCESS_SECRET/);
      expect(message).toMatch(/JWT_REFRESH_SECRET/);
      expect(message).toMatch(/must not be the same value/);
    }
  });
});

/**
 * End-to-end through the real `validate()` entrypoint `ConfigModule.forRoot`
 * actually calls at boot — proves the guard is wired in, not just present
 * as a standalone function nothing calls.
 */
describe('validate() — production boot integration', () => {
  const strongSecret = () => randomBytes(32).toString('hex');

  it('throws for production boot with the exact .env.example JWT secrets', () => {
    expect(() =>
      validate({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
        JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars-long',
        JWT_REFRESH_SECRET: 'change-me-refresh-secret-min-32-chars-long',
      }),
    ).toThrow(/Refusing to start in production/);
  });

  it('throws for production boot with an empty secret (fails the length check first)', () => {
    expect(() =>
      validate({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
        JWT_ACCESS_SECRET: '',
        JWT_REFRESH_SECRET: strongSecret(),
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('throws for production boot with duplicated strong secrets', () => {
    const shared = strongSecret();
    expect(() =>
      validate({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
        JWT_ACCESS_SECRET: shared,
        JWT_REFRESH_SECRET: shared,
      }),
    ).toThrow(/must not be the same value/);
  });

  it('succeeds for production boot with two strong, distinct secrets', () => {
    expect(() =>
      validate({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
        JWT_ACCESS_SECRET: strongSecret(),
        JWT_REFRESH_SECRET: strongSecret(),
      }),
    ).not.toThrow();
  });

  it('does not enforce the strength guard in development, so local .env.example values still boot', () => {
    expect(() =>
      validate({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
        JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars-long',
        JWT_REFRESH_SECRET: 'change-me-refresh-secret-min-32-chars-long',
      }),
    ).not.toThrow();
  });

  it('does not enforce the strength guard in test, so the existing test env keeps working', () => {
    expect(() =>
      validate({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
        JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars-long',
        JWT_REFRESH_SECRET: 'change-me-refresh-secret-min-32-chars-long',
      }),
    ).not.toThrow();
  });
});
