import * as Sentry from '@sentry/nextjs';
import { isVerifyRequestAllowed, VERIFY_TOKEN_HEADER } from '@/lib/observability/sentryVerifyGate';

/**
 * Non-production-only Sentry verification endpoint.
 *
 * Sends one synthetic error to whatever DSN this deployment is configured
 * with, so a human can confirm events actually reach Sentry without waiting
 * for a real bug. Every condition that has to hold — and why the gate reads
 * no `NODE_ENV` — is in `sentryVerifyGate.ts`.
 *
 * POST rather than GET on purpose: a GET is something a crawler follows, a
 * browser prefetches, and a link in a chat message unfurls. None of those
 * should be able to put an event in Sentry.
 *
 * The response is a boolean and nothing else — no stack trace, no config, no
 * request data, and never any hint about which part of the gate refused.
 */
class SentryVerificationProbe extends Error {
  constructor() {
    super('TuTak Sentry verification probe');
    this.name = 'SentryVerificationProbe';
  }
}

/**
 * Route-level opt out of every caching layer Next.js has. The gate is a
 * runtime decision; a cached 200 from a staging deploy that later became
 * something else would be a decision made once and replayed forever.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = {
  'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
  pragma: 'no-cache',
} as const;

function notFound(): Response {
  return new Response(null, { status: 404, headers: { ...NO_STORE } });
}

export async function POST(request: Request): Promise<Response> {
  // Read at request time, from the live environment. The supplied token is
  // never logged and never attached to the event.
  const supplied = request.headers.get(VERIFY_TOKEN_HEADER);
  if (!isVerifyRequestAllowed(process.env, supplied)) {
    return notFound();
  }

  Sentry.withScope((scope) => {
    scope.setTag('service', 'admin');
    scope.setTag('kind', 'sentry-verify');
    Sentry.captureException(new SentryVerificationProbe());
  });
  const flushed = await Sentry.flush(5000);

  return new Response(JSON.stringify({ sent: flushed }), {
    status: 200,
    headers: { ...NO_STORE, 'content-type': 'application/json' },
  });
}
