/**
 * Which API this build of the admin dashboard is allowed to talk to.
 *
 * Two places have to give the same answer, and when they stopped doing so the
 * dashboard refused its own login request:
 *
 *   - `next.config.ts` computes the `connect-src` of the Content-Security
 *     -Policy from it, once, at build time;
 *   - `src/lib/httpClient.ts` resolves the address the browser actually calls.
 *
 * These disagreed here in the other direction, and the partner dashboard's
 * copy of this file records how that failure looks from a browser. `headers()`
 * used to read `NEXT_PUBLIC_API_BASE_URL` and fall back to localhost, and on
 * Render that variable is a *runtime* value that never reaches Docker as a
 * build argument — so the shipped policy named `http://localhost:4000`, which
 * a browser on a Render host can never reach, while `httpClient.ts` correctly
 * resolved the staging API from the page's own hostname. Every call the
 * dashboard made was then refused by its own policy.
 *
 * So "unset" is expressed by being unset: the Dockerfile's ARG defaults to
 * empty, any non-empty value is a deliberate one and is honoured, and a
 * deployed build that was told nothing **fails**. Render supplies
 * `NEXT_PUBLIC_API_BASE_URL` as a runtime variable, which never reaches a
 * Docker build, so every deployed image has to be built with the build
 * argument set — see docs/PRODUCTION_RUNBOOK_RU.md.
 *
 * Plain ESM with JSDoc rather than TypeScript for the same reason as
 * `@tutak/design/security-headers`: a Next config cannot import the
 * TypeScript sources.
 */

/**
 * The API the Render staging blueprint puts in front of this dashboard.
 *
 * Kept as a named constant because `httpClient.ts` needs it at run time for
 * the hostname check, **not** as a default for anything. No build falls back
 * to it — see `resolveApiBaseUrl`.
 */
export const STAGING_API_BASE_URL = 'https://tutak-staging-api.onrender.com/v1';

/** Where the API lives when the whole stack is on one machine. */
export const LOCAL_API_BASE_URL = 'http://localhost:4000/v1';

export class ApiBaseUrlNotConfiguredError extends Error {
  constructor() {
    super(
      'NEXT_PUBLIC_API_BASE_URL was not set for this build. It fixes the ' +
        "connect-src of this dashboard's Content-Security-Policy, which cannot be " +
        'changed afterwards by a runtime variable, so a build that guesses it ships ' +
        'a policy forbidding its own API. Pass it as a Docker build argument: ' +
        'docker build --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example/v1 …',
    );
    this.name = 'ApiBaseUrlNotConfiguredError';
  }
}

/**
 * @param {{ configured?: string | null, isDevelopment: boolean }} input
 *   `configured` is `NEXT_PUBLIC_API_BASE_URL` as this build received it —
 *   empty or absent means nobody set one.
 * @returns {string} the API base URL this build targets.
 * @throws {ApiBaseUrlNotConfiguredError} when a deployed build was told nothing.
 *
 * There is deliberately no fallback for a deployed build. There used to be one
 * — the Render staging API — and it was the right answer for exactly one
 * deployment and a silent, invisible wrong answer for every other: a
 * production image built without this variable would have shipped a policy
 * allowing only the *staging* API, and the failure would first appear as
 * customers unable to sign in. Failing the build is louder and cheaper than
 * that, and it is the only version of this function where a wrong host cannot
 * reach a browser.
 */
export function resolveApiBaseUrl({ configured, isDevelopment }) {
  if (configured) return configured;
  if (isDevelopment) return LOCAL_API_BASE_URL;
  throw new ApiBaseUrlNotConfiguredError();
}
