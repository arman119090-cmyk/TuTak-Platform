/**
 * The commit-SHA value Sentry tags every event with, shared in spirit with
 * `apps/mobile`, `apps/admin` and `apps/partner` (see
 * `@tutak/observability`'s `resolveReleaseSha` — apps/api keeps its own copy
 * for the same `rootDir` reason `sentry-sanitize.ts` does).
 *
 * `GIT_COMMIT_SHA` is the canonical name; an operator sets it explicitly at
 * deploy time (see docs/SENTRY_SETUP.md). `GITHUB_SHA` is the one fallback
 * that matters for this runtime — GitHub Actions exports it to every job,
 * including the Docker build/publish workflow.
 */
export function resolveReleaseSha(env: NodeJS.ProcessEnv): string {
  return env.GIT_COMMIT_SHA ?? env.GITHUB_SHA ?? 'unknown';
}
