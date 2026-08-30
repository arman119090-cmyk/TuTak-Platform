import type { Request } from 'express';
import {
  REFRESH_COOKIE,
  isTrustedCookieOrigin,
  refreshCookieOptions,
  resolveSameSite,
  usesRefreshCookie,
} from './refresh-cookie';

const expiry = new Date('2026-02-01T00:00:00.000Z');

const request = (cookies: Record<string, string>, origin?: string): Request =>
  ({ cookies, headers: origin ? { origin } : {} }) as unknown as Request;

describe('refreshCookieOptions', () => {
  it('is httpOnly, path-scoped and strict by default', () => {
    const options = refreshCookieOptions(expiry, { NODE_ENV: 'production' });

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('strict');
    expect(options.path).toBe('/v1/auth');
    expect(options.secure).toBe(true);
  });

  it('stays insecure only in development, where there is no TLS to require', () => {
    expect(refreshCookieOptions(expiry, { NODE_ENV: 'development' }).secure).toBe(false);
    expect(refreshCookieOptions(expiry, { NODE_ENV: 'staging' }).secure).toBe(true);
  });

  /**
   * `SameSite=None` is the only mode a browser will send cross-site, and every
   * browser that implements the attribute refuses it without `Secure`. A
   * deployment that has to use it in development would otherwise silently get
   * a cookie no browser stores.
   */
  it('forces Secure when the mode is none, whatever the environment says', () => {
    const options = refreshCookieOptions(expiry, {
      NODE_ENV: 'development',
      AUTH_COOKIE_SAMESITE: 'none',
    });

    expect(options.sameSite).toBe('none');
    expect(options.secure).toBe(true);
  });
});

describe('resolveSameSite', () => {
  it.each(['strict', 'lax', 'none'])('accepts %s', (mode) => {
    expect(resolveSameSite({ AUTH_COOKIE_SAMESITE: mode })).toBe(mode);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolveSameSite({ AUTH_COOKIE_SAMESITE: '  None ' })).toBe('none');
  });

  /** A typo must not quietly turn CSRF protection off. */
  it.each([undefined, '', 'no', 'None;', 'strictly'])('falls back to strict for %s', (value) => {
    expect(resolveSameSite({ AUTH_COOKIE_SAMESITE: value })).toBe('strict');
  });
});

describe('isTrustedCookieOrigin', () => {
  const allowed = ['https://admin.tutak.am', 'https://partner.tutak.am'];

  it('allows a request that presents no cookie — that is the mobile app', () => {
    expect(usesRefreshCookie(request({}))).toBe(false);
    expect(isTrustedCookieOrigin(request({}, 'https://evil.example'), allowed)).toBe(true);
  });

  it('allows a cookie request from an origin the deployment serves', () => {
    const req = request({ [REFRESH_COOKIE]: 'token' }, 'https://admin.tutak.am');
    expect(isTrustedCookieOrigin(req, allowed)).toBe(true);
  });

  it('refuses a cookie request from anywhere else', () => {
    const req = request({ [REFRESH_COOKIE]: 'token' }, 'https://evil.example');
    expect(isTrustedCookieOrigin(req, allowed)).toBe(false);
  });

  /**
   * No browser lets a cross-site attacker suppress `Origin`, so a request
   * without one is a non-browser client — which has no victim's cookie jar to
   * ride in the first place.
   */
  it('allows a cookie request with no Origin header at all', () => {
    const req = request({ [REFRESH_COOKIE]: 'token' });
    expect(isTrustedCookieOrigin(req, allowed)).toBe(true);
  });

  it('allows everything when no origins are configured, which is development only', () => {
    const req = request({ [REFRESH_COOKIE]: 'token' }, 'https://anywhere.example');
    expect(isTrustedCookieOrigin(req, [])).toBe(true);
  });
});
