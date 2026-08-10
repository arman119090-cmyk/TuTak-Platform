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
 * Raster tiles need no key, no native module, and no config plugin. That last
 * one matters more than it sounds: adding a native dependency means the next
 * APK build is the first one to compile it, and this project has lost whole
 * evenings to exactly that. Every line of the map is JavaScript over
 * `<Image>`, so it behaves identically on Android, iOS and the web export the
 * demo is served from.
 *
 * ## Attribution is not optional
 *
 * OpenStreetMap data is ODbL. Using the tiles requires crediting
 * OpenStreetMap visibly, which is why `ATTRIBUTION` is exported here and
 * drawn by the map rather than left to whoever remembers.
 *
 * ## Before this ships to a store
 *
 * openstreetmap.org's tile servers are run on donated capacity, and their
 * usage policy asks apps with real traffic to use a different provider. That
 * is a decision with a cost attached — MapTiler, Mapbox and Google all charge
 * per thousand tiles, and self-hosting is a machine plus the planet file — so
 * it belongs to the owner, not to this file. Switching is one URL below.
 */

export const ATTRIBUTION = '© OpenStreetMap';

/**
 * The subdomains OSM serves tiles from.
 *
 * Spreading requests across them is what lets a screenful load in parallel:
 * both native platforms and every browser cap concurrent connections per
 * host, so a single hostname loads a 12-tile screen in three visible waves.
 */
const SUBDOMAINS = ['a', 'b', 'c'] as const;

export function tileUrl(x: number, y: number, z: number): string {
  // Keyed on the tile's own coordinates rather than a counter, so the same
  // tile always comes from the same host and stays cached across a pan that
  // returns to where it started.
  const host = SUBDOMAINS[(x + y) % SUBDOMAINS.length];
  return `https://${host}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

/**
 * How dark to paint over the tiles.
 *
 * The app is a dark product and OSM's standard style is a light one. The
 * alternative to a scrim is a dark tile style, and the free ones with a dark
 * variant all want an API key — the thing this file exists to avoid.
 *
 * 0.55 was picked by what stays readable: street names survive it, the paper
 * white of the base map does not, and the brand-coloured pins sit clearly
 * above it. Much darker and the map stops being useful; much lighter and it
 * glares against every other screen in the app.
 */
export const SCRIM_OPACITY = 0.55;
