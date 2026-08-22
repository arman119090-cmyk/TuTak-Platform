import { resolveTrustProxySetting } from './trust-proxy';

/**
 * P2 finding, security/financial hardening pass (2026-08-19, live pentest):
 * `main.ts` used to call `app.set('trust proxy', 1)` unconditionally in
 * every environment — a bare hop count, believed for any client able to set
 * its own `X-Forwarded-For` when nothing in front of this process actually
 * strips that header first, which fully defeated every per-IP rate limit
 * (login, OTP, password reset). This is the regression suite for the fix:
 * nothing is trusted unless an operator names exactly what to trust.
 */
describe('resolveTrustProxySetting', () => {
  it('returns undefined (nothing to trust) when TRUST_PROXY is unset', () => {
    expect(resolveTrustProxySetting('')).toBeUndefined();
  });

  it('returns undefined for a blank/whitespace-only value', () => {
    expect(resolveTrustProxySetting('   ')).toBeUndefined();
  });

  it('passes through a specific IP address verbatim', () => {
    expect(resolveTrustProxySetting('203.0.113.7')).toBe('203.0.113.7');
  });

  it('passes through a CIDR subnet verbatim', () => {
    expect(resolveTrustProxySetting('10.0.0.0/8')).toBe('10.0.0.0/8');
  });

  it('passes through a comma-separated list of addresses verbatim', () => {
    expect(resolveTrustProxySetting('10.0.0.0/8, 203.0.113.7')).toBe('10.0.0.0/8, 203.0.113.7');
  });

  it('passes through an Express named subnet verbatim', () => {
    expect(resolveTrustProxySetting('loopback')).toBe('loopback');
  });

  it('trims surrounding whitespace but never rewrites the value', () => {
    expect(resolveTrustProxySetting('  203.0.113.7  ')).toBe('203.0.113.7');
  });

  /**
   * The specific gap the pentest exploited: `TRUST_PROXY=1` must never
   * become the numeric hop count `1` Express's `proxyaddr` treats specially
   * (trust whichever address is N hops back, regardless of what it is) —
   * it must be handed to Express as the *string* `'1'`, which `proxyaddr`
   * can only ever match against a literal address named `1` (impossible),
   * so it trusts nothing. There is no way back into the vulnerable
   * behaviour through this env var.
   */
  it('passes a digit-string through as a string, never as a numeric hop count', () => {
    const result = resolveTrustProxySetting('1');
    expect(result).toBe('1');
    expect(typeof result).toBe('string');
  });
});
