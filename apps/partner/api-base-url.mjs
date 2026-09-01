/**
 * Which API this build of the partner dashboard is allowed to talk to.
 *
 * Two places have to give the same answer, and when they stopped doing so the
 * dashboard refused its own login request:
 *
 *   - `next.config.ts` computes the `connect-src` of the Content-Security
 *     -Policy from it, once, at build time;
 *   - `src/lib/httpClient.ts` resolves the address the browser actually calls.
 *
 * The previous version treated the exact string `http://localhost:4000/v1` as
 * "nobody configured this" — because the Dockerfile used to declare it as the
 * default of `ARG NEXT_PUBLIC_API_BASE_URL`, so a Render build that was never
 * given a value still saw it. The consequence was that a deployment which
 * genuinely wanted localhost — the demo stack in `docker-compose.yml`, and CI,
 * which boots that stack and drives it in a browser — got a policy naming the
 * Render staging API while the client called localhost, and every login died
 * as `Refused to connect ... violates ... connect-src`.
 *
 * So "unset" is now expressed by being unset: the Dockerfile's ARG defaults to
 * empty, and any non-empty value is a deliberate one and is honoured. A build
 * that really has no value configured — which is what Render does, since
 * `NEXT_PUBLIC_API_BASE_URL` is a runtime variable there and never reaches
 * Docker as a build argument — still falls back to the staging API.
 *
 * Plain ESM with JSDoc rather than TypeScript for the same reason as
 * `@tutak/design/security-headers`: a Next config cannot import the
 * TypeScript sources.
 */

/** The API the Render staging blueprint puts in front of this dashboard. */
export const STAGING_API_BASE_URL = 'https://tutak-staging-api.onrender.com/v1';

/** Where the API lives when the whole stack is on one machine. */
export const LOCAL_API_BASE_URL = 'http://localhost:4000/v1';

/**
 * @param {{ configured?: string | null, isDevelopment: boolean }} input
 *   `configured` is `NEXT_PUBLIC_API_BASE_URL` as this build received it —
 *   empty or absent means nobody set one.
 * @returns {string} the API base URL this build targets.
 */
export function resolveApiBaseUrl({ configured, isDevelopment }) {
  if (configured) return configured;
  return isDevelopment ? LOCAL_API_BASE_URL : STAGING_API_BASE_URL;
}
