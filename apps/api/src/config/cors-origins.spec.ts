import { assertProductionCorsOrigins, isLoopbackOrigin } from './cors-origins';

/**
 * The defect this guards: `CORS_ORIGINS` copied from development into
 * production is non-empty, so the existing "must not be empty" check passes,
 * and the deployment boots with the real dashboards locked out and localhost
 * trusted with credentials.
 */

describe('isLoopbackOrigin', () => {
  it.each([
    'http://localhost:3000',
    'https://localhost',
    'http://127.0.0.1:4000',
    'http://[::1]:3000',
    'http://0.0.0.0:3000',
  ])('recognises %s as this machine', (origin) => {
    expect(isLoopbackOrigin(origin)).toBe(true);
  });

  it.each([
    'https://admin.example.com',
    'https://tutak-admin-production.up.railway.app',
    'https://localhost.example.com',
  ])('leaves the reachable host %s alone', (origin) => {
    expect(isLoopbackOrigin(origin)).toBe(false);
  });

  it('does not treat an unparsable entry as loopback', () => {
    expect(isLoopbackOrigin('not a url')).toBe(false);
    expect(isLoopbackOrigin('')).toBe(false);
  });
});

describe('assertProductionCorsOrigins', () => {
  it('refuses a production list that still points at this machine', () => {
    expect(() =>
      assertProductionCorsOrigins(['http://localhost:3000', 'http://localhost:3001'], 'production'),
    ).toThrow(/CORS_ORIGINS contains/);
  });

  it('names every offending entry, so the fix is the message', () => {
    expect(() =>
      assertProductionCorsOrigins(
        ['https://admin.example.com', 'http://127.0.0.1:3001'],
        'production',
      ),
    ).toThrow(/127\.0\.0\.1:3001/);
  });

  it('accepts a production list of real public origins', () => {
    expect(() =>
      assertProductionCorsOrigins(
        ['https://admin.example.com', 'https://partner.example.com'],
        'production',
      ),
    ).not.toThrow();
  });

  // Staging legitimately runs alongside a developer pointing a local
  // dashboard at it, and development is where these values belong.
  it.each(['staging', 'development'] as const)('leaves %s alone', (appEnv) => {
    expect(() => assertProductionCorsOrigins(['http://localhost:3000'], appEnv)).not.toThrow();
  });
});
