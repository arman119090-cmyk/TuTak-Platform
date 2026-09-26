import { AppEnvironment, isProductionDeployment } from './app-environment';
import { isLoopbackOrigin } from './cors-origins';

/**
 * `MEDIA_PUBLIC_BASE_URL` pointing at the machine that serves it, refused.
 *
 * ## The failure this prevents
 *
 * `MediaStorageModule` already requires the variable to be *set* in
 * production. It cannot be empty — but it can be wrong in the one way that is
 * easy to arrive at, because the development default is
 * `http://localhost:${PORT}` and because a first production environment is
 * often assembled by copying the development one.
 *
 * It is also the value most likely to be filled in with a placeholder on
 * purpose. The real answer is the API's own public address, and on a platform
 * that generates the domain at first deploy that address does not exist yet —
 * so "put something there to get past the boot check" is the obvious move, and
 * the obvious something is localhost.
 *
 * What that ships is a deployment where every partner logo and every customer
 * avatar URL handed to the mobile app and to both dashboards names the
 * viewer's own machine. Nothing errors on the server. `/health` is green. The
 * images simply never load, for everyone, and the reason is invisible from
 * inside the API — the same shape as the CORS failure in `cors-origins.ts`,
 * and refused here for the same reason.
 *
 * Only `production` is policed: staging and development legitimately serve
 * media from a local address.
 */
export function assertProductionMediaPublicBaseUrl(
  publicBaseUrl: string | undefined,
  appEnv: AppEnvironment,
): void {
  if (!isProductionDeployment(appEnv)) return;
  if (!publicBaseUrl || !isLoopbackOrigin(publicBaseUrl)) return;

  throw new Error(
    `MEDIA_PUBLIC_BASE_URL is "${publicBaseUrl}" in production. That names the machine serving ` +
      'the request, not a reachable host, so every partner logo and customer avatar URL this API ' +
      'hands to the mobile app and the dashboards would point at the viewer\'s own computer — ' +
      'silently, with the API still reporting healthy. Set it to this API\'s public address ' +
      '(scheme and host, no trailing slash), e.g. MEDIA_PUBLIC_BASE_URL=https://api.example.com',
  );
}
