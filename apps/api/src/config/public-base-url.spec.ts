import { assertProductionMediaPublicBaseUrl } from './public-base-url';

/**
 * The gap this closes: `MediaStorageModule` required `MEDIA_PUBLIC_BASE_URL`
 * to be *set*, and nothing more. The development default is
 * `http://localhost:${PORT}`, and on a platform that generates the public
 * domain at first deploy, a placeholder is the natural way to satisfy a
 * not-empty check — so the wrong value boots cleanly and every image URL the
 * API hands out points at the viewer's own machine.
 */

describe('assertProductionMediaPublicBaseUrl', () => {
  it.each([
    'http://localhost:4000',
    'http://127.0.0.1:4000',
    'http://[::1]:4000',
    'https://localhost',
  ])('refuses %s in production', (url) => {
    expect(() => assertProductionMediaPublicBaseUrl(url, 'production')).toThrow(
      /MEDIA_PUBLIC_BASE_URL is/,
    );
  });

  it('quotes the offending value, so the fix is the message', () => {
    expect(() => assertProductionMediaPublicBaseUrl('http://localhost:4000', 'production')).toThrow(
      /"http:\/\/localhost:4000"/,
    );
  });

  it.each(['https://api.example.com', 'https://tutak-api-production.up.railway.app'])(
    'accepts the reachable address %s',
    (url) => {
      expect(() => assertProductionMediaPublicBaseUrl(url, 'production')).not.toThrow();
    },
  );

  // Emptiness is the existing check's job, not this one's — it must not throw
  // a second, less specific error over the top of a clearer one.
  it('leaves an unset value to the not-empty check that already exists', () => {
    expect(() => assertProductionMediaPublicBaseUrl(undefined, 'production')).not.toThrow();
    expect(() => assertProductionMediaPublicBaseUrl('', 'production')).not.toThrow();
  });

  it.each(['staging', 'development'] as const)('leaves %s alone', (appEnv) => {
    expect(() => assertProductionMediaPublicBaseUrl('http://localhost:4000', appEnv)).not.toThrow();
  });
});
