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
};

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
 * The guards above are exercised with values a test invents. This one uses the
 * value a build actually gets: `eas.json`'s own `staging` profile, which is
 * what the closed pilot installs from.
 *
 * Everything above would still pass if somebody pointed that profile at
 * localhost, dropped its address, or moved it to plain http — the guards would
 * be correct and unreached, because nothing joins them to the file the builder
 * reads. A pilot APK that installs and reaches nothing is exactly the failure
 * `apiBaseUrl` exists to prevent, so the profile is checked here rather than
 * trusted.
 */
describe('the staging build profile in eas.json', () => {
  const env = process.env;
  const profile = (require('../eas.json') as { build: Record<string, { env?: Record<string, string> }> })
    .build.staging;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.API_BASE_URL;
    delete process.env.ALLOW_INSECURE_API_BASE_URL;
    for (const [key, value] of Object.entries(profile.env ?? {})) process.env[key] = value;
  });

  afterAll(() => {
    process.env = env;
  });

  it('carries an address, over https, that is not the phone itself', () => {
    expect(guards.apiBaseUrl()).toBe('https://tutak-staging-api.onrender.com/v1');
  });

  it('names itself staging, so the app it builds cannot be mistaken for a real install', () => {
    expect(profile.env?.APP_ENV).toBe('staging');
  });
});
