/**
 * Which API this build of TuTak Web Checkout talks to — the same rule, for
 * the same reason, as apps/partner/api-base-url.mjs: `next.config.ts` fixes
 * the Content-Security-Policy's `connect-src` from it at build time, and
 * `src/lib/httpClient.ts` calls it at run time, so both must give one answer.
 * A deployed build that was told nothing fails instead of guessing a host.
 */

/** Where the API lives when the whole stack is on one machine. */
export const LOCAL_API_BASE_URL = 'http://localhost:4000/v1';

export class ApiBaseUrlNotConfiguredError extends Error {
  constructor() {
    super(
      'NEXT_PUBLIC_API_BASE_URL was not set for this build of TuTak Web Checkout. It fixes the ' +
        "connect-src of the checkout's Content-Security-Policy, so pass it as a build argument.",
    );
    this.name = 'ApiBaseUrlNotConfiguredError';
  }
}

/**
 * @param {{ configured?: string | null, isDevelopment: boolean }} input
 * @returns {string}
 */
export function resolveApiBaseUrl({ configured, isDevelopment }) {
  if (configured) return configured;
  if (isDevelopment) return LOCAL_API_BASE_URL;
  throw new ApiBaseUrlNotConfiguredError();
}
