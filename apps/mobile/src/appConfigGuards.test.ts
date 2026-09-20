/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * The build-time refusals in `app.config.js`.
 *
 * They exist to stop a build that would ship, install, look correct and send
 * every access token and purchase amount over a network anyone can read. A
 * refusal nothing exercises is a comment, so these run it.
 */
const guards = require('../app.config.js') as {
  assertTransportSecurity: (appEnv: string, url: string) => void;
  apiBaseUrl: () => string;
  refuseUnkeyedMapInInstallableBuild: (appEnv: string) => void;
  iosTransportSecurity: (appEnv: string) => {
    NSAllowsArbitraryLoads: boolean;
    NSExceptionDomains?: Record<string, unknown>;
  };
};

describe('iosTransportSecurity', () => {
  it('leaves App Transport Security as Apple ships it in every installable build', () => {
    for (const appEnv of ['preview', 'staging', 'production']) {
      const ats = guards.iosTransportSecurity(appEnv);
      expect(ats.NSAllowsArbitraryLoads).toBe(false);
      expect(ats.NSExceptionDomains).toBeUndefined();
    }
  });

  it('allows cleartext only for a development build, where Metro and a local API answer over http', () => {
    const ats = guards.iosTransportSecurity('development');
    expect(ats.NSAllowsArbitraryLoads).toBe(true);
    expect(Object.keys(ats.NSExceptionDomains ?? {})).toEqual(['localhost']);
  });
});

describe('assertTransportSecurity', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.ALLOW_INSECURE_API_BASE_URL;
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    delete process.env.ALLOW_INSECURE_API_BASE_URL;
  });

  it.each(['production', 'preview', 'staging'])('accepts https for %s', (appEnv) => {
    expect(() => guards.assertTransportSecurity(appEnv, 'https://api.tutak.am/v1')).not.toThrow();
  });

  it('refuses plain http for production, with no override', () => {
    expect(() => guards.assertTransportSecurity('production', 'http://api.tutak.am/v1')).toThrow(
      /must use https/i,
    );

    process.env.ALLOW_INSECURE_API_BASE_URL = '1';
    expect(() => guards.assertTransportSecurity('production', 'http://api.tutak.am/v1')).toThrow(
      /must use https/i,
    );
  });

  it.each(['preview', 'staging'])('refuses plain http for %s by default', (appEnv) => {
    expect(() => guards.assertTransportSecurity(appEnv, 'http://api.example.com/v1')).toThrow(
      /ALLOW_INSECURE_API_BASE_URL/,
    );
  });

  it('allows a non-production plain-http build only when told so explicitly, and says so', () => {
    process.env.ALLOW_INSECURE_API_BASE_URL = '1';

    expect(() =>
      guards.assertTransportSecurity('preview', 'http://api.example.com/v1'),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('readable and modifiable'));
  });

  it('is not fooled by a scheme that merely starts with the right letters', () => {
    expect(() => guards.assertTransportSecurity('production', 'httpsx://api.tutak.am')).toThrow();
    expect(() => guards.assertTransportSecurity('production', ' https://api.tutak.am')).toThrow();
  });
});

describe('apiBaseUrl', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.API_BASE_URL;
    delete process.env.ALLOW_INSECURE_API_BASE_URL;
  });

  afterAll(() => {
    process.env = env;
  });

  it('leaves development on plain http against localhost', () => {
    process.env.APP_ENV = 'development';
    expect(guards.apiBaseUrl()).toBe('http://localhost:4000/v1');
  });

  it('refuses a production build with no address at all', () => {
    process.env.APP_ENV = 'production';
    expect(() => guards.apiBaseUrl()).toThrow(/API_BASE_URL is not set/);
  });

  it('refuses a production build pointed at the phone itself', () => {
    process.env.APP_ENV = 'production';
    process.env.API_BASE_URL = 'https://localhost:4000/v1';
    expect(() => guards.apiBaseUrl()).toThrow(/localhost is the/);
  });

  it('refuses a production build over plain http', () => {
    process.env.APP_ENV = 'production';
    process.env.API_BASE_URL = 'http://api.tutak.am/v1';
    expect(() => guards.apiBaseUrl()).toThrow(/must use https/i);
  });

  it('accepts a production build over https', () => {
    process.env.APP_ENV = 'production';
    process.env.API_BASE_URL = 'https://api.tutak.am/v1';
    expect(guards.apiBaseUrl()).toBe('https://api.tutak.am/v1');
  });
});

