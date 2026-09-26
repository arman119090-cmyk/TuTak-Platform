/**
 * Per-provider timeout thresholds, and the one thing they may never do.
 *
 * Arman's decision of 15.09.2026: thirty minutes was my number, not a fact
 * about payments, so it becomes configuration — and the decision also says,
 * in the same breath, that time is never evidence of failure. These are unit
 * tests because the parsing is pure; that the thresholds never produce
 * `MONEY_DID_NOT_MOVE` is proved against a real database in
 * `psp-timeout-and-refund.int-spec.ts`.
 */
describe('PSP timeout policy configuration', () => {
  const ENV_KEYS = ['PSP_STALE_AFTER_MS', 'PSP_ESCALATE_EVERY_MS', 'PSP_TIMEOUT_POLICY'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    jest.resetModules();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  // Re-imported each time: `configuration()` reads `process.env` when it is
  // called, so the module cache would otherwise hand back the first answer.
  const load = () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('./configuration') as typeof import('./configuration')).default();
  };

  it('falls back to the figures the code used as constants', () => {
    const psp = load().psp;
    expect(psp.defaultStaleAfterMs).toBe(30 * 60_000);
    expect(psp.defaultEscalateEveryMs).toBe(60 * 60_000);
    expect(psp.perProvider).toEqual({});
  });

  it('takes a global override', () => {
    process.env.PSP_STALE_AFTER_MS = '900000';
    process.env.PSP_ESCALATE_EVERY_MS = '120000';
    const psp = load().psp;
    expect(psp.defaultStaleAfterMs).toBe(900_000);
    expect(psp.defaultEscalateEveryMs).toBe(120_000);
  });

  it('takes per-provider overrides', () => {
    process.env.PSP_TIMEOUT_POLICY = JSON.stringify({
      idram: { staleAfterMs: 900_000 },
      slowbank: { staleAfterMs: 86_400_000, escalateEveryMs: 7_200_000 },
    });
    const psp = load().psp;
    expect(psp.perProvider.idram).toEqual({ staleAfterMs: 900_000 });
    expect(psp.perProvider.slowbank).toEqual({
      staleAfterMs: 86_400_000,
      escalateEveryMs: 7_200_000,
    });
    // An override names only what it overrides; the rest still comes from the
    // defaults, so a provider entry cannot silently blank a threshold.
    expect(psp.perProvider.idram?.escalateEveryMs).toBeUndefined();
    expect(psp.defaultEscalateEveryMs).toBe(60 * 60_000);
  });

  it.each([
    ['not a number', 'PSP_STALE_AFTER_MS', '30m'],
    ['zero', 'PSP_STALE_AFTER_MS', '0'],
    ['negative', 'PSP_ESCALATE_EVERY_MS', '-1'],
    ['fractional', 'PSP_STALE_AFTER_MS', '1.5'],
  ])('refuses a %s threshold rather than falling back', (_label, key, value) => {
    process.env[key] = value;
    // Refused rather than defaulted: a timeout that silently reverts because
    // somebody typed "30m" is one nobody can reason about from the config in
    // front of them.
    expect(load).toThrow(/positive whole number of milliseconds/);
  });

  it.each([
    ['malformed JSON', '{idram:'],
    ['an array', '[]'],
    ['a provider whose value is not an object', '{"idram":900000}'],
    ['a non-numeric threshold', '{"idram":{"staleAfterMs":"soon"}}'],
  ])('refuses %s in the per-provider policy', (_label, value) => {
    process.env.PSP_TIMEOUT_POLICY = value;
    expect(load).toThrow(/PSP_TIMEOUT_POLICY/);
  });

  it('treats an empty policy as no overrides', () => {
    process.env.PSP_TIMEOUT_POLICY = '';
    expect(load().psp.perProvider).toEqual({});
  });
});
