import * as Sentry from '@sentry/nextjs';

/**
 * Non-production-only Sentry verification endpoint.
 *
 * Sends one synthetic error to whatever DSN this deployment is configured
 * with, so a human can confirm events actually reach Sentry without relying
 * on a real bug. Gated twice on purpose: `NODE_ENV !== 'production'` alone
 * would still let it run in a staging box that happens to share prod's env
 * shape, so a separate opt-in flag is required as well. Neither check is
 * skippable by request data — both come only from server-side env vars.
 *
 * Never returns anything beyond a boolean: no stack trace, no config, no
 * request data, no secret.
 */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function GET(): Promise<Response> {
  if (process.env.NODE_ENV === 'production' || process.env.SENTRY_VERIFY_ENABLED !== 'true') {
    return new Response(null, { status: 404 });
  }

  const marker = `tutak-partner-sentry-verify-${new Date().toISOString()}`;
  Sentry.withScope((scope) => {
    scope.setTag('service', 'partner');
    scope.setTag('kind', 'sentry-verify');
    Sentry.captureException(new Error(`TuTak Sentry verification: ${marker}`));
  });
  const flushed = await Sentry.flush(5000);

  return jsonResponse({ sent: flushed }, 200);
}
