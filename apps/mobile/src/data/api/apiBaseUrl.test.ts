import { resolveApiBaseUrl } from './apiBaseUrl';

describe('resolveApiBaseUrl', () => {
  it('points a loopback dev URL at the machine serving the bundle', () => {
    // The case this exists for: a real iPhone running a development build.
    expect(resolveApiBaseUrl('http://localhost:4000/v1', '192.168.1.42:8081')).toBe(
      'http://192.168.1.42:4000/v1',
    );
  });

  it('keeps the configured scheme, port and path', () => {
    expect(resolveApiBaseUrl('https://127.0.0.1:8443/api/v2', '10.0.0.7:8081')).toBe(
      'https://10.0.0.7:8443/api/v2',
    );
  });

  it('leaves a real host completely alone', () => {
    // Staging and production must never be rewritten by this.
    expect(resolveApiBaseUrl('https://api.tutak.am/v1', '192.168.1.42:8081')).toBe(
      'https://api.tutak.am/v1',
    );
  });

  it('leaves the URL alone when there is no dev server', () => {
    expect(resolveApiBaseUrl('http://localhost:4000/v1', undefined)).toBe(
      'http://localhost:4000/v1',
    );
  });

  it('leaves the URL alone when the dev server is itself on loopback', () => {
    // The web build and the iOS simulator both reach the API on localhost
    // already; rewriting would be a no-op at best.
    expect(resolveApiBaseUrl('http://localhost:4000/v1', 'localhost:8081')).toBe(
      'http://localhost:4000/v1',
    );
    expect(resolveApiBaseUrl('http://localhost:4000/v1', '127.0.0.1:8081')).toBe(
      'http://localhost:4000/v1',
    );
  });

  it('tolerates a hostUri that carries a path', () => {
    expect(resolveApiBaseUrl('http://localhost:4000/v1', '192.168.1.42:8081/--/path')).toBe(
      'http://192.168.1.42:4000/v1',
    );
  });

  it('returns anything it cannot parse unchanged rather than throwing', () => {
    // Hydration and the first request both run before any error boundary.
    expect(resolveApiBaseUrl('not a url', '192.168.1.42:8081')).toBe('not a url');
    expect(resolveApiBaseUrl('', '192.168.1.42:8081')).toBe('');
  });

  it('handles a loopback URL with no explicit port', () => {
    expect(resolveApiBaseUrl('http://localhost/v1', '192.168.1.42:8081')).toBe(
      'http://192.168.1.42/v1',
    );
  });
});
