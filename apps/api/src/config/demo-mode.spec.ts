import configuration from './configuration';

/**
 * Demo mode decides whether a fake acquirer is allowed to run. A flag with
 * that consequence should not be reachable by accident, so what is tested
 * here is mostly the ways it must *not* turn on.
 */
describe('demo mode', () => {
  const original = process.env.DEMO_MODE;

  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = original;
  });

  const withDemo = (value: string | undefined) => {
    if (value === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = value;
    return configuration().demoMode;
  };

  it('is off when nothing is set', () => {
    expect(withDemo(undefined)).toBe(false);
  });

  it('is on only for the exact string "true"', () => {
    expect(withDemo('true')).toBe(true);
  });

  it.each(['1', 'yes', 'on', 'TRUE', 'True', 'demo', ' true', 'true ', ''])(
    'stays off for %p',
    (value) => {
      // Every one of these is something a person might reasonably type
      // expecting it to work. Refusing them all means the only way to end up
      // in demo mode is to have written the word deliberately — and the
      // failure direction is safe: a demo that will not start is a bad
      // afternoon, a production deployment on a fake acquirer is fraud.
      expect(withDemo(value)).toBe(false);
    },
  );

  it('is independent of NODE_ENV', () => {
    // Nothing about being in production should imply it, and nothing about
    // being in development should either — the whole point is that it is a
    // third state that has to be asked for.
    const nodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(withDemo(undefined)).toBe(false);
      process.env.NODE_ENV = 'development';
      expect(withDemo(undefined)).toBe(false);
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
  });
});