/**
 * `eas.json` is where the guards above meet the values a build actually
 * gets, so its profiles are checked here rather than trusted.
 *
 * Two invariants. Every installable profile that names an API carries an
 * https address that is not the phone itself — the thing `apiBaseUrl`
 * exists to prevent. And no profile may call itself "staging" while
 * pointing at the production API: the 2026-09-19 audit found exactly that
 * profile, and a tester holding a "staging" build that quietly talks to
 * production is worse than no staging at all. The only staging profile
 * left is `staging-render`, which names Render's staging service.
 */
describe('the build profiles in eas.json', () => {
  const profiles = (require('../eas.json') as { build: Record<string, { env?: Record<string, string> }> })
    .build;

  it('gives every installable profile that names an API an https address off the phone', () => {
    for (const [name, profile] of Object.entries(profiles)) {
      const url = profile.env?.API_BASE_URL;
      const appEnv = profile.env?.APP_ENV ?? 'development';
      if (!url || appEnv === 'development') continue;
      expect({ name, url }).toEqual({ name, url: expect.stringMatching(/^https:\/\//) });
      expect(url).not.toMatch(/localhost|127\.0\.0\.1/);
      expect(() => guards.assertTransportSecurity(appEnv, url)).not.toThrow();
    }
  });

  it('has no profile called staging that points at the production API', () => {
    for (const [name, profile] of Object.entries(profiles)) {
      const url = profile.env?.API_BASE_URL ?? '';
      const claimsStaging = /staging/i.test(name) || profile.env?.APP_ENV === 'staging';
      if (claimsStaging) {
        expect({ name, url }).not.toEqual({ name, url: expect.stringContaining('tutak-api-production') });
      }
    }
    expect(profiles.staging).toBeUndefined();
  });
});

describe('refuseUnkeyedMapInInstallableBuild', () => {
  const MAPTILER = 'https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key={key}';

  beforeEach(() => {
    delete process.env.MAP_TILE_URL_TEMPLATE;
    delete process.env.MAP_TILE_API_KEY;
    delete process.env.MAP_TILE_ATTRIBUTION;
    delete process.env.MAP_TILE_ALLOW_FALLBACK;
  });

  afterEach(() => {
    delete process.env.MAP_TILE_URL_TEMPLATE;
    delete process.env.MAP_TILE_API_KEY;
    delete process.env.MAP_TILE_ATTRIBUTION;
    delete process.env.MAP_TILE_ALLOW_FALLBACK;
  });

  /** Everything a shipping build is supposed to have. */
  const configured = () => {
    process.env.MAP_TILE_URL_TEMPLATE = MAPTILER;
    process.env.MAP_TILE_API_KEY = 'a-key';
    process.env.MAP_TILE_ATTRIBUTION = '© MapTiler © OpenStreetMap';
  };

  it.each(['preview', 'staging', 'production'])(
    'refuses to build %s on the development tile fallback',
    (appEnv) => {
      expect(() => guards.refuseUnkeyedMapInInstallableBuild(appEnv)).toThrow(
        /MAP_TILE_URL_TEMPLATE/,
      );
    },
  );

  it('lets development keep the fallback', () => {
    // Development is the one case the OSM default is right for, and making
    // a local run need a provider account would be a worse trade than the
    // one this guard exists to prevent.
    expect(() => guards.refuseUnkeyedMapInInstallableBuild('development')).not.toThrow();
  });

  it('accepts a shipping build once a provider is named', () => {
    configured();
    expect(() => guards.refuseUnkeyedMapInInstallableBuild('production')).not.toThrow();
  });

  it('has an escape hatch that has to be typed', () => {
    process.env.MAP_TILE_ALLOW_FALLBACK = '1';
    expect(() => guards.refuseUnkeyedMapInInstallableBuild('preview')).not.toThrow();
  });

  it('refuses the escape hatch for production', () => {
    // A flag that can be set by accident in the one place it must never
    // apply is not an escape hatch, it is a hole with a label on it.
    process.env.MAP_TILE_ALLOW_FALLBACK = '1';
    expect(() => guards.refuseUnkeyedMapInInstallableBuild('production')).toThrow(
      /MAP_TILE_URL_TEMPLATE/,
    );
  });

  describe('set is not the same as correct', () => {
    it('refuses a template that still points at openstreetmap.org', () => {
      configured();
      process.env.MAP_TILE_URL_TEMPLATE = 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png';
      expect(() => guards.refuseUnkeyedMapInInstallableBuild('production')).toThrow(
        /openstreetmap\.org/,
      );
    });

    it('refuses plain http, which would ship the key in clear text', () => {
      configured();
      process.env.MAP_TILE_URL_TEMPLATE = 'http://tiles.example.com/{z}/{x}/{y}.png?key={key}';
      expect(() => guards.refuseUnkeyedMapInInstallableBuild('production')).toThrow(/http/);
    });

    it('refuses a {key} placeholder with nothing to fill it', () => {
      // Every tile request would go out with an empty key and be refused by
      // the provider: a blank map on every phone, with nothing in the build
      // having said so.
      configured();
      delete process.env.MAP_TILE_API_KEY;
      expect(() => guards.refuseUnkeyedMapInInstallableBuild('production')).toThrow(
        /MAP_TILE_API_KEY/,
      );
    });

    it('refuses a provider credited to nobody', () => {
      configured();
      delete process.env.MAP_TILE_ATTRIBUTION;
      expect(() => guards.refuseUnkeyedMapInInstallableBuild('production')).toThrow(
        /MAP_TILE_ATTRIBUTION/,
      );
    });

    it('accepts a keyless provider that needs no placeholder', () => {
      // Not every provider uses a key in the URL; the check is that a
      // placeholder has something to fill it, not that a key must exist.
      process.env.MAP_TILE_URL_TEMPLATE = 'https://tiles.example.com/{z}/{x}/{y}.png';
      process.env.MAP_TILE_ATTRIBUTION = '© Example';
      expect(() => guards.refuseUnkeyedMapInInstallableBuild('production')).not.toThrow();
    });
  });
});

/**
 * The profile a customer actually installs from.
 *
 * `preview` and `staging` both name the app "TuTak (preview)" / "TuTak
 * (staging)" on the home screen — right for a pilot, wrong for the build
 * handed to people paying with it. Only `APP_ENV=production` gives the plain
 * name, and the existing `production` profile builds an app bundle for Play
 * rather than something anybody can install from a link.
 *
 * Everything above would still pass if this profile pointed at localhost,
 * dropped its address or used plain http — the guards would be correct and
 * unreached, because nothing joins them to the file the builder reads.
 */
describe('the production-apk build profile in eas.json', () => {
  const env = process.env;
  const profile = (
    require('../eas.json') as { build: Record<string, { env?: Record<string, string>; android?: { buildType?: string } }> }
  ).build['production-apk'];

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.API_BASE_URL;
    delete process.env.ALLOW_INSECURE_API_BASE_URL;
    for (const [key, value] of Object.entries(profile.env ?? {})) process.env[key] = value;
  });

  afterAll(() => {
    process.env = env;
  });

  it('is installable rather than a Play bundle', () => {
    expect(profile.android?.buildType).toBe('apk');
  });

  it('names itself production, so the app on the phone is called TuTak', () => {
    expect(profile.env?.APP_ENV).toBe('production');
  });

  it('carries the production address, over https, that is not the phone itself', () => {
    expect(guards.apiBaseUrl()).toBe('https://tutak-api-production.up.railway.app/v1');
  });

  it('cannot be built without a real tile provider', () => {
    // The escape hatch is refused for production, so this profile has no way
    // to ship on the development map even if somebody sets the flag.
    process.env.MAP_TILE_ALLOW_FALLBACK = '1';
    delete process.env.MAP_TILE_URL_TEMPLATE;
    expect(() => guards.refuseUnkeyedMapInInstallableBuild('production')).toThrow();
  });
});
