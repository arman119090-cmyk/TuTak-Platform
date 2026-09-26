let mockExtra: Record<string, unknown> = {};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { name: 'TuTak', version: '1.4.2', extra: mockExtra };
    },
  },
}));

import { attribution, tileRequestHeaders, tileUrl } from './tileSource';

/**
 * The map's own supply line.
 *
 * Two things here are not cosmetic. A tile provider that cannot tell who is
 * calling is entitled to refuse, and openstreetmap.org's usage policy says it
 * does — the first version of this map sent no identification at all. And
 * moving off those donated servers before this ships has to be a build-time
 * variable, not a code change, or it will be done in a hurry by whoever is
 * holding the release.
 */

const setExtra = (extra: Record<string, unknown>) => {
  mockExtra = extra;
};

describe('tileSource', () => {
  afterEach(() => setExtra({}));

  it('falls back to OpenStreetMap when nothing is configured', () => {
    setExtra({});
    expect(tileUrl(1, 2, 3)).toBe('https://a.tile.openstreetmap.org/3/1/2.png');
    expect(attribution()).toBe('© OpenStreetMap');
  });

  it('spreads tiles across the subdomains a template offers', () => {
    setExtra({});
    // Keyed on the tile's own coordinates, so the same tile always comes
    // from the same host and survives a pan that returns to where it started.
    expect(tileUrl(0, 0, 5)).toContain('https://a.');
    expect(tileUrl(1, 0, 5)).toContain('https://b.');
    expect(tileUrl(2, 0, 5)).toContain('https://c.');
    expect(tileUrl(3, 0, 5)).toContain('https://a.');
  });

  it('handles a negative x without falling off the subdomain list', () => {
    setExtra({});
    // Panning west of the prime meridian produces negative tile x; `%` on a
    // negative number is negative in JavaScript, which would index past the
    // start of the array and produce `https://undefined.`.
    expect(tileUrl(-1, 0, 5)).toMatch(/^https:\/\/[abc]\./);
  });

  it('uses the configured provider, key and attribution instead', () => {
    setExtra({
      map: {
        tileUrlTemplate: 'https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key={key}',
        tileApiKey: 'test-key',
        attribution: '© MapTiler © OpenStreetMap',
      },
    });

    expect(tileUrl(7, 8, 9)).toBe(
      'https://api.maptiler.com/maps/streets/9/7/8.png?key=test-key',
    );
    expect(attribution()).toBe('© MapTiler © OpenStreetMap');
  });

  it('identifies the app by name and version on every tile request', () => {
    setExtra({});
    const headers = tileRequestHeaders();

    // Built from the manifest, not hardcoded, so it stays true after a
    // release rather than naming whatever version shipped the day this was
    // written.
    expect(headers['User-Agent']).toContain('TuTak/1.4.2');
    // The web export cannot set User-Agent from JavaScript — browsers own
    // that header — and the policy accepts a Referer instead.
    expect(headers.Referer).toBeTruthy();
  });
});
