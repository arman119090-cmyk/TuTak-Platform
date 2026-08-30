/**
 * Connection-pool sizing, made explicit and made an operator's decision.
 *
 * ## What happens with none of this
 *
 * Prisma sizes its pool itself: `num_physical_cpus * 2 + 1` per client
 * instance, with a 10-second checkout timeout. Nothing in this repository ever
 * said otherwise, so that is what production would run.
 *
 * That default is per *process*, and it is derived from the CPUs of the
 * machine the process happens to land on — which is exactly the wrong
 * variable once the API scales horizontally. Four instances on 2-vCPU
 * containers ask for 20 connections; the same four on 8-vCPU containers ask
 * for 68, without a line of code or configuration changing. PostgreSQL
 * answers the request that crosses `max_connections` with
 * `FATAL: sorry, too many clients already` — every instance, at once, for
 * every request, including the health check that would otherwise pull the
 * bad instance out of rotation.
 *
 * ## Why there is no default here
 *
 * The right number is `max_connections` minus what everything else needs
 * (migrations, `psql`, a backup job, the platform's own monitoring), divided
 * by the number of API processes — and none of those are knowable from
 * inside this repository. Picking a plausible-looking constant would be
 * inventing an answer to a question about someone's database plan.
 *
 * So: unset changes nothing at all, and a deployment that has done the
 * arithmetic can state the result. `docs/DEPLOYMENT.md` carries the
 * arithmetic itself.
 */
export const CONNECTION_LIMIT_ENV = 'DATABASE_CONNECTION_LIMIT';
export const POOL_TIMEOUT_ENV = 'DATABASE_POOL_TIMEOUT';

type DatabaseEnv = Record<string, string | undefined>;

function positiveInteger(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Returns the URL Prisma should connect with.
 *
 * Rewrites nothing unless asked to, and never overwrites a value the URL
 * already carries: an operator who put `connection_limit` in the URL itself
 * has already made this decision, and two places disagreeing about it is
 * worse than either one being wrong.
 *
 * An unparseable URL is returned untouched rather than thrown on — failing
 * here would turn a malformed connection string into an error about pool
 * sizing, and Prisma's own message about the actual problem is the one worth
 * reading.
 */
export function applyPoolSettings(databaseUrl: string, env: DatabaseEnv = process.env): string {
  const limit = positiveInteger(env[CONNECTION_LIMIT_ENV]);
  const timeout = positiveInteger(env[POOL_TIMEOUT_ENV]);
  if (limit === null && timeout === null) return databaseUrl;

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }

  if (limit !== null && !url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', String(limit));
  }
  if (timeout !== null && !url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', String(timeout));
  }
  return url.toString();
}
