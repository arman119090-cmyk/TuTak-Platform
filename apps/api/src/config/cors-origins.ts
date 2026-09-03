import { AppEnvironment, isProductionDeployment } from './app-environment';

/**
 * A loopback origin left in a production allow-list, refused at boot.
 *
 * ## The failure this prevents
 *
 * `CORS_ORIGINS` is already required outside development — `main.ts` refuses
 * to start a public deployment with an empty list. What it could not catch is
 * a list that is *non-empty and wrong*: the development value
 * (`http://localhost:3000,http://localhost:3001`) carried into production
 * unchanged, which is what a first production environment assembled by
 * copying the development one actually contains.
 *
 * That configuration boots happily and is broken in two directions at once:
 *
 *   * the real dashboards cannot reach the API at all. Their origin is not on
 *     the list, so every credentialed request from the deployed admin and
 *     partner apps is refused by the browser. The API looks healthy, `/health`
 *     is green, and signing in is simply impossible — the most expensive shape
 *     a misconfiguration can take, because nothing is on fire;
 *   * `http://localhost` is trusted *with credentials*. Any page on the
 *     operator's own machine — a local dev server, a tool, anything that
 *     happens to be served from that port — can make credentialed
 *     cross-origin calls to the production API.
 *
 * ## Why refuse rather than warn
 *
 * The same reasoning `client-ip.ts` uses for the hop count: this is not a
 * degraded setting, it is a broken one, and it cannot be discovered from the
 * outside. A warning in a log nobody reads while the dashboards do not work
 * is worse than a boot failure that names the variable and the value.
 *
 * Only `production` is policed. `staging` legitimately runs alongside a
 * developer pointing a local dashboard at it, and development is where these
 * values belong.
 */
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)$/i;

/** True when the origin names this machine rather than a reachable host. */
export function isLoopbackOrigin(origin: string): boolean {
  const trimmed = origin.trim();
  if (!trimmed) return false;
  try {
    return LOOPBACK_HOST.test(new URL(trimmed).hostname);
  } catch {
    // Not a parsable origin. Not this function's job to judge — an
    // unparsable entry is simply never a loopback one.
    return false;
  }
}

/**
 * Refuses a production CORS allow-list that still points at the developer's
 * own machine. Throws with the offending entries named, so the fix is the
 * message rather than a hunt through the dashboard.
 */
export function assertProductionCorsOrigins(
  origins: readonly string[],
  appEnv: AppEnvironment,
): void {
  if (!isProductionDeployment(appEnv)) return;

  const loopback = origins.filter(isLoopbackOrigin);
  if (loopback.length === 0) return;

  throw new Error(
    `CORS_ORIGINS contains ${loopback.join(', ')} in production. Those name this machine, ` +
      'not a reachable host: the deployed admin and partner dashboards would be refused by ' +
      'the browser on every credentialed request while the API still reported healthy, and a ' +
      'page on an operator\'s own laptop would be trusted with credentials against production. ' +
      'Set CORS_ORIGINS to the real public origins of the admin and partner dashboards ' +
      '(scheme and host, no trailing slash), e.g. ' +
      'CORS_ORIGINS=https://admin.example.com,https://partner.example.com',
  );
}
