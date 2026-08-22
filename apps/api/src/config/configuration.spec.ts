import { AppConfig, assertPoolSplitSums } from './configuration';

/**
 * 2026-08-22 3-level referral rework: the pool split grew from four legs
 * (green/deferred/referrer/tutak) to six (green/deferred/L1/L2/L3/tutak).
 * `assertPoolSplitSums` is the boot-time guard that refuses to let the
 * platform start with a split that cannot represent exactly 100% of the
 * contribution pool — the same "fail loudly at startup" discipline this
 * file already applies to CORS/SMS. This is its regression suite, per the
 * rework's own requirement 1 ("Update configuration and its startup
 * validation: six bps values, summing to 10,000, valid ranges").
 */
describe('assertPoolSplitSums', () => {
  const validPolicy = (): AppConfig['purchasePolicy'] => ({
    intentTimeoutSeconds: 180,
    poolGreenBps: 2000,
    poolDeferredBps: 3000,
    poolReferrerL1Bps: 1000,
    poolReferrerL2Bps: 500,
    poolReferrerL3Bps: 500,
    poolTutakBps: 3000,
    deferredWindowMonths: 3,
    deferredRequiredTurnover: '54000',
    challengeQualificationAmount: '10000',
    challengeRewardAmount: '1000',
    challengeSlotLimit: 3,
  });

  it('accepts the canonical 30/20/30/10/5/5 (TuTak/Green/Deferred/L1/L2/L3) split', () => {
    expect(() => assertPoolSplitSums(validPolicy())).not.toThrow();
  });

  it('rejects a split that sums under 10000', () => {
    const policy = validPolicy();
    policy.poolTutakBps = 2999; // total 9999
    expect(() => assertPoolSplitSums(policy)).toThrow(/must sum to 10000/);
  });

  it('rejects a split that sums over 10000', () => {
    const policy = validPolicy();
    policy.poolTutakBps = 3001; // total 10001
    expect(() => assertPoolSplitSums(policy)).toThrow(/must sum to 10000/);
  });

  it('rejects the old single-leg 20/30/20/30 shape reused verbatim for the new six legs', () => {
    // The exact mistake the rework's spec explicitly warns against: pasting
    // the old referrer bps (2000, i.e. 20%) into poolReferrerL1Bps instead
    // of the new 1000 (10%) — total would overshoot 10000.
    const policy = validPolicy();
    policy.poolReferrerL1Bps = 2000;
    expect(() => assertPoolSplitSums(policy)).toThrow(/must sum to 10000/);
  });

  it('rejects a negative leg', () => {
    const policy = validPolicy();
    policy.poolReferrerL3Bps = -500;
    policy.poolTutakBps = 4000; // keep the (invalid) sum at 10000 to isolate the range check
    expect(() => assertPoolSplitSums(policy)).toThrow(/integer between 0 and 10000/);
  });

  it('rejects a non-integer leg', () => {
    const policy = validPolicy();
    policy.poolGreenBps = 2000.5;
    expect(() => assertPoolSplitSums(policy)).toThrow(/integer between 0 and 10000/);
  });

  it('rejects a leg over 10000', () => {
    const policy = validPolicy();
    policy.poolTutakBps = 10_001;
    expect(() => assertPoolSplitSums(policy)).toThrow(/integer between 0 and 10000/);
  });

  it('accepts a degenerate but valid split where every referrer leg is zero (all levels always fold to TuTak)', () => {
    const policy = validPolicy();
    policy.poolReferrerL1Bps = 0;
    policy.poolReferrerL2Bps = 0;
    policy.poolReferrerL3Bps = 0;
    policy.poolTutakBps = 5000; // 2000 + 3000 + 0 + 0 + 0 + 5000 = 10000
    expect(() => assertPoolSplitSums(policy)).not.toThrow();
  });
});
