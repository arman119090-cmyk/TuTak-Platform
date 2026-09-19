// `validate()` runs `class-transformer`'s `plainToInstance`, which reads
// design-time type metadata via `Reflect.getMetadata` — patched onto the
// global `Reflect` object by this import, exactly as `main.ts` does as its
// own first line, for the same reason. Needed here because Jest gives each
// spec file its own sandboxed module registry, so another spec file having
// already imported this polyfill does not help this one.
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { assertProviderPaymentsConfigured, assertProductionJwtSecretsAreStrong, validate } from './env.validation';

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
/**
 * The retiring key during a rotation, and the secret that never did anything.
 *
 * Both were gaps in the rotation work: `JWT_ACCESS_SECRET_PREVIOUS` was added
 * as a feature and never validated, so a weak retiring key would have been
 * accepted for the length of a rotation window; and `JWT_REFRESH_SECRET` was
 * found to be unused but left required, which is a deployment obligation that
 * buys nothing and implies something false.
 */
describe('rotation and the deprecated refresh secret', () => {
  const strongSecret = () => randomBytes(32).toString('hex');

  const prodEnv = (overrides: Partial<Record<string, unknown>> = {}) => ({
    NODE_ENV: 'production' as const,
    PORT: 4000,
    DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
    JWT_ACCESS_SECRET: strongSecret(),
    ...overrides,
  });

  it('accepts a deployment that sets no refresh secret at all', () => {
    // It is read by nothing. Requiring it made deployments carry a secret
    // that does not exist as far as the running system is concerned.
    expect(() => assertProductionJwtSecretsAreStrong(prodEnv() as never)).not.toThrow();
  });

  it('still refuses a weak refresh secret when one is supplied', () => {
    expect(() =>
      assertProductionJwtSecretsAreStrong(prodEnv({ JWT_REFRESH_SECRET: 'aaaaaaaa'.repeat(8) }) as never),
    ).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('accepts a genuine rotation: a strong, different retiring key', () => {
    expect(() =>
      assertProductionJwtSecretsAreStrong(
        prodEnv({ JWT_ACCESS_SECRET_PREVIOUS: strongSecret() }) as never,
      ),
    ).not.toThrow();
  });

  /**
   * A retiring key verifies real tokens for the length of the window. A
   * rotation is not an excuse to accept a weak one for fifteen minutes.
   */
  it('refuses a weak retiring key', () => {
    expect(() =>
      assertProductionJwtSecretsAreStrong(
        prodEnv({ JWT_ACCESS_SECRET_PREVIOUS: 'bbbbbbbb'.repeat(8) }) as never,
      ),
    ).toThrow(/JWT_ACCESS_SECRET_PREVIOUS/);
  });

  it('refuses a placeholder as the retiring key', () => {
    expect(() =>
      assertProductionJwtSecretsAreStrong(
        prodEnv({ JWT_ACCESS_SECRET_PREVIOUS: 'change-me-example-secret-min-32-chars-x' }) as never,
      ),
    ).toThrow(/JWT_ACCESS_SECRET_PREVIOUS/);
  });

  /**
   * Setting the retiring key to the live one is the mistake that looks like
   * a rotation and is not one: nothing has changed, and the deployment now
   * believes it is mid-rotation.
   */
  it('refuses a "rotation" to the same value', () => {
    const same = strongSecret();
    expect(() =>
      assertProductionJwtSecretsAreStrong(
        { ...prodEnv({ JWT_ACCESS_SECRET: same }), JWT_ACCESS_SECRET_PREVIOUS: same } as never,
      ),
    ).toThrow(/nothing is being rotated/i);
  });
});

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

/**
 * Turning the provider route on without the provider configured must refuse
 * to boot. The first version let it boot and fail at the first customer —
 * leaving an `INITIATED` attempt behind, which is worse than not starting.
 */
describe('assertProviderPaymentsConfigured', () => {
  const on = (overrides: Record<string, unknown> = {}) => ({
    TUTAK_PSP_ENABLED: 'true',
    IDRAM_MERCHANT_ID: '110000110',
    IDRAM_SECRET_KEY: 'a-real-secret',
    IDRAM_FORM_ACTION: 'https://sandbox.idram.example/pay',
    ...overrides,
  });

  it('lets a deployment with the route off boot with nothing set', () => {
    expect(() => assertProviderPaymentsConfigured({})).not.toThrow();
    expect(() => assertProviderPaymentsConfigured({ TUTAK_PSP_ENABLED: 'false' })).not.toThrow();
  });

  it('accepts the route on with everything set', () => {
    expect(() => assertProviderPaymentsConfigured(on())).not.toThrow();
  });

  it.each(['IDRAM_MERCHANT_ID', 'IDRAM_SECRET_KEY', 'IDRAM_FORM_ACTION'])(
    'refuses to boot with the route on and %s missing',
    (name) => {
      expect(() => assertProviderPaymentsConfigured(on({ [name]: undefined }))).toThrow(name);
      expect(() => assertProviderPaymentsConfigured(on({ [name]: '   ' }))).toThrow(name);
    },
  );

  /**
   * No silent production default any more, and no plain-HTTP action either:
   * the form carries the amount and the bill the customer is about to pay.
   */
  it('refuses a form action that is not https', () => {
    expect(() =>
      assertProviderPaymentsConfigured(on({ IDRAM_FORM_ACTION: 'http://banking.idram.am/x' })),
    ).toThrow(/https/);
  });
});
