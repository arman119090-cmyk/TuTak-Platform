import { assertRedisUrlConfigured } from './redis.module';

/**
 * Launch-readiness audit finding: REDIS_URL's `redis://localhost:6379`
 * default (unlike DATABASE_URL/JWT secrets, which have none) meant a
 * production deploy that forgot to set it would boot cleanly and silently
 * point advisory locks and the sweep queue at an empty local instance,
 * instead of failing the way SmsModule/PushModule/the PSP sandbox adapter
 * already fail for their own required-in-production settings.
 */
describe('assertRedisUrlConfigured', () => {
  it('refuses to boot in production with no explicit REDIS_URL', () => {
    expect(() =>
      assertRedisUrlConfigured({ isProduction: true, hasExplicitUrl: false, demoMode: false }),
    ).toThrow(/REDIS_URL must be configured in production/);
  });

  it('allows production to boot once REDIS_URL is explicitly set', () => {
    expect(() =>
      assertRedisUrlConfigured({ isProduction: true, hasExplicitUrl: true, demoMode: false }),
    ).not.toThrow();
  });

  it('allows demo mode to boot without REDIS_URL, same escape hatch as SMS/PSP', () => {
    expect(() =>
      assertRedisUrlConfigured({ isProduction: true, hasExplicitUrl: false, demoMode: true }),
    ).not.toThrow();
  });

  it('never blocks non-production environments regardless of REDIS_URL', () => {
    expect(() =>
      assertRedisUrlConfigured({ isProduction: false, hasExplicitUrl: false, demoMode: false }),
    ).not.toThrow();
  });
});
