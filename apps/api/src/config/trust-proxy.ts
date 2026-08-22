/**
 * What to pass to Express's `app.set('trust proxy', …)`, derived from the
 * `TRUST_PROXY` env var — see `.env.example` and `main.ts` for the full
 * reasoning (P2 finding, security/financial hardening pass, 2026-08-19: a
 * live pentest on this exact codebase found rate limiting on login/OTP/
 * password-reset fully bypassable by spoofing a rotating `X-Forwarded-For`
 * header, because `trust proxy` was set to a bare hop count of `1`
 * unconditionally with no real reverse proxy in front of this deployment
 * topology to have sanitized that header first).
 *
 * Extracted to a pure function — the same pattern `RedisModule`'s
 * `assertRedisUrlConfigured()` already uses — so the decision is
 * unit-testable without booting Express or a database.
 *
 * `undefined` means "call nothing" — Express's own default (`false`)
 * applies, and `req.ip` is the real TCP peer address. Anything else is the
 * exact string handed to `app.set`, verbatim: an IP, a CIDR subnet, a
 * comma-separated list of either, or one of Express's named subnets
 * (`loopback`, `linklocal`, `uniquelocal`).
 *
 * Deliberately never returns a bare hop count: `TRUST_PROXY=1` (or any
 * other digit string) is passed through as a *string*, which Express's
 * `proxyaddr` treats as an address to compare against — matching nothing —
 * not as `parseInt`'s numeric hop-count form. A hop count trusts whichever
 * address is topologically closest, which is exactly the class of gap this
 * fix closes; only a caller of `app.set('trust proxy', N)` with an actual
 * JS number gets that behaviour, and this function never produces one.
 */
export function resolveTrustProxySetting(trustProxyConfig: string): string | undefined {
  const trimmed = trustProxyConfig.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
