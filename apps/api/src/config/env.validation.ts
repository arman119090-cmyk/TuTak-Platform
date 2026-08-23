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

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' })
  JWT_REFRESH_SECRET: string;
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
  if (looksLikePlaceholderSecret(env.JWT_REFRESH_SECRET)) {
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
  if (hasLowEntropy(env.JWT_REFRESH_SECRET)) {
    problems.push(
      'JWT_REFRESH_SECRET does not look cryptographically random (too few distinct ' +
        'characters for its length). Generate a real one: openssl rand -hex 32',
    );
  }
  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
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
  return validatedConfig;
}
