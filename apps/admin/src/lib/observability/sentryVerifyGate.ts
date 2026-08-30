import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The gate on the non-production Sentry verification route.
 *
 * ## Why none of this reads NODE_ENV
 *
 * The first version of the route was gated on `process.env.NODE_ENV !==
 * 'production'`. That does not work in a Next.js app, and the failure is
 * silent: `next build` replaces `process.env.NODE_ENV` with a literal, the
 * build runs with `NODE_ENV=production` (both dashboards' Dockerfiles set it),
 * so the guard folds to a constant `true` and the rest of the condition is
 * dead-code-eliminated. The route then returns 404 unconditionally, in every
 * deployment, no matter what the runtime environment says — verified in
 * docs/SENTRY_STAGING_ACTIVATION_RU.md by request and by grepping the
 * compiled bundle, which no longer contained either variable name.
 *
 * So the decision is made from variables that only exist at runtime, and the
 * whole environment is passed in as an argument rather than read here: a
 * value the bundler cannot see is a value it cannot fold away, and a
 * function that takes its inputs can be tested without a server.
 *
 * ## What has to be true
 *
 * All four, or the answer is no:
 *
 *  - `APP_ENV` is exactly one of the non-production names below. Not
 *    "anything but production" — an unset or misspelled value denies, so a
 *    box that forgot to declare what it is cannot fire the probe;
 *  - `SENTRY_VERIFY_ENABLED` is exactly `true`, an explicit opt-in separate
 *    from the environment name;
 *  - `SENTRY_VERIFY_TOKEN` is configured;
 *  - the request carries that token in the dedicated header.
 *
 * Every failure produces the same 404 with no body, so the route cannot be
 * used to probe which of the four is missing.
 */

/** The header a caller puts the shared token in. */
export const VERIFY_TOKEN_HEADER = 'x-sentry-verify-token';

/**
 * The only environments the probe may fire in. `production` is absent, and
 * so is every name nobody thought of — the list is what is permitted, not
 * what is forbidden.
 */
export const ALLOWED_VERIFY_APP_ENVS: readonly string[] = ['development', 'staging', 'preview'];

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` needs equal-length buffers and throws otherwise, which
 * would itself leak the expected length; hashing both sides first makes them
 * both 32 bytes regardless of input, so the only thing compared in variable
 * time is nothing at all.
 */
export function timingSafeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/**
 * A bag of environment values, not `NodeJS.ProcessEnv`: Next.js narrows the
 * global `process.env` type, and the route needs to hand this function the
 * live object rather than a copy assembled at module scope, which the
 * bundler could see through.
 */
export type VerifyGateEnv = Record<string, string | undefined>;

export function isVerifyRequestAllowed(env: VerifyGateEnv, suppliedToken: string | null): boolean {
  const appEnv = env.APP_ENV;
  if (!appEnv || !ALLOWED_VERIFY_APP_ENVS.includes(appEnv)) return false;
  if (env.SENTRY_VERIFY_ENABLED !== 'true') return false;

  const expected = env.SENTRY_VERIFY_TOKEN;
  if (!expected) return false;
  if (!suppliedToken) return false;

  return timingSafeEquals(suppliedToken, expected);
}
