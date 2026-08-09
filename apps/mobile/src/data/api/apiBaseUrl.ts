const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i;
const URL_PARTS = /^(https?:\/\/)([^/:]+)(:\d+)?(.*)$/;

/**
 * Where the app should send requests, given what the build was configured
 * with and where Metro is serving from.
 *
 * The development build profile points at `http://localhost:4000/v1`, which is
 * correct in a simulator and wrong on a real phone: there, `localhost` is the
 * phone. Every request fails, on a device that otherwise looks like it
 * installed perfectly — and the fix would otherwise be for whoever is testing
 * to find their laptop's LAN address and hand-edit a config file.
 *
 * Metro already knows that address: it is the host the phone just downloaded
 * the bundle from, which Expo exposes as `hostUri`. Substituting its hostname
 * — keeping the configured scheme, port and path — points the app back at the
 * machine running the API.
 *
 * Anything that is not a loopback address is returned untouched, so staging
 * and production builds are unaffected by this function entirely.
 */
export function resolveApiBaseUrl(configured: string, hostUri: string | undefined): string {
  const parts = URL_PARTS.exec(configured);
  if (!parts) return configured;

  const [, scheme, host, port = '', rest = ''] = parts;
  if (!LOCAL_HOST.test(host)) return configured;

  // hostUri looks like "192.168.1.42:8081" — strip the port and any path.
  const devHost = hostUri?.split('/')[0]?.split(':')[0];
  // No dev server (a standalone build), or one that is itself on loopback
  // (the web build, or a simulator): the configured value is already right.
  if (!devHost || LOCAL_HOST.test(devHost)) return configured;

  return `${scheme}${devHost}${port}${rest}`;
}
