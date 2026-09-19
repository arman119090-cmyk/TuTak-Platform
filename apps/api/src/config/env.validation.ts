import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

enum Environment {
  Development = 'development',
  /**
   * Launch-readiness audit (2026-08-16): `docs/DEPLOYMENT.md` §1 recommends
   * running staging as `development`, since staging legitimately has no real
   * SMS carrier/acquirer/Redis and should not be blocked booting by the
   * same guards `production` needs for those. But `development` also turns
   * off two things that have nothing to do with commercial credentials and
   * everything to do with a server real traffic can reach: the
   * CORS-must-be-configured boot guard (`main.ts`) and disabling the
   * Swagger UI, which then exposes the entire API surface at `/docs` to
   * whoever finds a staging URL. A real `Staging` value lets those two stay
   * on without also demanding a live carrier/acquirer contract just to boot
   * a rehearsal environment.
   */
  Staging = 'staging',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @IsOptional()
  PORT: number = 4000;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET: string;

  /**
   * The secret being retired during a rotation.
   *
   * Optional, because outside a rotation window it must not be set at all —
   * a second accepted key that nobody is retiring is simply a second live
   * key. Held to the same length as the live one when it is present: a
   * rotation is not an excuse to accept a weaker key for fifteen minutes,
   * and this check was missing when the feature was first added.
   */
  @IsOptional()
  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET_PREVIOUS must be at least 32 characters' })
  JWT_ACCESS_SECRET_PREVIOUS?: string;

  /**
   * **Deprecated, and it never did anything.**
   *
   * Refresh tokens are opaque random strings stored as SHA-256 hashes in
   * `refresh_tokens`; they are not JWTs, and nothing in the API reads this
   * value — verified by searching for it. It was required at boot, which is
   * worse than harmless: a deployment that rotated it believing sessions
   * were being cut was mistaken about what it had done.
   *
   * Now optional, so a deployment need not carry a secret that does nothing,
   * but still quality-checked when present — a value that exists should not
   * be a weak one, and the checks below also stop it being set equal to the
   * access secret.
   */
  @IsOptional()
  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' })
  JWT_REFRESH_SECRET?: string;
}

/**
 * Security hardening (2026-08-23, `docs/PENTEST_2026-08-23.md` companion
 * pass): the class-validator checks above only bound *length* — `@MinLength
 * (32)` happily accepts `.env.example`'s own
 * `change-me-access-secret-min-32-chars-long` (41 characters) verbatim, in
 * every environment including `production`. Reproduced live against this
 * exact build before this guard existed: `validate()` returned normally for
 * `NODE_ENV=production` with both example secrets copied byte-for-byte from
 * `.env.example`, and separately for two *different*, individually-random
 * 64-hex-char secrets that happened to be equal to each other (a copy-paste
 * of one value into both env vars) — nothing rejected either shape.
 *
 * Same discipline as `SmsModule`/`MediaStorageModule`/`PaymentsModule`:
 * outside production, anything the length check allows is fine (a
 * developer's own machine, and this repo's own test fixtures, use short,
 * obviously-fake secrets on purpose). In production, a predictable or
 * shared JWT secret is a total authentication bypass — anyone who can guess
 * or find it can mint access/refresh tokens for any user, permission
 * level, or partner scope, so it gets the same "refuse to boot" treatment
 * as a missing SMS carrier, not a warning.
 */
const PLACEHOLDER_SECRET_PATTERNS: RegExp[] = [
  /change[-_]?me/i,
  /change[-_]?this/i,
  /example/i,
  /placeholder/i,
  /your[-_]?secret/i,
  /^secret$/i,
  /^password/i,
  /insecure/i,
  /^(test|dev|demo|sample|dummy|fake)[-_]?secret/i,
  /^x+$/i,
];

