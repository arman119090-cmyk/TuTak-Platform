/**
 * Sends one synthetic error to Sentry and exits — the controlled way to
 * check "does an event actually reach the project" without shipping a route
 * that intentionally throws.
 *
 * Refuses outright in production, the same posture `seed-demo.ts` takes for
 * the same reason: this is a diagnostic for a developer or an operator
 * standing up a new environment, never something a running production
 * instance should be able to trigger on request.
 *
 * Which environment that is comes from `APP_ENV`, not `NODE_ENV`. Every
 * deployed environment sets `NODE_ENV=production` — that is what makes
 * frameworks and guards take their production path, and staging is a real
 * network-reachable deployment that needs them (see `config/app-environment.ts`).
 * Keying the refusal on `NODE_ENV` therefore refused on staging too, which is
 * precisely where an operator standing up the environment needs to prove that
 * events arrive. `apps/admin`'s verification route already made this move; the
 * list below is the same one it allows, and for the same reason: it names what
 * is permitted, so an unset or misspelled value refuses rather than passes.
 *
 * Usage: `pnpm --filter @tutak/api sentry:verify` (needs `SENTRY_DSN` set;
 * without it this prints why and exits non-zero rather than pretending to
 * have sent anything).
 */
import * as Sentry from '@sentry/node';
import { resolveAppEnvironment } from '../config/app-environment';
import { initSentry } from '../common/observability/sentry';

/**
 * What the operator actually looks for in Sentry.
 *
 * The privacy sanitizer drops every free-text field, the error's own message
 * included, so a per-run marker string embedded in one would never arrive.
 * A class *name* does arrive: `sanitizeSentryEvent` keeps `exception.type`
 * whenever it looks like an identifier, which this does. Combined with the
 * allowlisted `kind: 'sentry-verify'` tag, that is the whole search — and
 * the script prints the send time locally so a run can be told from the one
 * before it.
 */
export class SentryVerificationProbe extends Error {
  constructor() {
    super('TuTak Sentry verification probe');
    this.name = 'SentryVerificationProbe';
  }
}

export class SentryVerifyRefusedInProductionError extends Error {
  constructor(appEnv: string) {
    super(
      `sentry-verify refuses to run in APP_ENV=${appEnv || '<unset>'}. ` +
        `Allowed: ${ALLOWED_VERIFY_APP_ENVS.join(', ')}.`,
    );
    this.name = 'SentryVerifyRefusedInProductionError';
  }
}

/**
 * The environments the probe may fire in. `production` is absent, and so is
 * every name nobody thought of — an unset or misspelled `APP_ENV` refuses.
 * Deliberately the same list as `apps/admin/src/lib/observability/sentryVerifyGate.ts`.
 */
export const ALLOWED_VERIFY_APP_ENVS: readonly string[] = ['development', 'staging', 'test'];

/** The whole non-production gate, isolated so a test can assert it without touching `process.exit`. */
export function assertNotProduction(appEnv: string): void {
  if (!ALLOWED_VERIFY_APP_ENVS.includes(appEnv)) {
    throw new SentryVerifyRefusedInProductionError(appEnv);
  }
}

export async function runSentryVerify(appEnv: string): Promise<{ sent: boolean; reason?: string }> {
  assertNotProduction(appEnv);

  const started = initSentry();
  if (!started) {
    return { sent: false, reason: 'SENTRY_DSN is not set — Sentry was never initialized.' };
  }

  Sentry.withScope((scope) => {
    scope.setTag('service', 'api');
    scope.setTag('kind', 'sentry-verify');
    Sentry.captureException(new SentryVerificationProbe());
  });

  const flushed = await Sentry.flush(5000);
  if (!flushed) {
    return { sent: false, reason: 'Sentry did not confirm the event was flushed within 5s.' };
  }

  return { sent: true, reason: `sent at ${new Date().toISOString()}` };
}

async function main() {
  const appEnv = resolveAppEnvironment(process.env);
  try {
    const result = await runSentryVerify(appEnv);
    if (!result.sent) {
      console.error(result.reason);
      process.exit(1);
    }
    console.log(`Sent (${result.reason}).`);
    console.log(
      'In the Sentry project configured by SENTRY_DSN, look for a SentryVerificationProbe',
    );
    console.log('event tagged kind=sentry-verify, service=api, at that time.');
  } catch (err) {
    if (err instanceof SentryVerifyRefusedInProductionError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

// Only runs the side-effecting entry point when executed directly (`ts-node
// src/scripts/sentry-verify.ts`), not when a test imports the exports above.
if (require.main === module) {
  void main();
}
