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
 * Usage: `pnpm --filter @tutak/api sentry:verify` (needs `SENTRY_DSN` set;
 * without it this prints why and exits non-zero rather than pretending to
 * have sent anything).
 */
import * as Sentry from '@sentry/node';
import { initSentry } from '../common/observability/sentry';

export class SentryVerifyRefusedInProductionError extends Error {
  constructor() {
    super('sentry-verify refuses to run with NODE_ENV=production.');
    this.name = 'SentryVerifyRefusedInProductionError';
  }
}

/** The whole non-production gate, isolated so a test can assert it without touching `process.exit`. */
export function assertNotProduction(nodeEnv: string): void {
  if (nodeEnv === 'production') {
    throw new SentryVerifyRefusedInProductionError();
  }
}

export async function runSentryVerify(nodeEnv: string): Promise<{ sent: boolean; reason?: string }> {
  assertNotProduction(nodeEnv);

  const started = initSentry();
  if (!started) {
    return { sent: false, reason: 'SENTRY_DSN is not set — Sentry was never initialized.' };
  }

  const marker = `tutak-api-sentry-verify-${new Date().toISOString()}`;
  Sentry.withScope((scope) => {
    scope.setTag('service', 'api');
    scope.setTag('kind', 'sentry-verify');
    Sentry.captureException(new Error(`TuTak Sentry verification: ${marker}`));
  });

  const flushed = await Sentry.flush(5000);
  if (!flushed) {
    return { sent: false, reason: 'Sentry did not confirm the event was flushed within 5s.' };
  }

  return { sent: true, reason: marker };
}

async function main() {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  try {
    const result = await runSentryVerify(nodeEnv);
    if (!result.sent) {
      console.error(result.reason);
      process.exit(1);
    }
    console.log(`Sent. Marker: ${result.reason}`);
    console.log('Look for that marker in the Sentry project configured by SENTRY_DSN.');
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
