import Constants from 'expo-constants';

/**
 * Where the map picture comes from.
 *
 * ## Why raster tiles and not a map SDK
 *
 * `react-native-maps` is the obvious choice and it is not available to us yet.
 * On Android it renders through Google Maps, which needs an API key issued
 * against the owner's Google Cloud account with billing enabled. We do not
 * have one, and the whole map screen would be a grey rectangle until we did.
 * On iOS it would work — which would mean a feature that exists on one
 * platform and not the other, decided by whose account was set up first.
 *
 * Raster tiles need no native module and no config plugin. That last one
 * matters more than it sounds: adding a native dependency means the next APK
 * build is the first one to compile it, and this project has lost whole
 * evenings to exactly that. Every line of the map is JavaScript over
 * `<Image>`, so it behaves identically on Android, iOS and the web export the
 * demo is served from.
 *
 * ## Identifying this app is not optional either
 *
 * openstreetmap.org's tile usage policy requires a valid identifying
 * `User-Agent` or `Referer` naming the application, and blocks clients that
 * send neither — it does not ask for a key, it asks to know who is calling.
 * The first version sent no identification at all: whatever else was true of
 * the map, it was being fetched in a way the provider's own policy refuses,
 * which is the most likely explanation for tiles that never arrive on a real
 * phone while every unit test passes.
 *
 * `tileRequestHeaders()` is that identification, and it is built from the
 * app's own name and version rather than a hardcoded string so it stays true
 * after a release. It costs nothing and is required by every tile provider
 * worth using, keyed or not.
 *
 * ## Switching provider is configuration, not code
 *
 * `extra.map` (see `app.config.js`) carries the URL template, the key and the
 * attribution line. The default is openstreetmap.org, which is right for
 * development and wrong for a shipped app: those servers run on donated
 * capacity and their policy asks apps with real traffic to go elsewhere.
 * Moving to MapTiler, Mapbox, Stadia or a self-hosted renderer is then a
 * build-time variable — `MAP_TILE_URL_TEMPLATE` plus `MAP_TILE_API_KEY` —
 * and nothing in this file or the map itself changes.
 *
 * A tile key is not a secret in the sense a Sentry auth token is: it
 * identifies the account the tiles are billed to, is restricted by the
 * provider to this app's bundle id, and has to reach the device to be used
 * at all. It belongs in `extra` for the same reason `sentryDsn` does.
 */

/** The OSM default — development only; see the docblock above. */
const DEFAULT_TEMPLATE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUTION = '© OpenStreetMap';

/**
 * The subdomains a template may spread requests across via `{s}`.
 *
 * Spreading is what lets a screenful load in parallel: both native platforms
 * and every browser cap concurrent connections per host, so a single hostname
 * loads a 12-tile screen in three visible waves. A template with no `{s}` is
 * fine — most keyed providers serve from one host over HTTP/2, where the cap
 * does not apply.
 */
const SUBDOMAINS = ['a', 'b', 'c'] as const;

function mapConfig(): { template: string; apiKey: string; attribution: string } {
  const extra = Constants.expoConfig?.extra ?? {};
  const map = (extra as { map?: Record<string, unknown> }).map ?? {};
  const template = typeof map.tileUrlTemplate === 'string' && map.tileUrlTemplate
    ? map.tileUrlTemplate
    : DEFAULT_TEMPLATE;
  const apiKey = typeof map.tileApiKey === 'string' ? map.tileApiKey : '';
  const attribution = typeof map.attribution === 'string' && map.attribution
    ? map.attribution
    : DEFAULT_ATTRIBUTION;
  return { template, apiKey, attribution };
}

/**
 * Who to credit, drawn by the map itself rather than left to whoever
 * remembers. OpenStreetMap data is ODbL and requires visible credit; every
 * commercial provider requires its own line too, which is why this comes from
 * configuration alongside the URL it belongs to.
 */
export function attribution(): string {
  return mapConfig().attribution;
}

/** Kept as a constant export for call sites that render it statically. */
export const ATTRIBUTION = DEFAULT_ATTRIBUTION;

export function tileUrl(x: number, y: number, z: number): string {
  const { template, apiKey } = mapConfig();
  // Keyed on the tile's own coordinates rather than a counter, so the same
  // tile always comes from the same host and stays cached across a pan that
  // returns to where it started.
  const host = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
  return template
    .replace('{s}', host)
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{key}', apiKey);
}

/**
 * The headers every tile request carries.
 *
 * `User-Agent` names the app and its version, which is exactly what OSM's
 * usage policy asks for and what any provider needs to tell one client from
 * another when something goes wrong. `Referer` is sent too because the web
 * export cannot set `User-Agent` from JavaScript — browsers own that header —
 * and the policy accepts either.
 */
export function tileRequestHeaders(): Record<string, string> {
  const name = Constants.expoConfig?.name ?? 'TuTak';
  const version = Constants.expoConfig?.version ?? '0.0.0';
  return {
    'User-Agent': `${name}/${version} (https://tutak.am)`,
    Referer: 'https://tutak.am',
  };
}
