import { assertDemoSeedNotProduction } from './seed-demo';

/**
 * The hole this closes: `TUTAK_DEMO=1` was the demonstration seeder's only
 * confirmation, and `docker-entrypoint.sh` supplies that variable itself when
 * `DEMO_SEED=true`. Inside an image the check therefore could not fail, and
 * the single remaining barrier in front of a production database was one env
 * var not being the string "true" — set right next to `SEED_BASELINE`, which
 * a production deployment legitimately does set.
 *
 * So these assert on the *environment*, which the caller cannot talk its way
 * out of, rather than on a flag.
 */

describe('assertDemoSeedNotProduction', () => {
  it('refuses when APP_ENV says production', () => {
    expect(() => assertDemoSeedNotProduction({ APP_ENV: 'production' })).toThrow(
      /Refusing to run the demonstration seeder/,
    );
  });

  // APP_ENV unset falls back to NODE_ENV — the shape a deployment that only
  // sets NODE_ENV actually has.
  it('refuses when only NODE_ENV says production', () => {
    expect(() => assertDemoSeedNotProduction({ NODE_ENV: 'production' })).toThrow(
      /Refusing to run the demonstration seeder/,
    );
  });

  it('refuses even with TUTAK_DEMO=1 present, which the entrypoint always sets', () => {
    expect(() =>
      assertDemoSeedNotProduction({ APP_ENV: 'production', NODE_ENV: 'production', TUTAK_DEMO: '1' }),
    ).toThrow(/Refusing to run the demonstration seeder/);
  });

  it('says which variable was probably meant, because the two sit together', () => {
    expect(() => assertDemoSeedNotProduction({ APP_ENV: 'production' })).toThrow(/SEED_BASELINE/);
  });

  // A hosted demonstration is exactly what DEMO_SEED exists for.
  it.each([
    ['staging', { APP_ENV: 'staging' }],
    ['development', { APP_ENV: 'development' }],
    ['an unset environment', {}],
  ])('leaves %s alone', (_label, env) => {
    expect(() => assertDemoSeedNotProduction(env)).not.toThrow();
  });
});
