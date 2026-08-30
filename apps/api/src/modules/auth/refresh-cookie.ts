import { CookieOptions, Request, Response } from 'express';

/**
 * Refresh token delivery for browser clients.
 *
 * The web apps persisted both tokens in `localStorage`, so any XSS — including
 * one arriving through a future dependency — exfiltrated a 30-day refresh
 * token and with it full, long-lived control of an admin or partner account
 * (docs/AUDIT_2026-08-B.md §H2).
 *
 * An httpOnly cookie is unreadable from JavaScript, so the same XSS can at
 * most act inside the page for as long as it runs; it cannot walk away with
 * the session.
 *
 * ## SameSite, and why it is a setting rather than a constant
 *
 * `SameSite=Strict` was hardcoded, and it is the right default: the cookie is
 * simply not attached to cross-site requests, which is CSRF protection the
 * server does not have to get right. It also silently assumes a deployment
 * topology — that the dashboards and the API share a registrable domain.
 *
 * They do not on every host. Render's default hostnames are
 * `<service>.onrender.com`, and `onrender.com` is on the Public Suffix List,
 * so `tutak-staging-api.onrender.com` and `tutak-staging-admin.onrender.com`
 * are different *sites*, not two subdomains of one. Under `Strict` the browser
 * never sends this cookie to the API, and refresh cannot work at all — not
 * intermittently, never.
 *
 * So the mode is configurable, the default stays `strict`, and `none` (the
 * only value that works cross-site) forces `Secure` because browsers reject
 * `SameSite=None` without it. Choosing `none` gives up the CSRF protection
 * `Strict` provided for free — which is why `assertTrustedCookieOrigin` below
 * exists and does not depend on SameSite at all.
 *
 * Native clients keep using the request body — SecureStore is already outside
 * the reach of page script, and mobile has no cookie jar to rely on.
 */
export const REFRESH_COOKIE = 'tutak_rt';

export const SAME_SITE_ENV = 'AUTH_COOKIE_SAMESITE';
export type SameSiteMode = 'strict' | 'lax' | 'none';
const SAME_SITE_MODES: readonly SameSiteMode[] = ['strict', 'lax', 'none'];

type CookieEnv = Record<string, string | undefined>;

/**
 * Unknown values fall back to the safest mode rather than the requested one.
 * A typo must not silently turn CSRF protection off.
 */
export function resolveSameSite(env: CookieEnv = process.env): SameSiteMode {
  const configured = env[SAME_SITE_ENV]?.trim().toLowerCase();
  return SAME_SITE_MODES.includes(configured as SameSiteMode)
    ? (configured as SameSiteMode)
    : 'strict';
}

export function refreshCookieOptions(expiresAt: Date, env: CookieEnv = process.env): CookieOptions {
  const sameSite = resolveSameSite(env);
  return {
    httpOnly: true,
    // Cookies are only sent over TLS outside development, where there is
    // none. `staging` counts as outside development here too — it is a real
    // deployment a browser reaches over the network, not a developer's own
    // machine (docs/DEPLOYMENT.md §1). `SameSite=None` additionally requires
    // it in every browser that implements the attribute, so a cross-site
    // deployment gets `Secure` whether or not NODE_ENV says so.
    secure: sameSite === 'none' || env.NODE_ENV === 'production' || env.NODE_ENV === 'staging',
    sameSite,
    // Scoped to the only routes that ever need it, so it is not attached to
    // every API call and cannot leak through an unrelated handler.
    path: '/v1/auth',
    expires: expiresAt,
  };
}

/** Prefers the cookie; falls back to the body so native clients keep working. */
export function readRefreshToken(req: Request, fromBody?: string): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[REFRESH_COOKIE] ?? fromBody;
}

/** Whether this request is authenticating with the cookie rather than a body token. */
export function usesRefreshCookie(req: Request): boolean {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return typeof cookies?.[REFRESH_COOKIE] === 'string';
}

/**
 * CSRF defence for the one endpoint a cookie alone can authenticate.
 *
 * `SameSite=Strict` already prevents the browser from attaching this cookie
 * to a cross-site request, so under the default this check never fires. It
 * exists for the deployment that had to choose `none` — and as the layer that
 * does not quietly disappear when someone changes an environment variable.
 *
 * Three deliberate rules:
 *
 *  - only requests that actually present the cookie are checked, so the
 *    mobile app (body token, no cookie) is untouched;
 *  - a missing `Origin` is allowed, because no browser lets a cross-site
 *    attacker suppress it — a request without one is a non-browser client,
 *    which has no victim's cookie jar to ride;
 *  - a present `Origin` must be one the deployment already trusts for CORS.
 *    Anything else is exactly the shape of a cross-site forgery.
 */
export function isTrustedCookieOrigin(req: Request, allowedOrigins: readonly string[]): boolean {
  if (!usesRefreshCookie(req)) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  // No configured origins means CORS is wide open, which only happens in
  // development (`main.ts` refuses to boot otherwise). Nothing to compare to.
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(expiresAt));
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(new Date(0)), expires: undefined });
}
