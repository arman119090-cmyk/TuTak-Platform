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
 * the session. `SameSite=Strict` is what stands in for CSRF protection here:
 * the cookie is simply not attached to cross-site requests, and the refresh
 * endpoint additionally requires a deviceId that an attacker's page cannot
 * read.
 *
 * Native clients keep using the request body — SecureStore is already outside
 * the reach of page script, and mobile has no cookie jar to rely on.
 */
export const REFRESH_COOKIE = 'tutak_rt';

export function refreshCookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    // Cookies are only sent over TLS outside development, where there is none.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
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

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(expiresAt));
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(new Date(0)), expires: undefined });
}
