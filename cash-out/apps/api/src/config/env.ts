import { z } from 'zod';

/**
 * Environment validation.
 *
 * The process refuses to start on an invalid or missing value rather than
 * discovering it at the first payout. Anything that guards money — key material,
 * the provider mode, the environment name — is validated here, and several
 * settings are additionally forbidden from taking their development value when
 * `NODE_ENV=production`.
 */

const hexKey = (bytes: number) =>
  z.string().regex(new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`), `must be ${bytes} bytes of hex`);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Used in logs, alerts and the admin header so nobody operates the wrong one. */
    DEPLOYMENT_ENV: z.enum(['local', 'staging', 'production']).default('local'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().url(),

    /** AES-256-GCM key for column encryption (provider tokens, TOTP secrets). */
    ENCRYPTION_KEY: hexKey(32),
    /** Key id written next to every ciphertext, so keys can be rotated. */
    ENCRYPTION_KEY_ID: z.string().min(1).default('k1'),
    /**
     * Keys retired by a rotation, still needed to *read* rows not yet
     * re-encrypted: `id:hex,id:hex`. Never used to encrypt. Remove an entry
     * only after the rotation job reports zero rows under that id.
     */
    ENCRYPTION_PREVIOUS_KEYS: z
      .string()
      .default('')
      .transform((raw) =>
        raw
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((entry) => {
            const [id, hex] = entry.split(':');
            return { id: id ?? '', hex: hex ?? '' };
          }),
      )
      .pipe(
        z.array(
          z.object({
            id: z.string().min(1),
            hex: hexKey(32),
          }),
        ),
      ),
    /** HMAC pepper for deterministic fingerprints (card dedupe, licence digits). */
    FINGERPRINT_KEY: hexKey(32),
    /** HMAC key for quote signatures. */
    QUOTE_SIGNING_KEY: hexKey(32),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(3600)
      .max(60 * 60 * 24 * 90)
      .default(60 * 60 * 24 * 30),

    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(15).max(600).default(60),
    /** Per phone number, per rolling hour. The gateway costs real money. */
    OTP_MAX_PER_PHONE_PER_HOUR: z.coerce.number().int().min(1).max(50).default(5),
    OTP_MAX_PER_IP_PER_HOUR: z.coerce.number().int().min(1).max(500).default(30),

    /**
     * Where rate-limit counters live. `memory` is correct for exactly one API
     * process and is refused in production; `redis` is shared by every
     * instance. During a Redis outage `deny` refuses the limited endpoints
     * (OTP, PIN, admin sign-in) with a short Retry-After; `allow` lets them
     * through unlimited. Deny is the safe default: those endpoints are
     * precisely the ones an attacker wants unlimited.
     */
    RATE_LIMIT_BACKEND: z.enum(['memory', 'redis']).default('memory'),
    REDIS_URL: z.string().url().optional(),
    REDIS_KEY_PREFIX: z.string().min(1).default('cashout:rl:'),
    RATE_LIMIT_REDIS_OUTAGE: z.enum(['deny', 'allow']).default('deny'),

    /**
     * `mock` runs the whole product against in-memory fakes. It is the default
     * for local work and is *rejected* in production, so nobody can accidentally
     * deploy a build that pretends to move money.
     */
    YANDEX_MODE: z.enum(['mock', 'live']).default('mock'),
    YANDEX_BASE_URL: z.string().url().default('https://fleet-api.taxi.yandex.net'),
    YANDEX_CLIENT_ID: z.string().optional(),
    YANDEX_API_KEY: z.string().optional(),
    YANDEX_PARK_ID: z.string().optional(),
    /**
     * Fleet API v3 request-schema `version` field. The value the current
     * documentation prescribes must be confirmed against the reference before
     * going live; see docs/YANDEX_INTEGRATION.md.
     */
    YANDEX_TRANSACTION_VERSION: z.string().min(1).default('1'),
    /** `data.kind` sent on the debit that funds a payout. */
    YANDEX_PAYOUT_KIND: z.string().min(1).default('payout'),
    /**
     * `data.kind` sent on the compensating credit. Whether a reversal is a
     * `payout` with the opposite sign or a different kind is not settled by the
     * documentation we have; it is configuration so the answer does not need a
     * deploy.
     */
    YANDEX_REVERSAL_KIND: z.string().min(1).default('payout'),
    YANDEX_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
    /** Minimum gap between calls for one park. Yandex throttles per park. */
    YANDEX_MIN_INTERVAL_MS: z.coerce.number().int().min(0).max(5000).default(500),

    /**
     * The payout rail. `mock` is the in-memory iDram fake (rejected in
     * production); `live` has no adapter yet and refuses to start, because
     * there is no iDram payout API contract in this repository to build one on.
     */
    PROVIDER_MODE: z.enum(['mock', 'live']).default('mock'),
    PROVIDER_NAME: z.string().default('idram-mock'),
    IDRAM_BASE_URL: z.string().url().optional(),
    IDRAM_MERCHANT_ID: z.string().optional(),
    IDRAM_API_KEY: z.string().optional(),
    PROVIDER_WEBHOOK_SECRET: z.string().min(32).optional(),
    PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
    /** How old a webhook may be before it is treated as a replay. */
    WEBHOOK_MAX_SKEW_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

    /** Comma-separated origins for the admin panel. Never `*` in production. */
    CORS_ORIGINS: z.string().default('http://localhost:3001'),

    QUOTE_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(120),
    /** How long a worker may hold a withdrawal before another may take it over. */
    WITHDRAWAL_LEASE_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
    /** After this, a withdrawal that has not finished escalates to a human. */
    WITHDRAWAL_SLA_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
    /**
     * Whether confirming a withdrawal immediately kicks the orchestrator in the
     * background. Production wants this; tests turn it off so that each step is
     * driven explicitly and a race cannot make a test lie.
     */
    ORCHESTRATOR_AUTO_ADVANCE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    /**
     * Push delivery. `mock` records notifications without sending anything and
     * is allowed in production — it protects no money — but the integrations
     * tile shows it as MOCK and the process logs it at start-up. `live` has no
     * adapter yet and refuses to start.
     */
    PUSH_MODE: z.enum(['mock', 'live']).default('mock'),

    /** How often an ON_THRESHOLD rule re-reads the balance. */
    AUTO_PAYOUT_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
    /** Consecutive failed evaluations before a rule pauses itself. */
    AUTO_PAYOUT_MAX_FAILURES: z.coerce.number().int().min(1).max(20).default(3),

    ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
    ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.RATE_LIMIT_BACKEND === 'redis' && !env.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when RATE_LIMIT_BACKEND=redis',
      });
    }
    const previousIds = env.ENCRYPTION_PREVIOUS_KEYS.map((key) => key.id);
    if (previousIds.includes(env.ENCRYPTION_KEY_ID)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_PREVIOUS_KEYS'],
        message: 'ENCRYPTION_PREVIOUS_KEYS must not contain the active ENCRYPTION_KEY_ID',
      });
    }
    if (new Set(previousIds).size !== previousIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_PREVIOUS_KEYS'],
        message: 'ENCRYPTION_PREVIOUS_KEYS contains a duplicate key id',
      });
    }
    if (env.NODE_ENV !== 'production') return;

    if (env.RATE_LIMIT_BACKEND !== 'redis') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RATE_LIMIT_BACKEND'],
        message:
          'RATE_LIMIT_BACKEND=memory is not allowed in production — it limits one process only',
      });
    }

    if (env.YANDEX_MODE === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['YANDEX_MODE'],
        message: 'YANDEX_MODE=mock is not allowed in production — it does not move real balances',
      });
    }
    if (env.PROVIDER_MODE === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PROVIDER_MODE'],
        message: 'PROVIDER_MODE=mock is not allowed in production — it does not move real money',
      });
    }
    if (env.YANDEX_MODE === 'live') {
      for (const key of ['YANDEX_CLIENT_ID', 'YANDEX_API_KEY', 'YANDEX_PARK_ID'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when YANDEX_MODE=live`,
          });
        }
      }
    }
    if (env.PROVIDER_MODE === 'live') {
      for (const key of [
        'IDRAM_BASE_URL',
        'IDRAM_MERCHANT_ID',
        'IDRAM_API_KEY',
        'PROVIDER_WEBHOOK_SECRET',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when PROVIDER_MODE=live`,
          });
        }
      }
    }
    if (env.CORS_ORIGINS.split(',').some((origin) => origin.trim() === '*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'A wildcard CORS origin is not allowed in production',
      });
    }
    if (env.CORS_ORIGINS.includes('localhost')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'A localhost CORS origin is not allowed in production',
      });
    }
    if (env.DEPLOYMENT_ENV === 'local') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEPLOYMENT_ENV'],
        message: 'DEPLOYMENT_ENV=local is not a production deployment',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return parsed.data;
}

export const ENV = Symbol('CASHOUT_ENV');