function looksLikePlaceholderSecret(value: string): boolean {
  return PLACEHOLDER_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * A crude but effective floor on randomness: a secret built from a
 * repeated or short cyclic pattern (`aaaa…a`, `ab12ab12…`) uses only a
 * handful of distinct characters relative to its length, however long it
 * is padded out to. Eight, not something closer to the 16-symbol alphabet
 * `openssl rand -hex 32` draws from: hex output only has 16 *possible*
 * distinct characters, and a 20,000-sample check of genuinely random
 * 32-to-64-character hex strings found real ones occasionally land as low
 * as 9 distinct characters by chance (birthday-paradox clustering, not a
 * weak secret) — a threshold anywhere near 16 would have randomly refused
 * a meaningful fraction of perfectly good production secrets. Eight stays
 * far below that observed floor while still refusing anything a human
 * would plausibly type or repeat as a placeholder.
 */
function hasLowEntropy(value: string): boolean {
  return new Set(value).size < 8;
}

/**
 * Production-only: refuses to boot on a JWT secret that is a known
 * placeholder, is low-entropy, or is identical to the *other* secret
 * (an access token forged the same way a refresh token would be, and vice
 * versa, collapsing two independent trust boundaries into one). Exported so
 * `env.validation.spec.ts` can pin every rejected/accepted shape directly,
 * the same way `configuration.spec.ts` pins `assertPoolSplitSums`.
 */
export function assertProductionJwtSecretsAreStrong(env: EnvironmentVariables): void {
  if (env.NODE_ENV !== Environment.Production) {
    return;
  }
  const problems: string[] = [];
  if (looksLikePlaceholderSecret(env.JWT_ACCESS_SECRET)) {
    problems.push(
      'JWT_ACCESS_SECRET looks like a placeholder/example value (matches a known ' +
        'change-me/example/test pattern). Generate a real one: openssl rand -hex 32',
    );
  }
  if (env.JWT_REFRESH_SECRET && looksLikePlaceholderSecret(env.JWT_REFRESH_SECRET)) {
    problems.push(
      'JWT_REFRESH_SECRET looks like a placeholder/example value (matches a known ' +
        'change-me/example/test pattern). Generate a real one: openssl rand -hex 32',
    );
  }
  if (hasLowEntropy(env.JWT_ACCESS_SECRET)) {
    problems.push(
      'JWT_ACCESS_SECRET does not look cryptographically random (too few distinct ' +
        'characters for its length). Generate a real one: openssl rand -hex 32',
    );
  }
  if (env.JWT_REFRESH_SECRET && hasLowEntropy(env.JWT_REFRESH_SECRET)) {
    problems.push(
      'JWT_REFRESH_SECRET does not look cryptographically random (too few distinct ' +
        'characters for its length). Generate a real one: openssl rand -hex 32',
    );
  }
  if (env.JWT_ACCESS_SECRET_PREVIOUS) {
    if (looksLikePlaceholderSecret(env.JWT_ACCESS_SECRET_PREVIOUS)) {
      problems.push(
        'JWT_ACCESS_SECRET_PREVIOUS looks like a placeholder/example value. A retiring ' +
          'key still signs nothing but still verifies — it must be a real one.',
      );
    }
    if (hasLowEntropy(env.JWT_ACCESS_SECRET_PREVIOUS)) {
      problems.push(
        'JWT_ACCESS_SECRET_PREVIOUS does not look cryptographically random (too few ' +
          'distinct characters).',
      );
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_ACCESS_SECRET_PREVIOUS) {
      problems.push(
        'JWT_ACCESS_SECRET_PREVIOUS is the same value as JWT_ACCESS_SECRET, so nothing ' +
          'is being rotated. Set it to the key you are retiring, or unset it.',
      );
    }
  }
  if (
    env.JWT_ACCESS_SECRET &&
    env.JWT_REFRESH_SECRET &&
    env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
  ) {
    problems.push(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must not be the same value — a leaked ' +
        'or forged token of one kind must not also be valid as the other.',
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with unsafe JWT secrets:\n${problems.join('\n')}`,
    );
  }
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }
  assertProductionJwtSecretsAreStrong(validatedConfig);
  assertProviderPaymentsConfigured(config);
  return validatedConfig;
}

/**
 * Turning the in-TuTak payment route on is a promise that bills can be
 * opened and callbacks verified. A deployment that makes the promise
 * without the credentials or the form action behind it must not boot —
 * fail closed at start, not at the first customer.
 *
 * Read from the raw config rather than the validated class so the three
 * variables stay optional for every deployment that has the route off,
 * which is all of them until activation.
 */
export function assertProviderPaymentsConfigured(config: Record<string, unknown>): void {
  if (config.TUTAK_PSP_ENABLED !== 'true') return;

  const missing = ['IDRAM_MERCHANT_ID', 'IDRAM_SECRET_KEY', 'IDRAM_FORM_ACTION'].filter(
    (name) => typeof config[name] !== 'string' || (config[name] as string).trim() === '',
  );
  if (missing.length > 0) {
    throw new Error(
      `TUTAK_PSP_ENABLED=true but ${missing.join(', ')} not set. The provider route cannot ` +
        'open a bill it could not hand off or verify. Set them, or turn the route off.',
    );
  }

  const action = String(config.IDRAM_FORM_ACTION);
  if (!/^https:\/\//.test(action)) {
    throw new Error(
      `IDRAM_FORM_ACTION must be an https URL (got "${action}"). A customer's payment form ` +
        'must not be posted over plain HTTP.',
    );
  }

  // Real money needs a human on the other end of the alert channel. Without
  // a webhook, a callback the worker gave up on — a customer who paid for a
  // purchase that never completed — goes to a console line in a container
  // nobody is attached to. `AlertsModule` only *warns* about a missing
  // webhook, because the ordinary till route must not go down over a
  // notification endpoint; the provider route is the one where money can be
  // taken and stay unaccounted for, so it is the one that must not start blind.
  const webhook =
    typeof config.ALERT_WEBHOOK_URL === 'string' ? config.ALERT_WEBHOOK_URL.trim() : '';
  if (webhook === '') {
    throw new Error(
      'TUTAK_PSP_ENABLED=true but ALERT_WEBHOOK_URL not set. A dead-lettered payment callback ' +
        'would be logged and nobody told. Set the webhook and prove it with `pnpm alert:verify`, ' +
        'or turn the route off.',
    );
  }
  if (!/^https:\/\//.test(webhook)) {
    throw new Error(
      `ALERT_WEBHOOK_URL must be an https URL when TUTAK_PSP_ENABLED=true (got "${webhook}").`,
    );
  }
}
