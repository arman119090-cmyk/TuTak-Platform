/**
 * The one commit-SHA value every Sentry integration in this repository tags
 * its events with, so a stack trace in Sentry and a build in CI/EAS refer to
 * the same release without a lookup table.
 *
 * `GIT_COMMIT_SHA` is the canonical name; it is never set automatically by
 * any platform, so an operator sets it explicitly at deploy/build time (see
 * docs/SENTRY_SETUP.md). The two fallbacks cover the platforms that *do* set
 * something on their own: GitHub Actions exports `GITHUB_SHA` to every job,
 * and EAS exports `EAS_BUILD_GIT_COMMIT_HASH` to every build — the same
 * value `apps/mobile/app.config.js` already reads for its diagnostic
 * overlay's version string.
 */
export function resolveReleaseSha(env: Record<string, string | undefined>): string {
  return env.GIT_COMMIT_SHA ?? env.EAS_BUILD_GIT_COMMIT_HASH ?? env.GITHUB_SHA ?? 'unknown';
}
